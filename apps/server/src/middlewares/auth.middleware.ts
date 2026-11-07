import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { sessionTokenService } from '../services/session-token.service';
import { localAuthService } from '../services/local-auth.service';
import { db } from '../db';
import { classCounselors } from '../db/schema/staff';
import { eq, and } from 'drizzle-orm';
import type { UserRole, AuthPrincipal } from '@smart-attendance/shared';
import { getConfig } from '../config/env';

// Extend Hono Context Variables
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthPrincipal;
    student?: any;
  }
}

/**
 * Resolves a browser HOD session cookie or an application-issued mobile bearer token.
 */
export const authenticate = async (c: Context, next: Next) => {
  const adminToken = getCookie(c, 'admin_token');
  const authHeader = c.req.header('Authorization');
  let principal: AuthPrincipal | null = null;
  try {
    if (adminToken) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
        const requestOrigin = c.req.header('origin');
        const config = getConfig();
        const isAllowedOrigin = requestOrigin && (
          config.corsOrigins.includes(requestOrigin) ||
          (!config.isProduction && (
            requestOrigin.startsWith('http://localhost:') ||
            requestOrigin.startsWith('http://127.0.0.1:')
          ))
        );
        if (!isAllowedOrigin) {
          return c.json({ success: false, error: { code: 'CSRF_REJECTED', message: 'Request origin is not allowed.' } }, 403);
        }
      }
      principal = await localAuthService.verifySession(adminToken);
    } else {
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;
      if (token) {
        try {
          principal = await sessionTokenService.verifySessionToken(token);
        } catch {
          principal = null;
        }
        if (!principal) {
          principal = await localAuthService.verifySession(token);
        }
      }
    }

  } catch {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_SESSION',
        message: 'Your session is invalid or expired. Please sign in again.',
      },
    }, 401);
  }
  if (!principal) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }
  c.set('user', principal);
  await next();
};

/**
 * RBAC middleware: requires the authenticated principal to have at least one of the specified roles.
 */
export const requireRole = (...allowedRoles: UserRole[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthPrincipal | undefined;

    if (!user) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    }

    const hasAllowedRole = user.roles.some((role) => allowedRoles.includes(role));

    if (!hasAllowedRole) {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Required role: [${allowedRoles.join(', ')}]. Your active roles: [${user.roles.join(', ')}].`,
        },
      }, 403);
    }

    await next();
  };
};

/**
 * Backward compatibility: Require ADMIN role
 */
export const requireAdminAuth = async (c: Context, next: Next) => {
  let user = c.get('user') as AuthPrincipal | undefined;
  if (!user) {
    const authRes = await authenticate(c, async () => {
      user = c.get('user') as AuthPrincipal | undefined;
    });
    if (authRes) return authRes;
  }

  user = c.get('user') as AuthPrincipal | undefined;
  if (!user?.roles?.includes('ADMIN')) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden: Admin access required.' } }, 403);
  }

  await next();
};

/**
 * Department-level oversight: ADMIN, HOD, or DEPUTY_HOD
 */
export const requireHodOrAdmin = requireRole('ADMIN', 'HOD', 'DEPUTY_HOD');

/**
 * Authenticated users of the current shared HOD/faculty application modules.
 */
export const requireSharedModuleAccess = requireRole(
  'ADMIN',
  'HOD',
  'DEPUTY_HOD',
  'CLASS_COUNSELOR',
  'STAFF',
  'FACULTY',
);

export const requireStaffOrAdmin = requireSharedModuleAccess;

/**
 * Backward-compatible guard name for shared application routes.
 */
export const requireSharedDashboardRead = requireSharedModuleAccess;

/**
 * Attendance writes require a principal backed by the staff table.
 * Public FACULTY accounts are intentionally not assigned fabricated staff identities.
 */
export const requireLinkedAttendanceStaff = async (c: Context, next: Next) => {
  const user = c.get('user') as AuthPrincipal | undefined;
  if (user?.roles.includes('FACULTY') && !user.roles.some((role) => ['ADMIN', 'HOD', 'DEPUTY_HOD', 'STAFF'].includes(role))) {
    return c.json({
      success: false,
      error: {
        code: 'STAFF_PROFILE_REQUIRED',
        message: 'Attendance changes require a faculty account linked to an active staff profile and timetable assignment.',
      },
    }, 403);
  }
  await next();
};

/**
 * Class-level resource authorization check:
 * Allows ADMIN, HOD, DEPUTY_HOD unconditionally, or CLASS_COUNSELOR if assigned to the target classId.
 */
export const requireClassCounselorOrAdmin = (getClassId: (c: Context) => string | undefined) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthPrincipal;
    if (!user) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    }

    // Admins and HODs have department-wide class access
    if (user.roles.includes('ADMIN') || user.roles.includes('HOD') || user.roles.includes('DEPUTY_HOD')) {
      return next();
    }

    // Class counselor check
    if (user.roles.includes('CLASS_COUNSELOR')) {
      const classId = getClassId(c);
      if (!classId) {
        return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Class identifier is required for access verification.' } }, 400);
      }

      const assignment = await db
        .select()
        .from(classCounselors)
        .where(
          and(
            eq(classCounselors.staffId, user.id),
            eq(classCounselors.classId, classId),
            eq(classCounselors.status, 'ACTIVE')
          )
        )
        .then((rows) => rows[0]);

      if (assignment) {
        return next();
      }
    }

    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: You are not authorized to view or manage this class.',
      },
    }, 403);
  };
};

/**
 * Student authentication middleware
 */
export const requireStudentAuth = async (c: Context, next: Next) => {
  let user = c.get('user') as AuthPrincipal | undefined;
  if (!user) {
    const authRes = await authenticate(c, async () => {
      user = c.get('user') as AuthPrincipal | undefined;
    });
    if (authRes) return authRes;
  }

  user = c.get('user') as AuthPrincipal | undefined;
  if (!user?.roles?.includes('STUDENT')) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Student access required.' } }, 403);
  }

  c.set('student', user);
  await next();
};

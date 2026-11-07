import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { StudentRepository } from '../repositories/student.repository';
import { AuditService } from '../services/audit.service';
import { DuplicateFacultyAccountError, LocalAuthService, localAuthService } from '../services/local-auth.service';
import { sessionTokenService } from '../services/session-token.service';
import { authenticate } from '../middlewares/auth.middleware';
import type { AuthPrincipal } from '@smart-attendance/shared';

export const authRoutes = new Hono();
const studentRepo = new StudentRepository();
const audit = new AuditService();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; windowStartedAt: number }>();

function isDemoSignupEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function loginKey(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  let current = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function isLoginRateLimited(key: string): boolean {
  const current = loginAttempts.get(key);
  if (!current) return false;
  if (Date.now() - current.windowStartedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return current.count > MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key: string): boolean {
  const now = Date.now();
  if (loginAttempts.size > 10_000) {
    for (const [attemptKey, entry] of loginAttempts) {
      if (now - entry.windowStartedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(attemptKey);
    }
  }
  if (loginAttempts.size >= 10_000 && !loginAttempts.has(key)) {
    const oldestKey = loginAttempts.keys().next().value;
    if (oldestKey) loginAttempts.delete(oldestKey);
  }
  const current = loginAttempts.get(key);
  const entry = !current || now - current.windowStartedAt >= LOGIN_WINDOW_MS
    ? { count: 1, windowStartedAt: now }
    : { ...current, count: current.count + 1 };
  loginAttempts.set(key, entry);
  return entry.count > MAX_LOGIN_ATTEMPTS;
}

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  if (
    !body ||
    typeof body.email !== 'string' ||
    typeof body.password !== 'string' ||
    body.email.length > 254 ||
    new TextEncoder().encode(body.password).length > 72
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address and password.' } }, 400);
  }

  const email = body.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address and password.' } }, 400);
  }

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = loginKey(email);
  if (isLoginRateLimited(key)) {
    return c.json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } }, 429);
  }

  const result = await localAuthService.login(email, body.password);
  if (!result) {
    if (recordFailedLogin(key)) {
      return c.json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } }, 429);
    }
    await audit.log({
      action: 'FAILED_ADMIN_LOGIN',
      entityType: 'AUTHENTICATION',
      description: 'An administrator or faculty sign-in attempt failed.',
      ipAddress: ip,
      userAgent: c.req.header('user-agent'),
    });
    return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }, 401);
  }

  if ('pendingApproval' in result) {
    return c.json({
      success: false,
      error: {
        code: 'PENDING_HOD_APPROVAL',
        message: result.message,
      },
    }, 403);
  }

  if ('rejected' in result) {
    return c.json({
      success: false,
      error: {
        code: 'APPROVAL_REJECTED',
        message: result.message,
      },
    }, 403);
  }

  loginAttempts.delete(key);
  setCookie(c, 'admin_token', result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 60 * 60 * 8,
    path: '/',
  });
  await audit.log({
    actorId: result.principal.roles.includes('FACULTY') ? undefined : result.principal.id,
    actorName: result.principal.name,
    actorRole: result.principal.roles[0],
    action: result.principal.roles.includes('FACULTY') ? 'FACULTY_LOGIN' : 'ADMIN_LOGIN',
    entityType: 'AUTHENTICATION',
    entityId: result.principal.id,
    description: result.principal.roles.includes('FACULTY') ? 'Faculty member signed in.' : 'Administrator signed in.',
    ipAddress: ip,
    userAgent: c.req.header('user-agent'),
  });

  return c.json({ success: true, user: result.principal, token: result.token });
});

authRoutes.get('/signup-status', (c) => {
  return c.json({ success: true, enabled: isDemoSignupEnabled() });
});

// Staff access request registration with immediate HOD notification
authRoutes.post('/staff-register', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    staffCode?: unknown;
    department?: unknown;
  } | null;

  if (
    !body ||
    typeof body.name !== 'string' ||
    typeof body.email !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter your full name, college email, and password.' } }, 400);
  }

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  const staffCode = typeof body.staffCode === 'string' ? body.staffCode.trim() : undefined;
  const department = typeof body.department === 'string' ? body.department.trim() : undefined;
  const passwordBytes = new TextEncoder().encode(body.password).length;

  if (name.length < 2 || name.length > 255 || !LocalAuthService.isValidEmail(email) || passwordBytes < 8 || passwordBytes > 72) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid name, college email, and password (at least 8 characters).' } }, 400);
  }

  try {
    const res = await localAuthService.requestStaffAccess(name, email, body.password, staffCode, department);
    await audit.log({
      actorName: name,
      actorRole: 'STAFF_CANDIDATE',
      action: 'STAFF_APPROVAL_REQUESTED',
      entityType: 'AUTHENTICATION',
      entityId: res.id,
      description: `Staff member ${name} requested portal access. Pending HOD authorization.`,
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: c.req.header('user-agent'),
    });
    return c.json({ success: true, message: res.message });
  } catch (error: unknown) {
    if (error instanceof DuplicateFacultyAccountError || isUniqueConstraintViolation(error)) {
      return c.json({ success: false, error: { code: 'ACCOUNT_EXISTS', message: 'A staff or faculty account with this email already exists.' } }, 409);
    }
    throw error;
  }
});

authRoutes.post('/signup', async (c) => {
  if (!isDemoSignupEnabled()) {
    return c.json({ success: false, error: { code: 'SIGNUP_DISABLED', message: 'Demo sign-up is currently disabled.' } }, 403);
  }

  const body = await c.req.json().catch(() => null) as { name?: unknown; email?: unknown; password?: unknown } | null;
  if (
    !body ||
    typeof body.name !== 'string' ||
    typeof body.email !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter your name, a valid email, and a password of at least 12 characters.' } }, 400);
  }

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  const passwordBytes = new TextEncoder().encode(body.password).length;
  if (
    name.length < 2 ||
    name.length > 255 ||
    !LocalAuthService.isValidEmail(email) ||
    passwordBytes < 12 ||
    passwordBytes > 72
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter your name, a valid email, and a password of at least 12 characters (maximum 72 UTF-8 bytes).' } }, 400);
  }
  try {
    const result = await localAuthService.registerFacultyAccount(name, email, body.password);
    setCookie(c, 'admin_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 60 * 60 * 8,
      path: '/',
    });
    await audit.log({
      actorName: result.principal.name,
      actorRole: 'FACULTY',
      action: 'FACULTY_SIGNUP',
      entityType: 'AUTHENTICATION',
      entityId: result.principal.id,
      description: 'Faculty account created through public sign-up.',
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: c.req.header('user-agent'),
    });
    return c.json({ success: true, user: result.principal }, 201);
  } catch (error: unknown) {
    if (error instanceof DuplicateFacultyAccountError || isUniqueConstraintViolation(error)) {
      return c.json({ success: false, error: { code: 'ACCOUNT_EXISTS', message: 'An account with this email already exists.' } }, 409);
    }
    throw error;
  }
});

authRoutes.post('/student/login', async (c) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_STUDENT_PASSWORDLESS_LOGIN !== 'true') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Student passwordless login is disabled in production.' } }, 403);
  }
  try {
    const body = await c.req.json() as { username?: string; register_number?: string };
    const { username, register_number } = body;
    if (!username || !register_number || username !== register_number) {
      return c.json({ success: false, error: { message: 'Username and Register Number must match.' } }, 400);
    }
    const student = await studentRepo.getStudentByRegisterNumber(register_number);
    if (!student || student.status !== 'ACTIVE') {
      return c.json({ success: false, error: { message: 'Invalid student credentials.' } }, 401);
    }
    const principal: AuthPrincipal = {
      id: student.id,
      name: student.name,
      collegeEmail: student.collegeEmail,
      roles: ['STUDENT'],
      userType: 'STUDENT',
      registerNumber: student.registerNumber,
      classId: student.classId || undefined,
      microsoftUserId: student.microsoftUserId,
    };
    const token = await sessionTokenService.createSessionToken(principal);
    return c.json({ success: true, student, token });
  } catch {
    return c.json({ success: false, error: { message: 'Unable to authenticate student.' } }, 500);
  }
});

authRoutes.post('/logout', async (c) => {
  const user = c.get('user') as AuthPrincipal;
  if (user?.roles?.includes('FACULTY')) {
    await localAuthService.invalidateFacultySessions(user.id);
  } else if (user?.userType === 'STAFF') {
    await localAuthService.invalidateSessions(user.id);
  }
  deleteCookie(c, 'admin_token', { path: '/' });
  return c.json({ success: true });
});

authRoutes.get('/me', authenticate, (c) => {
  return c.json({ success: true, user: c.get('user') });
});

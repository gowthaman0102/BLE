import { jwtVerify, SignJWT } from 'jose';
import { db } from '../db';
import { staff, staffRoles, roles } from '../db/schema/staff';
import { students } from '../db/schema/students';
import { eq } from 'drizzle-orm';
import type { UserRole, AuthPrincipal } from '@smart-attendance/shared';

export class SessionTokenService {
  /**
   * Returns the configured JWT secret.
   */
  getJwtSecret(): Uint8Array {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.trim() === '') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be configured in production environment.');
      }
      return new TextEncoder().encode('development_only_secret_must_be_changed_in_prod_32chars!');
    }
    if (process.env.NODE_ENV === 'production' && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long in production.');
    }
    return new TextEncoder().encode(secret);
  }

  /**
   * Mints an internal session JWT token representing the validated principal.
   */
  async createSessionToken(principal: AuthPrincipal, expiresInSeconds = 86400): Promise<string> {
    const secret = this.getJwtSecret();
    return new SignJWT({
      id: principal.id,
      email: principal.collegeEmail,
      roles: principal.roles,
      userType: principal.userType,
      name: principal.name,
      staffCode: principal.staffCode,
      registerNumber: principal.registerNumber,
      classId: principal.classId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .sign(secret);
  }

  /**
   * Verifies an internal session JWT token.
   */
  async verifySessionToken(token: string): Promise<AuthPrincipal> {
    const secret = this.getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    const principalId = (payload.staffId || payload.id || payload.sub) as string;

    if (!principalId) {
      throw new Error('INVALID_TOKEN: Missing identifier in session token.');
    }

    if (payload.userType === 'STAFF' || payload.kind === 'hod-session' || payload.kind === 'faculty-session') {
      const staffUser = await db.select().from(staff).where(eq(staff.id, principalId)).then((rows) => rows[0]);
      if (staffUser && staffUser.status === 'ACTIVE') {
        const staffRoleRows = await db
          .select({ roleName: roles.name })
          .from(staffRoles)
          .innerJoin(roles, eq(staffRoles.roleId, roles.id))
          .where(eq(staffRoles.staffId, staffUser.id));

        const mappedRoles = staffRoleRows.map((r) => r.roleName as UserRole);
        return {
          id: staffUser.id,
          name: staffUser.name,
          collegeEmail: staffUser.collegeEmail,
          roles: mappedRoles.length > 0 ? mappedRoles : ['STAFF'],
          userType: 'STAFF',
          staffCode: staffUser.staffCode,
        };
      }
    }

    const studentUser = await db.select().from(students).where(eq(students.id, principalId)).then((rows) => rows[0]);
    if (studentUser && studentUser.status === 'ACTIVE') {
      return {
        id: studentUser.id,
        name: studentUser.name,
        collegeEmail: studentUser.collegeEmail,
        roles: ['STUDENT'],
        userType: 'STUDENT',
        registerNumber: studentUser.registerNumber,
        classId: studentUser.classId,
      };
    }

    // Fallback: check staff by principalId in case userType was omitted
    const fallbackStaff = await db.select().from(staff).where(eq(staff.id, principalId)).then((rows) => rows[0]);
    if (fallbackStaff && fallbackStaff.status === 'ACTIVE') {
      const staffRoleRows = await db
        .select({ roleName: roles.name })
        .from(staffRoles)
        .innerJoin(roles, eq(staffRoles.roleId, roles.id))
        .where(eq(staffRoles.staffId, fallbackStaff.id));

      const mappedRoles = staffRoleRows.map((r) => r.roleName as UserRole);
      return {
        id: fallbackStaff.id,
        name: fallbackStaff.name,
        collegeEmail: fallbackStaff.collegeEmail,
        roles: mappedRoles.length > 0 ? mappedRoles : ['STAFF'],
        userType: 'STAFF',
        staffCode: fallbackStaff.staffCode,
      };
    }

    throw new Error('ACCOUNT_INACTIVE: Account is inactive or not found.');
  }
}

export const sessionTokenService = new SessionTokenService();
// Backwards compatibility alias
export const msAuthService = sessionTokenService;

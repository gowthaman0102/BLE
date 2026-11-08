import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { facultyAuthAccounts, staffCredentials, staffApprovalRequests } from '../db/schema/auth';
import { roles, staff, staffRoles } from '../db/schema/staff';
import type { AuthPrincipal, UserRole } from '@smart-attendance/shared';
import { AuditService } from './audit.service';

const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;
const BCRYPT_ROUNDS = 12;
const LOCAL_SESSION_KIND = 'hod-session';
const FACULTY_SESSION_KIND = 'faculty-session';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export type LoginResult = 
  | { principal: AuthPrincipal; token: string }
  | { pendingApproval: true; message: string }
  | { rejected: true; message: string }
  | null;

export class LocalAuthService {
  private readonly dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  private readonly auditService = new AuditService();

  private createSessionToken(staffId: string, sessionVersion: number): Promise<string> {
    return new SignJWT({ kind: LOCAL_SESSION_KIND, sessionVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(staffId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_LIFETIME_SECONDS}s`)
      .sign(getJwtSecret());
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const allowedStaffRoles = ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF'];
    const entries = await db
      .select({
        staffId: staff.id,
        staffCode: staff.staffCode,
        name: staff.name,
        collegeEmail: staff.collegeEmail,
        status: staff.status,
        passwordHash: staffCredentials.passwordHash,
        sessionVersion: staffCredentials.sessionVersion,
        role: roles.name,
      })
      .from(staffCredentials)
      .innerJoin(staff, eq(staffCredentials.staffId, staff.id))
      .innerJoin(staffRoles, eq(staffRoles.staffId, staff.id))
      .innerJoin(roles, eq(staffRoles.roleId, roles.id))
      .where(and(
        eq(staff.collegeEmail, normalizedEmail),
        eq(staff.status, 'ACTIVE'),
        inArray(roles.name, allowedStaffRoles),
      ));

    const entry = entries[0];
    if (entry) {
      if (!await bcrypt.compare(password, entry.passwordHash)) return null;
      const principal: AuthPrincipal = {
        id: entry.staffId,
        name: entry.name,
        collegeEmail: entry.collegeEmail,
        staffCode: entry.staffCode,
        roles: (['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF'] as const).filter((role) => entries.some((item) => item.role === role)) as AuthPrincipal['roles'],
        userType: 'STAFF',
      };
      const token = await this.createSessionToken(entry.staffId, entry.sessionVersion);
      return { principal, token };
    }

    const facultyAccount = (await db.select()
      .from(facultyAuthAccounts)
      .where(and(
        eq(facultyAuthAccounts.email, normalizedEmail),
        eq(facultyAuthAccounts.status, 'ACTIVE'),
        eq(facultyAuthAccounts.role, 'FACULTY'),
      )))[0];

    const passwordMatches = await bcrypt.compare(password, facultyAccount?.passwordHash || await this.dummyHash);
    if (!facultyAccount || !passwordMatches) {
      // Check if user has an approval request in staff_approval_requests
      const [pendingRequest] = await db.select()
        .from(staffApprovalRequests)
        .where(sql`lower(${staffApprovalRequests.email}) = ${normalizedEmail}`);
      
      if (pendingRequest) {
        if (pendingRequest.status === 'PENDING') {
          return {
            pendingApproval: true,
            message: 'Your staff account registration is currently pending approval by the Head of Department (HOD). An alert has been forwarded to the HOD.',
          };
        }
        if (pendingRequest.status === 'REJECTED') {
          return {
            rejected: true,
            message: pendingRequest.rejectionReason 
              ? `Your registration request was declined: ${pendingRequest.rejectionReason}`
              : 'Your staff registration request was declined by the Head of Department.',
          };
        }
      }
      return null;
    }

    // Resolve legitimate existing staff table identity if one exists
    const staffRecord = (await db.select()
      .from(staff)
      .where(and(
        sql`lower(${staff.collegeEmail}) = ${normalizedEmail}`,
        eq(staff.status, 'ACTIVE'),
      )))[0];

    if (staffRecord) {
      const staffRoleRows = await db
        .select({ roleName: roles.name })
        .from(staffRoles)
        .innerJoin(roles, eq(staffRoles.roleId, roles.id))
        .where(eq(staffRoles.staffId, staffRecord.id));

      const assignedRoles = staffRoleRows.map((r) => r.roleName as UserRole);
      const mappedRoles = [...new Set([...assignedRoles, 'FACULTY' as UserRole, 'STAFF' as UserRole])];

      const principal: AuthPrincipal = {
        id: staffRecord.id,
        name: staffRecord.name,
        collegeEmail: staffRecord.collegeEmail,
        staffCode: staffRecord.staffCode,
        roles: mappedRoles,
        userType: 'STAFF',
      };
      const token = await new SignJWT({
        kind: FACULTY_SESSION_KIND,
        sessionVersion: facultyAccount.sessionVersion,
        staffId: staffRecord.id,
        userType: 'STAFF',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(facultyAccount.id)
        .setIssuedAt()
        .setExpirationTime(`${SESSION_LIFETIME_SECONDS}s`)
        .sign(getJwtSecret());
      return { principal, token };
    }

    // Faculty account without linked staff profile: preserve public faculty isolation
    const principal: AuthPrincipal = {
      id: facultyAccount.id,
      name: facultyAccount.name,
      collegeEmail: facultyAccount.email,
      roles: ['FACULTY'],
      userType: 'STAFF',
    };
    const token = await new SignJWT({
      kind: FACULTY_SESSION_KIND,
      sessionVersion: facultyAccount.sessionVersion,
      userType: 'STAFF',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(facultyAccount.id)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_LIFETIME_SECONDS}s`)
      .sign(getJwtSecret());
    return { principal, token };
  }

  async requestStaffAccess(
    name: string,
    email: string,
    password: string,
    staffCode?: string,
    department?: string,
  ): Promise<{ id: string; status: string; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingStaff = await db.select({ id: staff.id })
      .from(staff)
      .where(sql`lower(${staff.collegeEmail}) = ${normalizedEmail}`)
      .limit(1);
    const existingFaculty = await db.select({ id: facultyAuthAccounts.id })
      .from(facultyAuthAccounts)
      .where(sql`lower(${facultyAuthAccounts.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existingStaff.length || existingFaculty.length) {
      throw new DuplicateFacultyAccountError();
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    
    // Check if an existing approval request exists
    const [existingRequest] = await db.select()
      .from(staffApprovalRequests)
      .where(sql`lower(${staffApprovalRequests.email}) = ${normalizedEmail}`)
      .limit(1);

    let requestId: string;
    if (existingRequest) {
      if (existingRequest.status === 'APPROVED') {
        throw new DuplicateFacultyAccountError();
      }
      await db.update(staffApprovalRequests)
        .set({
          name: name.trim(),
          staffCode: staffCode ? staffCode.trim().toUpperCase() : null,
          department: department?.trim() || 'Information Technology',
          passwordHash,
          status: 'PENDING',
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(staffApprovalRequests.id, existingRequest.id));
      requestId = existingRequest.id;
    } else {
      const [inserted] = await db.insert(staffApprovalRequests).values({
        name: name.trim(),
        email: normalizedEmail,
        staffCode: staffCode ? staffCode.trim().toUpperCase() : null,
        department: department?.trim() || 'Information Technology',
        passwordHash,
        status: 'PENDING',
      }).returning({ id: staffApprovalRequests.id });
      requestId = inserted.id;
    }

    return {
      id: requestId,
      status: 'PENDING',
      message: 'Your registration request has been submitted to the HOD for authorization.',
    };
  }

  async getPendingStaffRequests() {
    return db.select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.status, 'PENDING'))
      .orderBy(sql`${staffApprovalRequests.createdAt} DESC`);
  }

  async getAllStaffRequests() {
    return db.select()
      .from(staffApprovalRequests)
      .orderBy(sql`${staffApprovalRequests.createdAt} DESC`);
  }

  async approveStaffRequest(
    requestId: string,
    actor?: { actorId?: string; actorName?: string; actorRole?: string; actorEmail?: string; ipAddress?: string; userAgent?: string }
  ) {
    const [req] = await db.select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.id, requestId));
    if (!req) throw new Error('Approval request not found.');

    if (actor?.actorEmail && req.email.toLowerCase() === actor.actorEmail.toLowerCase()) {
      throw new Error('You cannot approve your own access request.');
    }
    if (req.status === 'APPROVED') return { success: true, message: 'Already approved.' };
    if (req.status === 'REJECTED') throw new Error('Cannot approve a rejected request.');

    await db.transaction(async (tx) => {
      // 1. Create or update facultyAuthAccounts
      const existingFaculty = (await tx.select().from(facultyAuthAccounts).where(sql`lower(${facultyAuthAccounts.email}) = ${req.email}`))[0];
      if (existingFaculty) {
        await tx.update(facultyAuthAccounts).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(facultyAuthAccounts.id, existingFaculty.id));
      } else {
        await tx.insert(facultyAuthAccounts).values({
          name: req.name,
          email: req.email,
          passwordHash: req.passwordHash,
          role: 'FACULTY',
          status: 'ACTIVE',
        });
      }

      // 2. Also create staff record if not existing so they appear in staff list!
      const generatedStaffCode = req.staffCode || `FAC-${Math.floor(1000 + Math.random() * 9000)}`;
      const existingStaff = (await tx.select().from(staff).where(sql`lower(${staff.collegeEmail}) = ${req.email}`))[0];
      if (!existingStaff) {
        const [newStaff] = await tx.insert(staff).values({
          name: req.name,
          collegeEmail: req.email,
          staffCode: generatedStaffCode,
          status: 'ACTIVE',
        }).returning();

        const [staffRole] = await tx.select().from(roles).where(eq(roles.name, 'STAFF'));
        if (staffRole) {
          await tx.insert(staffRoles).values({
            staffId: newStaff.id,
            roleId: staffRole.id,
          }).onConflictDoNothing();
        }
      }

      // 3. Mark approval request as APPROVED
      await tx.update(staffApprovalRequests).set({
        status: 'APPROVED',
        updatedAt: new Date(),
      }).where(eq(staffApprovalRequests.id, requestId));
    });

    await this.auditService.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName || 'System',
      actorRole: actor?.actorRole || 'HOD',
      action: 'APPROVE_STAFF_REQUEST',
      entityType: 'STAFF_APPROVAL_REQUEST',
      entityId: requestId,
      description: `Approved staff access request for ${req.name} (${req.email})`,
      oldValues: { status: req.status },
      newValues: { status: 'APPROVED' },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return { success: true, message: `Staff member ${req.name} has been approved.` };
  }

  async rejectStaffRequest(
    requestId: string,
    reason?: string,
    actor?: { actorId?: string; actorName?: string; actorRole?: string; actorEmail?: string; ipAddress?: string; userAgent?: string }
  ) {
    const [req] = await db.select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.id, requestId));
    if (!req) throw new Error('Approval request not found.');

    if (actor?.actorEmail && req.email.toLowerCase() === actor.actorEmail.toLowerCase()) {
      throw new Error('You cannot reject your own access request.');
    }
    if (req.status === 'REJECTED') return { success: true, message: 'Already rejected.' };
    if (req.status === 'APPROVED') throw new Error('Cannot reject an already approved request.');

    await db.update(staffApprovalRequests).set({
      status: 'REJECTED',
      rejectionReason: reason || 'Declined by Head of Department',
      updatedAt: new Date(),
    }).where(eq(staffApprovalRequests.id, requestId));

    await this.auditService.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName || 'System',
      actorRole: actor?.actorRole || 'HOD',
      action: 'REJECT_STAFF_REQUEST',
      entityType: 'STAFF_APPROVAL_REQUEST',
      entityId: requestId,
      description: `Rejected staff access request for ${req.name} (${req.email}). Reason: ${reason || 'Declined by Head of Department'}`,
      oldValues: { status: req.status },
      newValues: { status: 'REJECTED', rejectionReason: reason },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return { success: true, message: `Staff request for ${req.name} has been declined.` };
  }

  async registerFacultyAccount(
    name: string,
    email: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; token: string }> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const normalizedEmail = email.trim().toLowerCase();

    const account = await db.transaction(async (tx) => {
      const existingStaff = await tx.select({ id: staff.id })
        .from(staff)
        .where(sql`lower(${staff.collegeEmail}) = ${normalizedEmail}`)
        .limit(1);
      const existingFacultyAccount = await tx.select({ id: facultyAuthAccounts.id })
        .from(facultyAuthAccounts)
        .where(sql`lower(${facultyAuthAccounts.email}) = ${normalizedEmail}`)
        .limit(1);
      if (existingStaff.length || existingFacultyAccount.length) {
        throw new DuplicateFacultyAccountError();
      }

      const [created] = await tx.insert(facultyAuthAccounts).values({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: 'FACULTY',
        status: 'ACTIVE',
      }).returning({
        id: facultyAuthAccounts.id,
        name: facultyAuthAccounts.name,
        email: facultyAuthAccounts.email,
        sessionVersion: facultyAuthAccounts.sessionVersion,
      });
      return created;
    });

    const principal: AuthPrincipal = {
      id: account.id,
      name: account.name,
      collegeEmail: account.email,
      roles: ['FACULTY'],
      userType: 'STAFF',
    };
    const token = await new SignJWT({ kind: FACULTY_SESSION_KIND, sessionVersion: account.sessionVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(account.id)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_LIFETIME_SECONDS}s`)
      .sign(getJwtSecret());

    return { principal, token };
  }

  async verifySession(token: string): Promise<AuthPrincipal> {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sessionVersion !== 'number') {
      throw new Error('Invalid session.');
    }

    if (payload.kind === FACULTY_SESSION_KIND) {
      const account = (await db.select()
        .from(facultyAuthAccounts)
        .where(and(
          eq(facultyAuthAccounts.id, payload.sub),
          eq(facultyAuthAccounts.status, 'ACTIVE'),
          eq(facultyAuthAccounts.role, 'FACULTY'),
        )))[0];
      if (!account || account.sessionVersion !== payload.sessionVersion) {
        throw new Error('Invalid session.');
      }

      const normalizedEmail = account.email.trim().toLowerCase();
      const staffRecord = (await db.select()
        .from(staff)
        .where(and(
          sql`lower(${staff.collegeEmail}) = ${normalizedEmail}`,
          eq(staff.status, 'ACTIVE'),
        )))[0];

      if (staffRecord) {
        const staffRoleRows = await db
          .select({ roleName: roles.name })
          .from(staffRoles)
          .innerJoin(roles, eq(staffRoles.roleId, roles.id))
          .where(eq(staffRoles.staffId, staffRecord.id));

        const assignedRoles = staffRoleRows.map((r) => r.roleName as UserRole);
        const mappedRoles = [...new Set([...assignedRoles, 'FACULTY' as UserRole, 'STAFF' as UserRole])];

        return {
          id: staffRecord.id,
          name: staffRecord.name,
          collegeEmail: staffRecord.collegeEmail,
          staffCode: staffRecord.staffCode,
          roles: mappedRoles,
          userType: 'STAFF',
        };
      }

      return {
        id: account.id,
        name: account.name,
        collegeEmail: account.email,
        roles: ['FACULTY'],
        userType: 'STAFF',
      };
    }

    if (payload.kind !== LOCAL_SESSION_KIND) throw new Error('Invalid session.');

    const entries = await db
      .select({
        staffId: staff.id,
        staffCode: staff.staffCode,
        name: staff.name,
        collegeEmail: staff.collegeEmail,
        status: staff.status,
        sessionVersion: staffCredentials.sessionVersion,
        role: roles.name,
      })
      .from(staffCredentials)
      .innerJoin(staff, eq(staffCredentials.staffId, staff.id))
      .leftJoin(staffRoles, eq(staffRoles.staffId, staff.id))
      .leftJoin(roles, eq(staffRoles.roleId, roles.id))
      .where(and(
        eq(staff.id, payload.sub),
        eq(staff.status, 'ACTIVE'),
      ));
    const account = entries[0];
    if (!account || account.sessionVersion !== payload.sessionVersion) {
      throw new Error('Invalid session.');
    }

    const allowedStaffRoles = ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF', 'FACULTY'];
    const assignedRoles = entries.map((entry) => entry.role).filter((role): role is UserRole => typeof role === 'string' && allowedStaffRoles.includes(role));
    return {
      id: account.staffId,
      name: account.name,
      collegeEmail: account.collegeEmail,
      staffCode: account.staffCode,
      roles: assignedRoles.length > 0 ? [...new Set(assignedRoles)] : ['STAFF'],
      userType: 'STAFF',
    };
  }

  async invalidateSessions(staffId: string): Promise<void> {
    await db
      .update(staffCredentials)
      .set({ sessionVersion: sql`${staffCredentials.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(staffCredentials.staffId, staffId));
  }

  async invalidateFacultySessions(accountId: string): Promise<void> {
    await db.update(facultyAuthAccounts)
      .set({ sessionVersion: sql`${facultyAuthAccounts.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(facultyAuthAccounts.id, accountId));
  }

  static isValidEmail(email: string): boolean {
    return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  }

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
}

export class DuplicateFacultyAccountError extends Error {
  readonly code = '23505';

  constructor() {
    super('A user account with this email already exists.');
  }
}

export const localAuthService = new LocalAuthService();

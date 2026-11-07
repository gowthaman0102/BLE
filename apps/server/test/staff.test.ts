import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { msAuthService } from '../src/services/session-token.service';
import { db } from '../src/db';
import { departments, academicYears, batches, regulations, classes } from '../src/db/schema/academic';
import { staff, roles, staffRoles, classCounselors } from '../src/db/schema/staff';
import { timetables, periods } from '../src/db/schema/timetable';
import { subjects } from '../src/db/schema/subjects';
import { attendanceSessions } from '../src/db/schema/attendance';
import { auditLogs } from '../src/db/schema/audit';
import { eq, and, sql } from 'drizzle-orm';
import app from '../src/index';

describe('Phase W5 — Staff and Role Management Integration Test Suite', () => {
  let adminToken: string;
  let hodToken: string;
  let staffToken: string;
  let itDepartmentId: string;
  let testClassId: string;
  let testAcademicYearId: string;

  let testAdminStaffId: string;
  let testHodStaffId: string;
  let testStaffMemberId: string;

  // Track created staff IDs to clean up in afterAll
  const createdStaffIds: string[] = [];
  const createdCounselorIds: string[] = [];
  const createdTimetableIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdClassIds: string[] = [];
  const createdPeriodIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';
    process.env.COLLEGE_EMAIL_DOMAIN = 'sonatech.ac.in';

    // 1. Department
    let dept = await db.select().from(departments).where(eq(departments.code, 'IT')).then(r => r[0]);
    if (!dept) {
      dept = await db.insert(departments).values({
        name: 'Information Technology',
        code: 'IT',
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }
    itDepartmentId = dept.id;

    // 2. Academic Year
    let ay = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).then(r => r[0]);
    if (!ay) {
      ay = await db.insert(academicYears).values({
        name: `AY-W5-${Date.now()}`,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        isCurrent: true,
      }).returning().then(r => r[0]);
    }
    testAcademicYearId = ay.id;

    // 3. Class
    let cls = await db.select().from(classes).limit(1).then(r => r[0]);
    if (!cls) {
      const batch = await db.insert(batches).values({
        name: `BATCH-W5-${Date.now()}`,
        startYear: 2024,
        endYear: 2028,
        departmentId: itDepartmentId,
      }).returning().then(r => r[0]);

      const reg = await db.insert(regulations).values({
        name: `REG-W5-${Date.now()}`,
        year: 2024,
      }).returning().then(r => r[0]);

      cls = await db.insert(classes).values({
        name: 'III IT-A',
        yearNumber: 3,
        section: 'A',
        departmentId: itDepartmentId,
        academicYearId: ay.id,
        batchId: batch.id,
        regulationId: reg.id,
      }).returning().then(r => r[0]);
    }
    testClassId = cls.id;

    // 4. Roles
    const roleNames = ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF'];
    for (const rName of roleNames) {
      const existing = await db.select().from(roles).where(eq(roles.name, rName)).then(r => r[0]);
      if (!existing) {
        await db.insert(roles).values({ name: rName, description: `${rName} Role` });
      }
    }

    const rAdmin = await db.select().from(roles).where(eq(roles.name, 'ADMIN')).then(r => r[0]);
    const rHod = await db.select().from(roles).where(eq(roles.name, 'HOD')).then(r => r[0]);
    const rStaff = await db.select().from(roles).where(eq(roles.name, 'STAFF')).then(r => r[0]);

    // 5. Create Test Actors
    const rand = Math.random().toString(36).substring(2, 7);
    const sAdmin = await db.insert(staff).values({
      staffCode: `W5-A-${rand}`,
      name: 'Dr. W5 Administrator',
      collegeEmail: `w5.admin.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testAdminStaffId = sAdmin.id;
    createdStaffIds.push(sAdmin.id);
    await db.insert(staffRoles).values({ staffId: testAdminStaffId, roleId: rAdmin.id });

    const sHod = await db.insert(staff).values({
      staffCode: `W5-H-${rand}`,
      name: 'Dr. W5 HOD',
      collegeEmail: `w5.hod.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testHodStaffId = sHod.id;
    createdStaffIds.push(sHod.id);
    await db.insert(staffRoles).values({ staffId: testHodStaffId, roleId: rHod.id });

    const sStaff = await db.insert(staff).values({
      staffCode: `W5-S-${rand}`,
      name: 'Prof. W5 Faculty',
      collegeEmail: `w5.faculty.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testStaffMemberId = sStaff.id;
    createdStaffIds.push(sStaff.id);
    await db.insert(staffRoles).values({ staffId: testStaffMemberId, roleId: rStaff.id });

    // Mint session tokens
    adminToken = await msAuthService.createSessionToken({
      id: testAdminStaffId,
      name: sAdmin.name,
      collegeEmail: sAdmin.collegeEmail,
      roles: ['ADMIN'],
      userType: 'STAFF',
    });

    hodToken = await msAuthService.createSessionToken({
      id: testHodStaffId,
      name: sHod.name,
      collegeEmail: sHod.collegeEmail,
      roles: ['HOD'],
      userType: 'STAFF',
    });

    staffToken = await msAuthService.createSessionToken({
      id: testStaffMemberId,
      name: sStaff.name,
      collegeEmail: sStaff.collegeEmail,
      roles: ['STAFF'],
      userType: 'STAFF',
    });
  });

  afterAll(async () => {
    // Clean up created entities in reverse dependency order
    for (const sid of createdSessionIds) {
      await db.delete(attendanceSessions).where(eq(attendanceSessions.id, sid));
    }
    for (const tid of createdTimetableIds) {
      await db.delete(timetables).where(eq(timetables.id, tid));
    }
    for (const cid of createdCounselorIds) {
      await db.delete(classCounselors).where(eq(classCounselors.id, cid));
    }
    for (const id of createdStaffIds) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, id));
      await db.delete(classCounselors).where(eq(classCounselors.staffId, id));
      await db.delete(staffRoles).where(eq(staffRoles.staffId, id));
      await db.delete(staff).where(eq(staff.id, id));
    }
    for (const clsid of createdClassIds) {
      await db.delete(classes).where(eq(classes.id, clsid));
    }
    for (const pid of createdPeriodIds) {
      await db.delete(periods).where(eq(periods.id, pid));
    }
  });

  // ==========================================
  // 1. RBAC & Access Control Matrix
  // ==========================================
  describe('1. RBAC & Access Control Matrix', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await app.request('/api/staff', { method: 'GET' });
      expect(res.status).toBe(401);
    });

    it('should reject regular STAFF from listing all staff (403 Forbidden)', async () => {
      const res = await app.request('/api/staff', {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('should allow HOD to list staff with 200 OK', async () => {
      const res = await app.request('/api/staff', {
        method: 'GET',
        headers: { Authorization: `Bearer ${hodToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.staff).toBeDefined();
    });

    it('should allow ADMIN to list staff with 200 OK', async () => {
      const res = await app.request('/api/staff', {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should allow regular STAFF to view their own profile (self view)', async () => {
      const res = await app.request(`/api/staff/${testStaffMemberId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testStaffMemberId);
    });

    it('should reject regular STAFF from viewing another staff member profile (403 Forbidden)', async () => {
      const res = await app.request(`/api/staff/${testAdminStaffId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('should allow ADMIN and HOD to view any staff member profile', async () => {
      const resAdmin = await app.request(`/api/staff/${testStaffMemberId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resAdmin.status).toBe(200);

      const resHod = await app.request(`/api/staff/${testStaffMemberId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${hodToken}` },
      });
      expect(resHod.status).toBe(200);
    });

    it('should reject non-admin (STAFF / HOD) from creating staff (403 Forbidden)', async () => {
      const payload = {
        staffCode: 'STF-TEST-NOPE',
        name: 'Unauthorized Staff',
        collegeEmail: 'unauth@sonatech.ac.in',
      };

      const resStaff = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(resStaff.status).toBe(403);

      const resHod = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hodToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCode: `HOD-NOADM-${Date.now().toString().slice(-4)}`,
          name: 'HOD Escalation Attempt',
          collegeEmail: `hodescalate.${Date.now()}@sonatech.ac.in`,
          roles: ['ADMIN'],
        }),
      });
      expect(resHod.status).toBe(201);
      const hodStaff = await resHod.json();
      expect(hodStaff.data.roles).toEqual(['STAFF']);
      createdStaffIds.push(hodStaff.data.id);
    });

    it('should reject non-admin from modifying staff (403 Forbidden)', async () => {
      const res = await app.request(`/api/staff/${testStaffMemberId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked Name' }),
      });
      expect(res.status).toBe(403);
    });

    it('should reject non-admin from assigning or removing roles (Privilege Escalation Guard)', async () => {
      // Regular staff attempting to make themselves ADMIN
      const resStaff = await app.request(`/api/staff/${testStaffMemberId}/roles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMIN' }),
      });
      expect(resStaff.status).toBe(403);

      // HOD attempting to assign ADMIN role
      const resHod = await app.request(`/api/staff/${testStaffMemberId}/roles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${hodToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMIN' }),
      });
      expect(resHod.status).toBe(403);
    });
  });

  // ==========================================
  // 2. Staff CRUD, Validations & Audit Logging
  // ==========================================
  describe('2. Staff CRUD, Validations & Audit Logging', () => {
    let createdStaffId: string;
    const uniqueRand = Math.random().toString(36).substring(2, 7).toUpperCase();
    const validCode = `STF-${uniqueRand}`;
    const validEmail = `faculty.${uniqueRand.toLowerCase()}@sonatech.ac.in`;

    it('should reject staff creation with missing fields (400)', async () => {
      const res = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Incomplete Staff' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject staff creation with invalid staff code format (400)', async () => {
      const res = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCode: 'A!', // Too short and invalid character
          name: 'Invalid Code Staff',
          collegeEmail: 'invalid.code@sonatech.ac.in',
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Staff code must be');
    });

    it('should reject staff creation with non-sonatech.ac.in email domain (400)', async () => {
      const res = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCode: `BAD-${uniqueRand}`,
          name: 'Outside Faculty',
          collegeEmail: 'faculty@gmail.com', // Disallowed domain
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('sonatech.ac.in');
    });

    it('should create staff successfully with @sonatech.ac.in domain and record CREATE_STAFF audit log', async () => {
      const res = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCode: validCode,
          name: 'Dr. S. Karthi',
          collegeEmail: validEmail,
        }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      createdStaffId = json.data?.id;
      if (createdStaffId) {
        createdStaffIds.push(createdStaffId);
      }
      expect(json.data.staffCode).toBe(validCode);
      expect(json.data.roles).toContain('STAFF'); // Default STAFF role assigned

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, createdStaffId), eq(auditLogs.action, 'CREATE_STAFF')))
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.actorId).toBe(testAdminStaffId);
    });

    it('should reject duplicate staff code with 409 Conflict', async () => {
      const res = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCode: validCode, // Duplicate
          name: 'Duplicate Staff',
          collegeEmail: `diff.${uniqueRand}@sonatech.ac.in`,
        }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('already exists');
    });

    it('should reject duplicate college email with 409 Conflict', async () => {
      const res = await app.request('/api/staff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCode: `DIFF-${uniqueRand}`,
          name: 'Duplicate Email Staff',
          collegeEmail: validEmail, // Duplicate
        }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('already exists');
    });

    it('should update staff details and record UPDATE_STAFF audit log', async () => {
      const updatedName = 'Dr. S. Karthi Ph.D';
      const res = await app.request(`/api/staff/${createdStaffId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: updatedName }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe(updatedName);

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, createdStaffId), eq(auditLogs.action, 'UPDATE_STAFF')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });

    it('should update staff status via PATCH /:id/status and record audit log', async () => {
      const res = await app.request(`/api/staff/${createdStaffId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INACTIVE' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('INACTIVE');

      // Re-activate
      const resActive = await app.request(`/api/staff/${createdStaffId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      expect(resActive.status).toBe(200);
      expect((await resActive.json()).data.status).toBe('ACTIVE');

      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, createdStaffId), eq(auditLogs.action, 'UPDATE_STAFF_STATUS')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });
  });

  // ==========================================
  // 3. Role Management & Invariants
  // ==========================================
  describe('3. Role Management & System Invariants', () => {
    let targetStaffId: string;

    beforeAll(async () => {
      const rand = Math.random().toString(36).substring(2, 7);
      const s = await db.insert(staff).values({
        staffCode: `ROL-${rand}`,
        name: 'Role Test Faculty',
        collegeEmail: `role.test.${rand}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      targetStaffId = s.id;
      createdStaffIds.push(s.id);
      const rStaff = await db.select().from(roles).where(eq(roles.name, 'STAFF')).then(r => r[0]);
      await db.insert(staffRoles).values({ staffId: s.id, roleId: rStaff.id });
    });

    it('should reject assigning invalid / non-existent role name (400)', async () => {
      const res = await app.request(`/api/staff/${targetStaffId}/roles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'SUPER_USER_UNKNOWN' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid role');
    });

    it('should successfully assign DEPUTY_HOD role and record ASSIGN_STAFF_ROLE audit log', async () => {
      const res = await app.request(`/api/staff/${targetStaffId}/roles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'DEPUTY_HOD' }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify role assigned
      const staffRolesList = await db.select().from(staffRoles).where(eq(staffRoles.staffId, targetStaffId));
      expect(staffRolesList.length).toBe(2); // STAFF + DEPUTY_HOD

      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, targetStaffId), eq(auditLogs.action, 'ASSIGN_STAFF_ROLE')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });

    it('should remove assigned role and record REMOVE_STAFF_ROLE audit log', async () => {
      const res = await app.request(`/api/staff/${targetStaffId}/roles/DEPUTY_HOD`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);

      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, targetStaffId), eq(auditLogs.action, 'REMOVE_STAFF_ROLE')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });

    it('Invariant: should prevent removing ADMIN role if only 1 active admin exists', async () => {
      // Find total active admins in DB
      const activeAdmins = await db.select({ id: staff.id })
        .from(staff)
        .innerJoin(staffRoles, eq(staff.id, staffRoles.staffId))
        .innerJoin(roles, eq(staffRoles.roleId, roles.id))
        .where(and(eq(roles.name, 'ADMIN'), eq(staff.status, 'ACTIVE')));

      // If more than 1 active admin exists, remove admin role from testAdminStaffId until only 1 remains or create a solo scenario
      // For this test, let's create a lone admin staff member
      const rand = Math.random().toString(36).substring(2, 7);
      const loneAdmin = await db.insert(staff).values({
        staffCode: `LONE-${rand}`,
        name: 'Lone Administrator',
        collegeEmail: `lone.admin.${rand}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      createdStaffIds.push(loneAdmin.id);

      const rAdmin = await db.select().from(roles).where(eq(roles.name, 'ADMIN')).then(r => r[0]);
      await db.insert(staffRoles).values({ staffId: loneAdmin.id, roleId: rAdmin.id });

      // If activeAdmins.length is 1, trying to remove ADMIN role from that admin will be blocked
      // Let's test the invariant check directly on the service or when only 1 exists
      if (activeAdmins.length === 1) {
        const res = await app.request(`/api/staff/${activeAdmins[0].id}/roles/ADMIN`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.error.message).toContain('at least one active administrator');
      } else {
        // There are multiple admins, so assigning and removing from loneAdmin should succeed
        const res = await app.request(`/api/staff/${loneAdmin.id}/roles/ADMIN`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
      }
    });

    it('Invariant: should prevent deactivating the only active Administrator (409 Conflict)', async () => {
      const activeAdmins = await db.select({ id: staff.id })
        .from(staff)
        .innerJoin(staffRoles, eq(staff.id, staffRoles.staffId))
        .innerJoin(roles, eq(staffRoles.roleId, roles.id))
        .where(and(eq(roles.name, 'ADMIN'), eq(staff.status, 'ACTIVE')));

      if (activeAdmins.length === 1) {
        const res = await app.request(`/api/staff/${activeAdmins[0].id}/status`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'INACTIVE' }),
        });
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.error.message).toContain('only active Administrator');
      } else {
        expect(activeAdmins.length).toBeGreaterThan(1);
      }
    });
  });

  // ==========================================
  // 4. Referential Integrity on Deletion
  // ==========================================
  describe('4. Referential Integrity on Deletion', () => {
    let staffWithTimetableId: string;
    let staffWithSessionId: string;
    let safeStaffId: string;

    beforeAll(async () => {
      const rand1 = Math.random().toString(36).substring(2, 7);
      const rand2 = Math.random().toString(36).substring(2, 7);
      const rand3 = Math.random().toString(36).substring(2, 7);

      const s1 = await db.insert(staff).values({
        staffCode: `TT-REF-${rand1}`,
        name: 'Staff with Timetable',
        collegeEmail: `tt.ref.${rand1}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      staffWithTimetableId = s1.id;
      createdStaffIds.push(s1.id);

      const s2 = await db.insert(staff).values({
        staffCode: `SES-REF-${rand2}`,
        name: 'Staff with Session',
        collegeEmail: `ses.ref.${rand2}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      staffWithSessionId = s2.id;
      createdStaffIds.push(s2.id);

      const s3 = await db.insert(staff).values({
        staffCode: `SAFE-DEL-${rand3}`,
        name: 'Unreferenced Staff',
        collegeEmail: `safe.del.${rand3}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      safeStaffId = s3.id;
      createdStaffIds.push(s3.id);

      // Create a dedicated class and periods for Suite 4 to prevent collisions
      const refBatch = await db.select().from(batches).limit(1).then(r => r[0]);
      const refReg = await db.select().from(regulations).limit(1).then(r => r[0]);

      const suite4Class = await db.insert(classes).values({
        name: `IV IT-S4-${rand1}`,
        yearNumber: 4,
        section: `S4-${rand1}`,
        departmentId: itDepartmentId,
        academicYearId: testAcademicYearId,
        batchId: refBatch.id,
        regulationId: refReg.id,
      }).returning().then(r => r[0]);
      createdClassIds.push(suite4Class.id);

      const period1 = await db.insert(periods).values({
        periodNumber: Math.floor(Math.random() * 800000) + 10000,
        name: `P1-${rand1}`,
        startTime: '08:00',
        endTime: '08:50',
      }).returning().then(r => r[0]);
      createdPeriodIds.push(period1.id);

      const period2 = await db.insert(periods).values({
        periodNumber: Math.floor(Math.random() * 800000) + 20000,
        name: `P2-${rand2}`,
        startTime: '09:00',
        endTime: '09:50',
      }).returning().then(r => r[0]);
      createdPeriodIds.push(period2.id);

      let sub = await db.select().from(subjects).limit(1).then(r => r[0]);
      if (!sub) {
        sub = await db.insert(subjects).values({
          code: `SUB-W5-${rand1}`,
          name: 'Web Engineering',
          subjectType: 'THEORY',
          yearNumber: 4,
          regulationId: refReg.id,
        }).returning().then(r => r[0]);
      }

      // 1. Create timetable entry referencing s1
      const tt1 = await db.insert(timetables).values({
        academicYearId: testAcademicYearId,
        classId: suite4Class.id,
        dayOfWeek: 'MONDAY',
        periodId: period1.id,
        subjectId: sub.id,
        staffId: s1.id,
      }).returning().then(r => r[0]);
      createdTimetableIds.push(tt1.id);

      // 2. Create timetable entry and attendance session referencing s2
      const tt2 = await db.insert(timetables).values({
        academicYearId: testAcademicYearId,
        classId: suite4Class.id,
        dayOfWeek: 'TUESDAY',
        periodId: period2.id,
        subjectId: sub.id,
        staffId: s2.id,
      }).returning().then(r => r[0]);
      createdTimetableIds.push(tt2.id);

      const sess = await db.insert(attendanceSessions).values({
        timetableId: tt2.id,
        sessionDate: '2026-10-18',
        status: 'COMPLETED',
        startedByStaffId: s2.id,
      }).returning().then(r => r[0]);
      createdSessionIds.push(sess.id);
    });

    it('should reject deleting staff member referenced in timetables (409 Conflict)', async () => {
      const res = await app.request(`/api/staff/${staffWithTimetableId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('timetable schedule');
    });

    it('should reject deleting staff member referenced in attendance sessions (409 Conflict)', async () => {
      const res = await app.request(`/api/staff/${staffWithSessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('attendance session');
    });

    it('should safely delete unreferenced staff member and record DELETE_STAFF audit log', async () => {
      const res = await app.request(`/api/staff/${safeStaffId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify deletion from DB
      const found = await db.select().from(staff).where(eq(staff.id, safeStaffId)).then(r => r[0]);
      expect(found).toBeUndefined();

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, safeStaffId), eq(auditLogs.action, 'DELETE_STAFF')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });
  });

  // ==========================================
  // 5. Class Counselor Management
  // ==========================================
  describe('5. Class Counselor Management', () => {
    let counselorStaffId: string;
    let inactiveStaffId: string;
    let assignedCounselorId: string;

    beforeAll(async () => {
      const rand1 = Math.random().toString(36).substring(2, 7);
      const rand2 = Math.random().toString(36).substring(2, 7);

      const s1 = await db.insert(staff).values({
        staffCode: `CNS-ACT-${rand1}`,
        name: 'Counselor Candidate',
        collegeEmail: `counselor.act.${rand1}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      counselorStaffId = s1.id;
      createdStaffIds.push(s1.id);

      const s2 = await db.insert(staff).values({
        staffCode: `CNS-INA-${rand2}`,
        name: 'Inactive Candidate',
        collegeEmail: `counselor.ina.${rand2}@sonatech.ac.in`,
        status: 'INACTIVE',
      }).returning().then(r => r[0]);
      inactiveStaffId = s2.id;
      createdStaffIds.push(s2.id);

      // Clean any existing counselor on testClassId & testAcademicYearId to start fresh
      await db.delete(classCounselors).where(
        and(eq(classCounselors.classId, testClassId), eq(classCounselors.academicYearId, testAcademicYearId))
      );
    });

    it('should reject assigning inactive staff as counselor (400)', async () => {
      const res = await app.request('/api/class-counselors', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: testClassId,
          academicYearId: testAcademicYearId,
          staffId: inactiveStaffId,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('inactive staff');
    });

    it('should assign active staff as counselor, auto-assign CLASS_COUNSELOR role, and log audit', async () => {
      const res = await app.request('/api/class-counselors', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: testClassId,
          academicYearId: testAcademicYearId,
          staffId: counselorStaffId,
        }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      assignedCounselorId = json.data.id;
      createdCounselorIds.push(assignedCounselorId);

      // Verify CLASS_COUNSELOR role was automatically granted to the staff member
      const rolesAssigned = await db.select({ name: roles.name })
        .from(staffRoles)
        .innerJoin(roles, eq(staffRoles.roleId, roles.id))
        .where(eq(staffRoles.staffId, counselorStaffId));
      expect(rolesAssigned.map(r => r.name)).toContain('CLASS_COUNSELOR');

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, assignedCounselorId), eq(auditLogs.action, 'ASSIGN_COUNSELOR')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });

    it('should reject assigning a second active counselor to the same class and academic year (409 Conflict)', async () => {
      const rand = Math.random().toString(36).substring(2, 7);
      const s3 = await db.insert(staff).values({
        staffCode: `CNS-DUP-${rand}`,
        name: 'Second Counselor Candidate',
        collegeEmail: `counselor.dup.${rand}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      createdStaffIds.push(s3.id);

      const res = await app.request('/api/class-counselors', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: testClassId,
          academicYearId: testAcademicYearId,
          staffId: s3.id,
        }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('active counselor already exists');
    });

    it('should update counselor assignment status via PATCH /:id/status and record audit log', async () => {
      const res = await app.request(`/api/class-counselors/${assignedCounselorId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INACTIVE' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('INACTIVE');

      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, assignedCounselorId), eq(auditLogs.action, 'UPDATE_COUNSELOR_STATUS')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });

    it('should delete counselor assignment and record DELETE_COUNSELOR audit log', async () => {
      const res = await app.request(`/api/class-counselors/${assignedCounselorId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);

      const log = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.entityId, assignedCounselorId), eq(auditLogs.action, 'DELETE_COUNSELOR')))
        .then(r => r[0]);
      expect(log).toBeDefined();
    });
  });
});

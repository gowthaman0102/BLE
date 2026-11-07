import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { msAuthService } from '../src/services/session-token.service';
import { db } from '../src/db';
import { departments, academicYears, batches, regulations, classes } from '../src/db/schema/academic';
import { students } from '../src/db/schema/students';
import { auditLogs } from '../src/db/schema/audit';
import { staff, roles, staffRoles } from '../src/db/schema/staff';
import { eq, desc } from 'drizzle-orm';
import app from '../src/index';

describe('Phase W3 — Academic Master Data Integration Test Suite', () => {
  let adminToken: string;
  let hodToken: string;
  let staffToken: string;
  let itDepartmentId: string;
  let activeAcademicYearId: string;
  let activeBatchId: string;
  let activeRegulationId: string;
  let activeClassId: string;

  let testAdminStaffId: string;
  let testHodStaffId: string;
  let testStaffMemberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';

    // Ensure IT Department exists
    let dept = await db.select().from(departments).where(eq(departments.code, 'IT')).then(r => r[0]);
    if (!dept) {
      dept = await db.insert(departments).values({
        name: 'Information Technology',
        code: 'IT',
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }
    itDepartmentId = dept.id;

    // Ensure a reference class exists in the IT department for constraint testing
    let itClass = await db.select().from(classes).where(eq(classes.departmentId, itDepartmentId)).limit(1).then(r => r[0]);
    if (!itClass) {
      let ay = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).then(r => r[0]);
      if (!ay) {
        ay = await db.insert(academicYears).values({ name: 'AY-Ref-Test', startDate: new Date('2026-06-01'), endDate: new Date('2027-05-31'), isCurrent: true, status: 'ACTIVE' }).returning().then(r => r[0]);
      }
      let reg = await db.select().from(regulations).limit(1).then(r => r[0]);
      if (!reg) {
        reg = await db.insert(regulations).values({ name: 'R-Ref-Test', year: 2026, status: 'ACTIVE' }).returning().then(r => r[0]);
      }
      let b = await db.select().from(batches).where(eq(batches.departmentId, itDepartmentId)).limit(1).then(r => r[0]);
      if (!b) {
        b = await db.insert(batches).values({ name: 'IT-Batch-Ref-Test', departmentId: itDepartmentId, startYear: 2024, endYear: 2028, status: 'ACTIVE' }).returning().then(r => r[0]);
      }
      itClass = await db.insert(classes).values({
        name: 'I IT-REF-TEST',
        departmentId: itDepartmentId,
        academicYearId: ay.id,
        batchId: b.id,
        regulationId: reg.id,
        yearNumber: 1,
        section: 'Z',
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }
    activeClassId = itClass.id;
    activeBatchId = itClass.batchId;
    activeAcademicYearId = itClass.academicYearId;
    activeRegulationId = itClass.regulationId;

    const hasStudent = await db.select().from(students).where(eq(students.classId, itClass.id)).limit(1).then(r => r[0]);
    if (!hasStudent) {
      await db.insert(students).values({
        registerNumber: `REF-${Date.now().toString().slice(-6)}`,
        name: 'Ref Student',
        collegeEmail: `ref.student.${Date.now()}@sonatech.ac.in`,
        classId: itClass.id,
      });
    }

    // Ensure roles exist
    let rAdmin = await db.select().from(roles).where(eq(roles.name, 'ADMIN')).then(r => r[0]);
    if (!rAdmin) {
      rAdmin = await db.insert(roles).values({ name: 'ADMIN', description: 'System Administrator' }).returning().then(r => r[0]);
    }
    let rHod = await db.select().from(roles).where(eq(roles.name, 'HOD')).then(r => r[0]);
    if (!rHod) {
      rHod = await db.insert(roles).values({ name: 'HOD', description: 'Head of Department' }).returning().then(r => r[0]);
    }
    let rStaff = await db.select().from(roles).where(eq(roles.name, 'STAFF')).then(r => r[0]);
    if (!rStaff) {
      rStaff = await db.insert(roles).values({ name: 'STAFF', description: 'Faculty' }).returning().then(r => r[0]);
    }

    // Insert real test staff in DB to satisfy database verification
    const rand = Math.random().toString(36).substring(2, 7);
    const sAdmin = await db.insert(staff).values({
      staffCode: `T-A-${rand}`,
      name: 'Dr. Test Administrator',
      collegeEmail: `test.admin.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testAdminStaffId = sAdmin.id;
    await db.insert(staffRoles).values({ staffId: testAdminStaffId, roleId: rAdmin.id });

    const sHod = await db.insert(staff).values({
      staffCode: `T-H-${rand}`,
      name: 'Dr. Test HOD',
      collegeEmail: `test.hod.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testHodStaffId = sHod.id;
    await db.insert(staffRoles).values({ staffId: testHodStaffId, roleId: rHod.id });

    const sStaff = await db.insert(staff).values({
      staffCode: `T-S-${rand}`,
      name: 'Test Faculty Member',
      collegeEmail: `test.faculty.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testStaffMemberId = sStaff.id;
    await db.insert(staffRoles).values({ staffId: testStaffMemberId, roleId: rStaff.id });

    // Mint session tokens with database-verified principals
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
    // Clean up test audit logs and staff
    if (testAdminStaffId) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, testAdminStaffId));
      await db.delete(staffRoles).where(eq(staffRoles.staffId, testAdminStaffId));
      await db.delete(staff).where(eq(staff.id, testAdminStaffId));
    }
    if (testHodStaffId) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, testHodStaffId));
      await db.delete(staffRoles).where(eq(staffRoles.staffId, testHodStaffId));
      await db.delete(staff).where(eq(staff.id, testHodStaffId));
    }
    if (testStaffMemberId) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, testStaffMemberId));
      await db.delete(staffRoles).where(eq(staffRoles.staffId, testStaffMemberId));
      await db.delete(staff).where(eq(staff.id, testStaffMemberId));
    }
  });

  // ==========================================
  // 1. RBAC & ENDPOINT AUTHORIZATION
  // ==========================================
  describe('1. RBAC & Endpoint Authorization', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await app.request('/api/academic-years');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should allow STAFF to read academic data (GET)', async () => {
      const res = await app.request('/api/academic-years', {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should forbid STAFF from creating academic years (POST) with 403', async () => {
      const res = await app.request('/api/academic-years', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2099-2100',
          startDate: '2099-06-01',
          endDate: '2100-05-31',
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should forbid STAFF from updating academic years (PATCH) with 403', async () => {
      const res = await app.request(`/api/academic-years/${activeAcademicYearId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Tampered Year' }),
      });
      expect(res.status).toBe(403);
    });

    it('should forbid STAFF from deleting academic years (DELETE) with 403', async () => {
      const res = await app.request(`/api/academic-years/${activeAcademicYearId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('should forbid STAFF from mutating batches, regulations, and classes with 403', async () => {
      const resBatch = await app.request('/api/batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Batch X', startYear: 2024, endYear: 2028 }),
      });
      expect(resBatch.status).toBe(403);

      const resReg = await app.request('/api/regulations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'R2030', year: 2030 }),
      });
      expect(resReg.status).toBe(403);

      const resClass = await app.request('/api/classes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearNumber: 1, section: 'A' }),
      });
      expect(resClass.status).toBe(403);
    });
  });

  // ==========================================
  // 2. ACADEMIC YEARS
  // ==========================================
  describe('2. Academic Years Management', () => {
    let createdAyId: string;
    const testAyName = `AY-${Date.now()}`;

    it('should validate that startDate < endDate (reject with 400)', async () => {
      const res = await app.request('/api/academic-years', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `INVALID-${Date.now()}`,
          startDate: '2027-06-01',
          endDate: '2026-05-31', // End date is before start date!
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Start date must be before end date');
    });

    it('should successfully create a new academic year by HOD and log audit entry', async () => {
      const res = await app.request('/api/academic-years', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hodToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testAyName,
          startDate: '2028-06-01T00:00:00.000Z',
          endDate: '2029-05-31T00:00:00.000Z',
          isCurrent: false,
          status: 'ACTIVE',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe(testAyName);
      createdAyId = body.data.id;

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdAyId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('CREATE_ACADEMIC_YEAR');
      expect(log.actorRole).toBe('HOD');
    });

    it('should reject duplicate academic year name with 409 Conflict', async () => {
      const res = await app.request('/api/academic-years', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testAyName,
          startDate: '2028-06-01T00:00:00.000Z',
          endDate: '2029-05-31T00:00:00.000Z',
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already exists');
    });

    it('should enforce single current academic year invariant when updating isCurrent: true', async () => {
      // Set test AY to current
      const res = await app.request(`/api/academic-years/${createdAyId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCurrent: true }),
      });
      expect(res.status).toBe(200);

      // Verify that previously active AY is now isCurrent = false
      const prevAY = await db.select().from(academicYears).where(eq(academicYears.id, activeAcademicYearId)).then(r => r[0]);
      expect(prevAY.isCurrent).toBe(false);

      const currAY = await db.select().from(academicYears).where(eq(academicYears.id, createdAyId)).then(r => r[0]);
      expect(currAY.isCurrent).toBe(true);

      // Restore activeAcademicYearId as current
      await app.request(`/api/academic-years/${activeAcademicYearId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCurrent: true }),
      });
    });

    it('should prevent deletion of academic year with linked classes (409 Conflict)', async () => {
      const res = await app.request(`/api/academic-years/${activeAcademicYearId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Cannot delete academic year');
    });

    it('should safely delete unreferenced academic year and write audit log', async () => {
      const res = await app.request(`/api/academic-years/${createdAyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdAyId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('DELETE_ACADEMIC_YEAR');
    });
  });

  // ==========================================
  // 3. BATCHES
  // ==========================================
  describe('3. Batches Management', () => {
    let createdBatchId: string;
    const testBatchName = `BATCH-${Date.now()}`;

    it('should reject startYear >= endYear with 400', async () => {
      const res = await app.request('/api/batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `INVALID-${Date.now()}`,
          startYear: 2028,
          endYear: 2026,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should automatically default departmentId to IT department when omitted', async () => {
      const res = await app.request('/api/batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hodToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testBatchName,
          startYear: 2026,
          endYear: 2030,
          status: 'ACTIVE',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.departmentId).toBe(itDepartmentId);
      createdBatchId = body.data.id;

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdBatchId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('CREATE_BATCH');
    });

    it('should reject duplicate batch name in the same department with 409 Conflict', async () => {
      const res = await app.request('/api/batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testBatchName,
          startYear: 2026,
          endYear: 2030,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
    });

    it('should prevent deletion of batch referenced by classes (409 Conflict)', async () => {
      const res = await app.request(`/api/batches/${activeBatchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Cannot delete batch');
    });

    it('should safely delete unreferenced batch and record audit log', async () => {
      const res = await app.request(`/api/batches/${createdBatchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);

      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdBatchId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('DELETE_BATCH');
    });
  });

  // ==========================================
  // 4. REGULATIONS
  // ==========================================
  describe('4. Regulations Management', () => {
    let createdRegId: string;
    const testRegName = `R-${Date.now().toString().slice(-4)}`;

    it('should reject regulation with invalid year with 400', async () => {
      const res = await app.request('/api/regulations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `INV-${Date.now()}`,
          year: 1800, // Invalid year
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should create regulation by HOD and log audit entry', async () => {
      const res = await app.request('/api/regulations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hodToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testRegName,
          year: 2026,
          description: 'Test Regulation for Unit Testing',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe(testRegName);
      createdRegId = body.data.id;

      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdRegId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('CREATE_REGULATION');
    });

    it('should reject duplicate regulation name with 409 Conflict', async () => {
      const res = await app.request('/api/regulations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testRegName,
          year: 2026,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
    });

    it('should prevent deletion of regulation referenced by classes or subjects (409 Conflict)', async () => {
      const res = await app.request(`/api/regulations/${activeRegulationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Cannot delete regulation');
    });

    it('should safely delete unreferenced regulation and record audit log', async () => {
      const res = await app.request(`/api/regulations/${createdRegId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);

      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdRegId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('DELETE_REGULATION');
    });
  });

  // ==========================================
  // 5. CLASSES
  // ==========================================
  describe('5. Classes Management', () => {
    let createdClassId: string;
    const testSection = `Z${Date.now().toString().slice(-2)}`;

    it('should reject yearNumber outside 1-4 with 400', async () => {
      const res = await app.request('/api/classes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yearNumber: 5, // Invalid year
          section: 'A',
          academicYearId: activeAcademicYearId,
          batchId: activeBatchId,
          regulationId: activeRegulationId,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Year number must be between 1 and 4');
    });

    it('should reject empty section with 400', async () => {
      const res = await app.request('/api/classes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yearNumber: 1,
          section: '   ',
          academicYearId: activeAcademicYearId,
          batchId: activeBatchId,
          regulationId: activeRegulationId,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should auto-generate class name and default department to IT', async () => {
      const res = await app.request('/api/classes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hodToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yearNumber: 1,
          section: testSection,
          academicYearId: activeAcademicYearId,
          batchId: activeBatchId,
          regulationId: activeRegulationId,
          status: 'ACTIVE',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.departmentId).toBe(itDepartmentId);
      expect(body.data.name).toBe(`I IT-${testSection}`);
      createdClassId = body.data.id;

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdClassId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('CREATE_CLASS');
    });

    it('should reject duplicate class (same dept, academic year, year number, and section) with 409 Conflict', async () => {
      const res = await app.request('/api/classes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yearNumber: 1,
          section: testSection,
          academicYearId: activeAcademicYearId,
          batchId: activeBatchId,
          regulationId: activeRegulationId,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already exists');
    });

    it('should prevent deletion of class with enrolled students or subjects (409 Conflict)', async () => {
      const res = await app.request(`/api/classes/${activeClassId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Cannot delete class');
    });

    it('should safely delete unreferenced class and record audit log', async () => {
      const res = await app.request(`/api/classes/${createdClassId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);

      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, createdClassId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.action).toBe('DELETE_CLASS');
    });
  });
});

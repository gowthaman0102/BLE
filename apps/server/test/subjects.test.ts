import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { msAuthService } from '../src/services/session-token.service';
import { db } from '../src/db';
import { departments, academicYears, batches, regulations, classes } from '../src/db/schema/academic';
import { staff, roles, staffRoles } from '../src/db/schema/staff';
import { subjects, classSubjects } from '../src/db/schema/subjects';
import { timetables, periods, timetableOverrides } from '../src/db/schema/timetable';
import { auditLogs } from '../src/db/schema/audit';
import { eq, and, sql } from 'drizzle-orm';
import app from '../src/index';

describe('Phase W6 — Subject Management & Class-Subject Mapping Integration Test Suite', () => {
  let adminToken: string;
  let hodToken: string;
  let staffToken: string;

  let testAdminStaffId: string;
  let testHodStaffId: string;
  let testStaffMemberId: string;

  let itDepartmentId: string;
  let testAcademicYearId: string;
  let testRegulationR21Id: string;
  let testRegulationR23Id: string;
  let testBatchId: string;

  let testClassYear2Id: string;
  let testClassYear3Id: string;
  let testPeriodId: string;

  const createdSubjectIds: string[] = [];
  const createdClassSubjectIds: string[] = [];
  const createdTimetableIds: string[] = [];
  const createdOverrideIds: string[] = [];
  const createdStaffIds: string[] = [];
  const createdClassIds: string[] = [];
  const createdRegulationIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdAcademicYearIds: string[] = [];

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

    // 2. Dedicated Academic Year for W6 tests
    const rand = Math.random().toString(36).substring(2, 6);
    const ay = await db.insert(academicYears).values({
      name: `AY-W6-${Date.now()}-${rand}`,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2027-05-31'),
      isCurrent: false,
    }).returning().then(r => r[0]);
    testAcademicYearId = ay.id;
    createdAcademicYearIds.push(ay.id);

    // 3. Regulations
    const reg1 = await db.insert(regulations).values({
      name: `R2021-W6-${rand}`,
      year: 2021,
    }).returning().then(r => r[0]);
    testRegulationR21Id = reg1.id;
    createdRegulationIds.push(reg1.id);

    const reg2 = await db.insert(regulations).values({
      name: `R2023-W6-${rand}`,
      year: 2023,
    }).returning().then(r => r[0]);
    testRegulationR23Id = reg2.id;
    createdRegulationIds.push(reg2.id);

    // 4. Batch
    const batch = await db.insert(batches).values({
      name: `BATCH-W6-${rand}`,
      startYear: 2024,
      endYear: 2028,
      departmentId: itDepartmentId,
    }).returning().then(r => r[0]);
    testBatchId = batch.id;
    createdBatchIds.push(batch.id);

    // 5. Classes
    const cls2 = await db.insert(classes).values({
      name: `II IT-A-${rand}`,
      yearNumber: 2,
      section: 'A',
      departmentId: itDepartmentId,
      academicYearId: testAcademicYearId,
      batchId: testBatchId,
      regulationId: testRegulationR21Id,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testClassYear2Id = cls2.id;
    createdClassIds.push(cls2.id);

    const cls3 = await db.insert(classes).values({
      name: `III IT-A-${rand}`,
      yearNumber: 3,
      section: 'A',
      departmentId: itDepartmentId,
      academicYearId: testAcademicYearId,
      batchId: testBatchId,
      regulationId: testRegulationR21Id,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testClassYear3Id = cls3.id;
    createdClassIds.push(cls3.id);

    // 6. Period
    let period = await db.select().from(periods).where(eq(periods.periodNumber, 1)).then(r => r[0]);
    if (!period) {
      period = await db.insert(periods).values({
        periodNumber: 1,
        name: 'Period 1',
        startTime: '09:00:00',
        endTime: '09:50:00',
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }
    testPeriodId = period.id;

    // 7. Roles & Staff
    const roleNames = ['ADMIN', 'HOD', 'STAFF'];
    for (const rName of roleNames) {
      const existing = await db.select().from(roles).where(eq(roles.name, rName)).then(r => r[0]);
      if (!existing) {
        await db.insert(roles).values({ name: rName, description: `${rName} Role` });
      }
    }
    const rAdmin = await db.select().from(roles).where(eq(roles.name, 'ADMIN')).then(r => r[0]);
    const rHod = await db.select().from(roles).where(eq(roles.name, 'HOD')).then(r => r[0]);
    const rStaff = await db.select().from(roles).where(eq(roles.name, 'STAFF')).then(r => r[0]);

    const sAdmin = await db.insert(staff).values({
      staffCode: `W6-A-${rand}`,
      name: 'Dr. W6 Administrator',
      collegeEmail: `w6.admin.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testAdminStaffId = sAdmin.id;
    createdStaffIds.push(sAdmin.id);
    await db.insert(staffRoles).values({ staffId: testAdminStaffId, roleId: rAdmin.id });

    const sHod = await db.insert(staff).values({
      staffCode: `W6-H-${rand}`,
      name: 'Dr. W6 HOD',
      collegeEmail: `w6.hod.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testHodStaffId = sHod.id;
    createdStaffIds.push(sHod.id);
    await db.insert(staffRoles).values({ staffId: testHodStaffId, roleId: rHod.id });

    const sStaff = await db.insert(staff).values({
      staffCode: `W6-S-${rand}`,
      name: 'Prof. W6 Faculty',
      collegeEmail: `w6.faculty.${Date.now()}.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testStaffMemberId = sStaff.id;
    createdStaffIds.push(sStaff.id);
    await db.insert(staffRoles).values({ staffId: testStaffMemberId, roleId: rStaff.id });

    // Mint Tokens
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
    // Clean up timetable overrides
    for (const ovId of createdOverrideIds) {
      await db.delete(timetableOverrides).where(eq(timetableOverrides.id, ovId)).catch(() => {});
    }
    // Clean up timetables
    for (const ttId of createdTimetableIds) {
      await db.delete(timetables).where(eq(timetables.id, ttId)).catch(() => {});
    }
    // Clean up class subjects
    for (const csId of createdClassSubjectIds) {
      await db.delete(classSubjects).where(eq(classSubjects.id, csId)).catch(() => {});
    }
    // Clean up subjects
    for (const subId of createdSubjectIds) {
      await db.delete(subjects).where(eq(subjects.id, subId)).catch(() => {});
    }
    // Clean up classes
    for (const clsId of createdClassIds) {
      await db.delete(classes).where(eq(classes.id, clsId)).catch(() => {});
    }
    // Clean up batches
    for (const bId of createdBatchIds) {
      await db.delete(batches).where(eq(batches.id, bId)).catch(() => {});
    }
    // Clean up regulations
    for (const regId of createdRegulationIds) {
      await db.delete(regulations).where(eq(regulations.id, regId)).catch(() => {});
    }
    // Clean up academic years
    for (const ayId of createdAcademicYearIds) {
      await db.delete(academicYears).where(eq(academicYears.id, ayId)).catch(() => {});
    }
    // Clean up staff
    for (const sId of createdStaffIds) {
      await db.delete(staffRoles).where(eq(staffRoles.staffId, sId)).catch(() => {});
      await db.delete(staff).where(eq(staff.id, sId)).catch(() => {});
    }
  });

  // ==========================================
  // 1. RBAC & PERMISSION CHECKS
  // ==========================================
  describe('1. RBAC and Authorization Matrix', () => {
    it('should reject unauthenticated request to /api/subjects with 401', async () => {
      const res = await app.request('/api/subjects', { method: 'GET' });
      expect(res.status).toBe(401);
    });

    it('should permit STAFF role to read subjects list with 200', async () => {
      const res = await app.request('/api/subjects', {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.subjects)).toBe(true);
    });

    it('should permit STAFF role to read subject stats with 200', async () => {
      const res = await app.request('/api/subjects/stats', {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('total');
      expect(json.data).toHaveProperty('active');
    });

    it('should forbid STAFF role from creating a subject (403 Forbidden)', async () => {
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: 'TEST-FORBIDDEN',
          name: 'Forbidden Subject',
          subjectType: 'THEORY',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('should forbid STAFF role from mutating a subject via PATCH (403 Forbidden)', async () => {
      const res = await app.request(`/api/subjects/00000000-0000-0000-0000-000000000000`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Hacked Name' }),
      });
      expect(res.status).toBe(403);
    });

    it('should forbid STAFF role from deleting a subject (403 Forbidden)', async () => {
      const res = await app.request(`/api/subjects/00000000-0000-0000-0000-000000000000`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('should forbid STAFF role from assigning a subject to a class (403 Forbidden)', async () => {
      const res = await app.request('/api/class-subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classId: testClassYear2Id,
          subjectId: '00000000-0000-0000-0000-000000000000',
          academicYearId: testAcademicYearId,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('should permit HOD role to create a subject with 201', async () => {
      const code = `IT${Date.now().toString().slice(-4)}HOD`;
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hodToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          name: 'HOD Created Subject',
          subjectType: 'THEORY',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.code).toBe(code.toUpperCase());
      createdSubjectIds.push(json.data.id);
    });
  });

  // ==========================================
  // 2. INPUT VALIDATION & DUPLICATE CHECKS
  // ==========================================
  describe('2. Subject Input Validation', () => {
    it('should reject missing required fields with 400', async () => {
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: '',
          name: '',
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid yearNumber (< 1 or > 4) with 400', async () => {
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: `IT-YR5-${Date.now().toString().slice(-4)}`,
          name: 'Year 5 Subject',
          subjectType: 'THEORY',
          yearNumber: 5,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Year number must be an integer between 1 and 4');
    });

    it('should reject invalid subjectType with 400', async () => {
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: `IT-TYP-${Date.now().toString().slice(-4)}`,
          name: 'Invalid Type Subject',
          subjectType: 'INVALID_TYPE',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Subject type must be one of');
    });

    it('should reject non-existent regulationId with 404', async () => {
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: `IT-REG-${Date.now().toString().slice(-4)}`,
          name: 'Nonexistent Regulation Subject',
          subjectType: 'THEORY',
          yearNumber: 2,
          regulationId: '00000000-0000-0000-0000-000000000000',
        }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Regulation not found');
    });

    it('should reject duplicate subject code with 409 Conflict', async () => {
      const code = `IT${Date.now().toString().slice(-4)}DUP`;
      // First create
      const res1 = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          name: 'Original Subject',
          subjectType: 'THEORY',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res1.status).toBe(201);
      const json1 = await res1.json();
      createdSubjectIds.push(json1.data.id);

      // Attempt second create with identical code
      const res2 = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          name: 'Duplicate Subject',
          subjectType: 'LAB',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res2.status).toBe(409);
      const json2 = await res2.json();
      expect(json2.error.code).toBe('CONFLICT');
      expect(json2.error.message).toContain('already exists');
    });

    it('should reject case-insensitive duplicate subject code with 409 Conflict', async () => {
      const code = `it${Date.now().toString().slice(-4)}cas`;
      // Create with lowercase
      const res1 = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          name: 'Case Test Subject',
          subjectType: 'THEORY',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res1.status).toBe(201);
      const json1 = await res1.json();
      createdSubjectIds.push(json1.data.id);

      // Attempt duplicate with uppercase
      const res2 = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: code.toUpperCase(),
          name: 'Case Test Duplicate',
          subjectType: 'THEORY',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
        }),
      });
      expect(res2.status).toBe(409);
    });
  });

  // ==========================================
  // 3. SUBJECT CRUD & STATUS TOGGLING
  // ==========================================
  describe('3. Subject CRUD and Status Toggling', () => {
    let subjectId: string;
    const baseCode = `IT${Date.now().toString().slice(-4)}CRUD`;

    it('should create a new LAB subject with 201', async () => {
      const res = await app.request('/api/subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: baseCode,
          name: 'Data Structures and Algorithms Laboratory',
          description: 'Hands-on practice with linear and non-linear data structures',
          subjectType: 'LAB',
          yearNumber: 2,
          regulationId: testRegulationR21Id,
          status: 'ACTIVE',
        }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.code).toBe(baseCode);
      expect(json.data.subjectType).toBe('LAB');
      subjectId = json.data.id;
      createdSubjectIds.push(subjectId);
    });

    it('should read the subject by ID with 200', async () => {
      const res = await app.request(`/api/subjects/${subjectId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(subjectId);
      expect(json.data.name).toBe('Data Structures and Algorithms Laboratory');
      expect(json.data.regulationName).toBeDefined();
    });

    it('should update the subject name and description with 200', async () => {
      const res = await app.request(`/api/subjects/${subjectId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Advanced Data Structures Laboratory',
          description: 'Updated lab syllabus for IT students',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Advanced Data Structures Laboratory');
      expect(json.data.description).toBe('Updated lab syllabus for IT students');
    });

    it('should toggle subject status to INACTIVE with 200', async () => {
      const res = await app.request(`/api/subjects/${subjectId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'INACTIVE' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('INACTIVE');
    });

    it('should toggle subject status back to ACTIVE with 200', async () => {
      const res = await app.request(`/api/subjects/${subjectId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('ACTIVE');
    });
  });

  // ==========================================
  // 4. REFERENTIAL INTEGRITY ON SUBJECT DELETION
  // ==========================================
  describe('4. Referential Integrity on Subject Deletion', () => {
    let linkedSubjectId: string;

    beforeAll(async () => {
      const sub = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}REF`,
        name: 'Database Engineering',
        subjectType: 'THEORY',
        yearNumber: 2,
        regulationId: testRegulationR21Id,
        status: 'ACTIVE',
        dataSource: 'MANUALLY_ENTERED',
      }).returning().then(r => r[0]);
      linkedSubjectId = sub.id;
      createdSubjectIds.push(sub.id);

      // Link to class_subjects
      const cs = await db.insert(classSubjects).values({
        classId: testClassYear2Id,
        subjectId: linkedSubjectId,
        academicYearId: testAcademicYearId,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      createdClassSubjectIds.push(cs.id);
    });

    it('should block deletion of subject referenced by class_subjects with 409 Conflict', async () => {
      const res = await app.request(`/api/subjects/${linkedSubjectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('class mapping(s)');
      expect(json.error.message).toContain('Consider deactivating');
    });

    it('should block deletion of subject referenced by timetables with 409 Conflict', async () => {
      const ttSubject = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}TT`,
        name: 'Operating Systems',
        subjectType: 'THEORY',
        yearNumber: 2,
        regulationId: testRegulationR21Id,
        status: 'ACTIVE',
        dataSource: 'MANUALLY_ENTERED',
      }).returning().then(r => r[0]);
      createdSubjectIds.push(ttSubject.id);

      const tt = await db.insert(timetables).values({
        academicYearId: testAcademicYearId,
        classId: testClassYear2Id,
        dayOfWeek: 'MONDAY',
        periodId: testPeriodId,
        subjectId: ttSubject.id,
        staffId: testStaffMemberId,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      createdTimetableIds.push(tt.id);

      const res = await app.request(`/api/subjects/${ttSubject.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('timetable schedule(s)');
    });

    it('should safely delete unlinked subject with 200', async () => {
      const unlinkedSubject = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}UNL`,
        name: 'Temporary Unlinked Subject',
        subjectType: 'SEMINAR',
        yearNumber: 2,
        regulationId: testRegulationR21Id,
        status: 'ACTIVE',
        dataSource: 'MANUALLY_ENTERED',
      }).returning().then(r => r[0]);

      const res = await app.request(`/api/subjects/${unlinkedSubject.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify DB removal
      const check = await db.select().from(subjects).where(eq(subjects.id, unlinkedSubject.id)).then(r => r[0]);
      expect(check).toBeUndefined();
    });

    it('should return 404 when deleting non-existent subject', async () => {
      const res = await app.request('/api/subjects/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // 5. CLASS-SUBJECT MAPPING VALIDATION & LIFECYCLE
  // ==========================================
  describe('5. Class-Subject Mapping Validation and Operations', () => {
    let mappingSubjectYear2: string;
    let mappingSubjectR23: string;
    let mappingSubjectYear3: string;

    beforeAll(async () => {
      // Subject for Year 2, R2021
      const sY2 = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}Y2`,
        name: 'Web Technology',
        subjectType: 'THEORY',
        yearNumber: 2,
        regulationId: testRegulationR21Id,
        status: 'ACTIVE',
        dataSource: 'MANUALLY_ENTERED',
      }).returning().then(r => r[0]);
      mappingSubjectYear2 = sY2.id;
      createdSubjectIds.push(sY2.id);

      // Subject for Regulation R2023 (different regulation)
      const sR23 = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}R23`,
        name: 'Cloud Computing Foundations',
        subjectType: 'THEORY',
        yearNumber: 2,
        regulationId: testRegulationR23Id,
        status: 'ACTIVE',
        dataSource: 'MANUALLY_ENTERED',
      }).returning().then(r => r[0]);
      mappingSubjectR23 = sR23.id;
      createdSubjectIds.push(sR23.id);

      // Subject for Year 3
      const sY3 = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}Y3`,
        name: 'Information Security',
        subjectType: 'THEORY',
        yearNumber: 3,
        regulationId: testRegulationR21Id,
        status: 'ACTIVE',
        dataSource: 'MANUALLY_ENTERED',
      }).returning().then(r => r[0]);
      mappingSubjectYear3 = sY3.id;
      createdSubjectIds.push(sY3.id);
    });

    it('should reject mapping with regulation mismatch with 400', async () => {
      const res = await app.request('/api/class-subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classId: testClassYear2Id, // R2021
          subjectId: mappingSubjectR23, // R2023
          academicYearId: testAcademicYearId,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Regulation mismatch');
    });

    it('should reject mapping with year level mismatch with 400', async () => {
      const res = await app.request('/api/class-subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classId: testClassYear2Id, // Year 2
          subjectId: mappingSubjectYear3, // Year 3
          academicYearId: testAcademicYearId,
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Year mismatch');
    });

    it('should successfully assign subject to class with 201', async () => {
      const res = await app.request('/api/class-subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classId: testClassYear2Id,
          subjectId: mappingSubjectYear2,
          academicYearId: testAcademicYearId,
        }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.classId).toBe(testClassYear2Id);
      expect(json.data.subjectId).toBe(mappingSubjectYear2);
      createdClassSubjectIds.push(json.data.id);
    });

    it('should reject duplicate class-subject assignment with 409 Conflict', async () => {
      const res = await app.request('/api/class-subjects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classId: testClassYear2Id,
          subjectId: mappingSubjectYear2,
          academicYearId: testAcademicYearId,
        }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('already assigned');
    });

    it('should fetch subjects assigned to a class via GET /api/class-subjects?classId=...', async () => {
      const res = await app.request(`/api/class-subjects?classId=${testClassYear2Id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      const found = json.data.some((item: any) => item.subjectId === mappingSubjectYear2);
      expect(found).toBe(true);
    });

    it('should fetch classes assigned to a subject via GET /api/class-subjects?subjectId=...', async () => {
      const res = await app.request(`/api/class-subjects?subjectId=${mappingSubjectYear2}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      const found = json.data.some((item: any) => item.classId === testClassYear2Id);
      expect(found).toBe(true);
    });
  });

  // ==========================================
  // 6. REFERENTIAL INTEGRITY ON CLASS-SUBJECT REMOVAL
  // ==========================================
  describe('6. Referential Integrity on Class-Subject Removal', () => {
    let removableSubjectId: string;
    let removableMappingId: string;

    beforeAll(async () => {
      const sub = await db.insert(subjects).values({
        code: `IT${Date.now().toString().slice(-4)}REM`,
        name: 'Removable Subject',
        subjectType: 'THEORY',
        yearNumber: 2,
        regulationId: testRegulationR21Id,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      removableSubjectId = sub.id;
      createdSubjectIds.push(sub.id);

      const mapping = await db.insert(classSubjects).values({
        classId: testClassYear2Id,
        subjectId: removableSubjectId,
        academicYearId: testAcademicYearId,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      removableMappingId = mapping.id;
      createdClassSubjectIds.push(mapping.id);
    });

    it('should block removal of class-subject mapping if timetable schedule exists with 409 Conflict', async () => {
      // Add timetable schedule for this class and subject
      const tt = await db.insert(timetables).values({
        academicYearId: testAcademicYearId,
        classId: testClassYear2Id,
        dayOfWeek: 'TUESDAY',
        periodId: testPeriodId,
        subjectId: removableSubjectId,
        staffId: testStaffMemberId,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      createdTimetableIds.push(tt.id);

      const res = await app.request(`/api/class-subjects/${removableMappingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.message).toContain('timetable schedule(s) are assigned');

      // Clean up the timetable schedule so next test can test safe removal
      await db.delete(timetables).where(eq(timetables.id, tt.id));
    });

    it('should safely remove class-subject mapping with 200 when no timetable schedule exists', async () => {
      const res = await app.request(`/api/class-subjects/${removableMappingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      const check = await db.select().from(classSubjects).where(eq(classSubjects.id, removableMappingId)).then(r => r[0]);
      expect(check).toBeUndefined();
    });
  });

  // ==========================================
  // 7. AUDIT TRAIL VERIFICATION
  // ==========================================
  describe('7. Audit Trail Verification', () => {
    it('should record audit log entries for subject mutations', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityType, 'SUBJECT'))
        .limit(10);

      expect(logs.length).toBeGreaterThan(0);
      const actions = logs.map(l => l.action);
      expect(actions).toContain('CREATE_SUBJECT');
    });

    it('should record audit log entries for class-subject assignments', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityType, 'CLASS_SUBJECT'))
        .limit(10);

      expect(logs.length).toBeGreaterThan(0);
      const actions = logs.map(l => l.action);
      expect(actions).toContain('ASSIGN_CLASS_SUBJECT');
    });
  });
});

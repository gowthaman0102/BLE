import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { msAuthService } from '../src/services/session-token.service';
import { db } from '../src/db';
import { academicYears, classes } from '../src/db/schema/academic';
import { staff, roles, staffRoles } from '../src/db/schema/staff';
import { periods, timetables, timetableOverrides } from '../src/db/schema/timetable';
import { subjects } from '../src/db/schema/subjects';
import { auditLogs } from '../src/db/schema/audit';
import { eq, desc, inArray } from 'drizzle-orm';
import app from '../src/index';

describe('Phase W7 — Timetable & Overrides Integration Test Suite', () => {
  let adminToken: string;
  let hodToken: string;

  let testAdminId: string;
  let testHodId: string;
  let staffAId: string;
  let staffBId: string;
  let classAId: string;
  let classBId: string;
  let testPeriodId: string;
  let testSubjectId: string;
  let activeAcademicYearId: string;
  let testTimetableId: string;
  let testOverrideId: string;

  const createdStaffIds: string[] = [];
  let createdPeriodId: string | undefined;
  let createdClassBId: string | undefined;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';

    // Roles
    let rAdmin = await db.select().from(roles).where(eq(roles.name, 'ADMIN')).then(r => r[0]);
    if (!rAdmin) {
      rAdmin = await db.insert(roles).values({ name: 'ADMIN', description: 'Administrator' }).returning().then(r => r[0]);
    }
    let rHod = await db.select().from(roles).where(eq(roles.name, 'HOD')).then(r => r[0]);
    if (!rHod) {
      rHod = await db.insert(roles).values({ name: 'HOD', description: 'Head of Dept' }).returning().then(r => r[0]);
    }
    let rStaff = await db.select().from(roles).where(eq(roles.name, 'STAFF')).then(r => r[0]);
    if (!rStaff) {
      rStaff = await db.insert(roles).values({ name: 'STAFF', description: 'Faculty' }).returning().then(r => r[0]);
    }

    // Staff
    const rand = Math.random().toString(36).substring(2, 7);
    const sAdmin = await db.insert(staff).values({
      staffCode: `TT-A-${rand}`,
      name: 'Dr. Timetable Admin',
      collegeEmail: `tt.admin.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testAdminId = sAdmin.id;
    createdStaffIds.push(testAdminId);
    await db.insert(staffRoles).values({ staffId: testAdminId, roleId: rAdmin.id });

    const sHod = await db.insert(staff).values({
      staffCode: `TT-H-${rand}`,
      name: 'Dr. Timetable HOD',
      collegeEmail: `tt.hod.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testHodId = sHod.id;
    createdStaffIds.push(testHodId);
    await db.insert(staffRoles).values({ staffId: testHodId, roleId: rHod.id });

    const sA = await db.insert(staff).values({
      staffCode: `TT-SA-${rand}`,
      name: 'Prof. Staff Alpha',
      collegeEmail: `tt.sa.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    staffAId = sA.id;
    createdStaffIds.push(staffAId);
    await db.insert(staffRoles).values({ staffId: staffAId, roleId: rStaff.id });

    const sB = await db.insert(staff).values({
      staffCode: `TT-SB-${rand}`,
      name: 'Prof. Staff Beta',
      collegeEmail: `tt.sb.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    staffBId = sB.id;
    createdStaffIds.push(staffBId);
    await db.insert(staffRoles).values({ staffId: staffBId, roleId: rStaff.id });

    // Tokens
    adminToken = await msAuthService.createSessionToken({
      id: testAdminId,
      name: sAdmin.name,
      collegeEmail: sAdmin.collegeEmail,
      roles: ['ADMIN'],
      userType: 'STAFF',
    });

    hodToken = await msAuthService.createSessionToken({
      id: testHodId,
      name: sHod.name,
      collegeEmail: sHod.collegeEmail,
      roles: ['HOD'],
      userType: 'STAFF',
    });

    // Reference records
    const ay = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1).then(r => r[0]);
    activeAcademicYearId = ay.id;

    const classRows = await db.select().from(classes).where(eq(classes.status, 'ACTIVE')).limit(2);
    classAId = classRows[0].id;
    if (classRows.length > 1) {
      classBId = classRows[1].id;
    } else {
      const extraClass = await db.insert(classes).values({
        departmentId: classRows[0].departmentId,
        academicYearId: classRows[0].academicYearId,
        batchId: classRows[0].batchId,
        regulationId: classRows[0].regulationId,
        yearNumber: classRows[0].yearNumber,
        name: `TT-Class-B-${rand}`,
        section: 'Z',
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
      classBId = extraClass.id;
      createdClassBId = extraClass.id;
    }

    const sub = await db.select().from(subjects).where(eq(subjects.status, 'ACTIVE')).limit(1).then(r => r[0]);
    testSubjectId = sub.id;

    // Create a dedicated period to prevent conflict with other test runs
    const per = await db.insert(periods).values({
      name: `Period TT-${rand}`,
      periodNumber: Math.floor(Math.random() * 800) + 100,
      startTime: '09:00:00',
      endTime: '09:50:00',
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testPeriodId = per.id;
    createdPeriodId = per.id;
  });

  afterAll(async () => {
    if (testOverrideId) {
      await db.delete(timetableOverrides).where(eq(timetableOverrides.id, testOverrideId)).catch(() => {});
    }
    if (testTimetableId) {
      await db.delete(timetables).where(eq(timetables.id, testTimetableId)).catch(() => {});
    }
    if (createdPeriodId) {
      await db.delete(periods).where(eq(periods.id, createdPeriodId)).catch(() => {});
    }
    if (createdClassBId) {
      await db.delete(classes).where(eq(classes.id, createdClassBId)).catch(() => {});
    }
    if (createdStaffIds.length > 0) {
      await db.delete(staffRoles).where(inArray(staffRoles.staffId, createdStaffIds)).catch(() => {});
      await db.delete(staff).where(inArray(staff.id, createdStaffIds)).catch(() => {});
    }
  });

  describe('1. Timetable Conflict Detection & Integrity', () => {
    it('should create valid timetable entry and return 201', async () => {
      const res = await app.request('/api/timetable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hodToken}`,
        },
        body: JSON.stringify({
          academicYearId: activeAcademicYearId,
          classId: classAId,
          dayOfWeek: 'SATURDAY',
          periodId: testPeriodId,
          subjectId: testSubjectId,
          staffId: staffAId,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.dayOfWeek).toBe('SATURDAY');
      testTimetableId = data.data.id;
    });

    it('should reject class conflict (same class, day, and period) with 409 Conflict', async () => {
      const res = await app.request('/api/timetable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hodToken}`,
        },
        body: JSON.stringify({
          academicYearId: activeAcademicYearId,
          classId: classAId, // same class
          dayOfWeek: 'SATURDAY',
          periodId: testPeriodId,
          subjectId: testSubjectId,
          staffId: staffBId, // different staff
        }),
      });
      expect(res.status).toBe(409);
    });

    it('should reject staff conflict (same staff, day, and period) with 409 Conflict', async () => {
      if (classAId === classBId) return; // skip if single class

      const res = await app.request('/api/timetable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hodToken}`,
        },
        body: JSON.stringify({
          academicYearId: activeAcademicYearId,
          classId: classBId, // different class
          dayOfWeek: 'SATURDAY',
          periodId: testPeriodId,
          subjectId: testSubjectId,
          staffId: staffAId, // same staff
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('2. Timetable Overrides Management', () => {
    it('should reject override with missing fields with 400', async () => {
      const res = await app.request('/api/timetable/overrides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hodToken}`,
        },
        body: JSON.stringify({
          timetableId: testTimetableId,
        }),
      });
      expect(res.status).toBe(400);
    });

    it('should create timetable override with replacement staff and record CREATE_TIMETABLE_OVERRIDE audit log', async () => {
      const overrideDate = '2026-10-24';
      const res = await app.request('/api/timetable/overrides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hodToken}`,
        },
        body: JSON.stringify({
          timetableId: testTimetableId,
          overrideDate,
          replacementStaffId: staffBId,
          reason: 'Faculty on academic duty at conference',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.timetableId).toBe(testTimetableId);
      testOverrideId = data.data.id;

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'CREATE_TIMETABLE_OVERRIDE'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testOverrideId);
    });

    it('should fetch all timetable overrides via GET /api/timetable/overrides', async () => {
      const res = await app.request('/api/timetable/overrides', {
        headers: { Authorization: `Bearer ${hodToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      const found = data.data.find((o: any) => o.id === testOverrideId);
      expect(found).toBeDefined();
    });

    it('should update override via PATCH /api/timetable/overrides/:id and record UPDATE_TIMETABLE_OVERRIDE audit log', async () => {
      const res = await app.request(`/api/timetable/overrides/${testOverrideId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hodToken}`,
        },
        body: JSON.stringify({
          reason: 'Updated: Special expert lecture session',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'UPDATE_TIMETABLE_OVERRIDE'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testOverrideId);
    });

    it('should delete override via DELETE /api/timetable/overrides/:id and record DELETE_TIMETABLE_OVERRIDE audit log', async () => {
      const res = await app.request(`/api/timetable/overrides/${testOverrideId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${hodToken}` },
      });
      expect(res.status).toBe(200);

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'DELETE_TIMETABLE_OVERRIDE'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testOverrideId);
    });
  });

  describe('3. Timetable Stats & Today Aggregations', () => {
    it('should return real aggregated timetable stats via GET /api/timetable/stats', async () => {
      const res = await app.request('/api/timetable/stats', {
        headers: { Authorization: `Bearer ${hodToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(typeof data.data.totalEntries).toBe('number');
      expect(typeof data.data.todayEntries).toBe('number');
      expect(typeof data.data.dayOfWeek).toBe('string');
      expect(data.data.totalEntries).toBeGreaterThanOrEqual(1);
    });

    it('should return today timetable schedule via GET /api/timetable/today', async () => {
      const res = await app.request('/api/timetable/today', {
        headers: { Authorization: `Bearer ${hodToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });
  });
});

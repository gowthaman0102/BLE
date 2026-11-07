import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { msAuthService } from '../src/services/session-token.service';
import { db } from '../src/db';
import { departments, academicYears, classes } from '../src/db/schema/academic';
import { staff, roles, staffRoles } from '../src/db/schema/staff';
import { students } from '../src/db/schema/students';
import { periods, timetables } from '../src/db/schema/timetable';
import { subjects } from '../src/db/schema/subjects';
import { attendanceSessions } from '../src/db/schema/attendance';
import { attendanceRecords, attendanceCorrections } from '../src/db/schema/attendance-records';
import { auditLogs } from '../src/db/schema/audit';
import { eq, desc, inArray } from 'drizzle-orm';
import app from '../src/index';

describe('Phase W8 & W9 — Attendance Sessions & Records Integration Test Suite', () => {
  let adminToken: string;
  let staffToken: string;
  let otherStaffToken: string;

  let testAdminId: string;
  let testStaffId: string;
  let otherStaffId: string;
  let testClassId: string;
  let testStudentId: string;
  let testTimetableId: string;
  let testSessionId: string;
  let testRecordId: string;
  let testDate: string;
  let createdPeriodId: string;
  const createdStaffIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';

    // Get current day name in uppercase
    const d = new Date();
    testDate = d.toISOString().split('T')[0];
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const currentDayOfWeek = days[d.getDay()];

    // 1. Roles
    let rAdmin = await db.select().from(roles).where(eq(roles.name, 'ADMIN')).then(r => r[0]);
    if (!rAdmin) {
      rAdmin = await db.insert(roles).values({ name: 'ADMIN', description: 'System Administrator' }).returning().then(r => r[0]);
    }
    let rStaff = await db.select().from(roles).where(eq(roles.name, 'STAFF')).then(r => r[0]);
    if (!rStaff) {
      rStaff = await db.insert(roles).values({ name: 'STAFF', description: 'Faculty Member' }).returning().then(r => r[0]);
    }

    // 2. Staff members
    const rand = Math.random().toString(36).substring(2, 7);
    const sAdmin = await db.insert(staff).values({
      staffCode: `AT-A-${rand}`,
      name: 'Dr. Attendance Admin',
      collegeEmail: `att.admin.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testAdminId = sAdmin.id;
    createdStaffIds.push(testAdminId);
    await db.insert(staffRoles).values({ staffId: testAdminId, roleId: rAdmin.id });

    const sStaff = await db.insert(staff).values({
      staffCode: `AT-S-${rand}`,
      name: 'Prof. Attendance Faculty',
      collegeEmail: `att.faculty.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testStaffId = sStaff.id;
    createdStaffIds.push(testStaffId);
    await db.insert(staffRoles).values({ staffId: testStaffId, roleId: rStaff.id });

    const sOther = await db.insert(staff).values({
      staffCode: `AT-O-${rand}`,
      name: 'Prof. Other Faculty',
      collegeEmail: `att.other.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    otherStaffId = sOther.id;
    createdStaffIds.push(otherStaffId);
    await db.insert(staffRoles).values({ staffId: otherStaffId, roleId: rStaff.id });

    // 3. Tokens
    adminToken = await msAuthService.createSessionToken({
      id: testAdminId,
      name: sAdmin.name,
      collegeEmail: sAdmin.collegeEmail,
      roles: ['ADMIN'],
      userType: 'STAFF',
    });

    staffToken = await msAuthService.createSessionToken({
      id: testStaffId,
      name: sStaff.name,
      collegeEmail: sStaff.collegeEmail,
      roles: ['STAFF'],
      userType: 'STAFF',
    });

    otherStaffToken = await msAuthService.createSessionToken({
      id: otherStaffId,
      name: sOther.name,
      collegeEmail: sOther.collegeEmail,
      roles: ['STAFF'],
      userType: 'STAFF',
    });

    // 4. Class & Student
    let activeClass = await db.select().from(classes).where(eq(classes.status, 'ACTIVE')).limit(1).then(r => r[0]);
    testClassId = activeClass.id;

    const stu = await db.insert(students).values({
      registerNumber: `6178ATT${Date.now().toString().slice(-6)}`,
      name: `Student Attendance Test ${rand}`,
      collegeEmail: `student.att.${rand}@sonatech.ac.in`,
      classId: testClassId,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testStudentId = stu.id;

    // 5. Subject & Period
    const sub = await db.select().from(subjects).where(eq(subjects.status, 'ACTIVE')).limit(1).then(r => r[0]);
    const per = await db.insert(periods).values({
      name: `Period ATT-${rand}`,
      periodNumber: Math.floor(Math.random() * 800) + 100,
      startTime: '00:00:00',
      endTime: '23:59:59',
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    createdPeriodId = per.id;
    const ay = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1).then(r => r[0]);

    // 6. Timetable entry matching current day of week
    const tt = await db.insert(timetables).values({
      academicYearId: ay.id,
      classId: testClassId,
      dayOfWeek: currentDayOfWeek,
      periodId: per.id,
      subjectId: sub.id,
      staffId: testStaffId,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testTimetableId = tt.id;
  });

  describe('1. Attendance Session Creation & Authorization', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await app.request('/api/attendance/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timetableId: testTimetableId, date: testDate }),
      });
      expect(res.status).toBe(401);
    });

    it('should reject session creation with missing required fields with 400', async () => {
      const res = await app.request('/api/attendance/sessions/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ timetableId: testTimetableId }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Missing required fields');
    });

    it('should reject session creation if caller is not authorized for that timetable entry', async () => {
      // otherStaff is not assigned to this timetable
      const res = await app.request('/api/attendance/sessions/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherStaffToken}`,
        },
        body: JSON.stringify({ timetableId: testTimetableId, date: testDate }),
      });
      expect([400, 403]).toContain(res.status);
      const data = await res.json();
      expect(data.error.message).toBe('STAFF_NOT_AUTHORIZED');
    });

    it('should allow assigned staff to start attendance session and record START_ATTENDANCE_SESSION audit log', async () => {
      const res = await app.request('/api/attendance/sessions/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ timetableId: testTimetableId, date: testDate }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('ACTIVE');
      expect(data.data.timetableId).toBe(testTimetableId);
      testSessionId = data.data.id;

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'START_ATTENDANCE_SESSION'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testSessionId);
    });

    it('should reject duplicate session creation for the same timetable and date with 409 Conflict', async () => {
      const res = await app.request('/api/attendance/sessions/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ timetableId: testTimetableId, date: testDate }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error.message).toBe('SESSION_ALREADY_EXISTS');
    });
  });

  describe('2. Attendance Records & Manual Marking', () => {
    it('should manually mark student attendance via POST /api/attendance/records/manual and record MANUAL_MARK_ATTENDANCE audit', async () => {
      const res = await app.request('/api/attendance/records/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          sessionId: testSessionId,
          studentId: testStudentId,
          status: 'PRESENT',
          reason: 'Manual attendance verification by teacher',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('PRESENT');
      expect(data.data.source).toBe('MANUAL');
      testRecordId = data.data.id;

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'MANUAL_MARK_ATTENDANCE'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testRecordId);
    });

    it('should fetch attendance records by sessionId via GET /api/attendance/records', async () => {
      const res = await app.request(`/api/attendance/records?sessionId=${testSessionId}`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThanOrEqual(1);

      const found = data.data.find((r: any) => r.id === testRecordId);
      expect(found).toBeDefined();
      expect(found.studentId).toBe(testStudentId);
      expect(found.status).toBe('PRESENT');
      expect(found.registerNumber).toBeDefined();
    });

    it('should fetch single attendance record with correction history via GET /api/attendance/records/:id', async () => {
      const res = await app.request(`/api/attendance/records/${testRecordId}`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(testRecordId);
      expect(data.data.corrections).toBeDefined();
    });
  });

  describe('3. Attendance Corrections & Audit Trail', () => {
    it('should reject correction if reason is missing with 400', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'ABSENT',
          reason: '   ', // empty whitespace
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe('CORRECTION_REASON_REQUIRED');
    });

    it('should reject correction if status is unchanged with 400', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'PRESENT',
          reason: 'Left early',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe('STATUS_UNCHANGED');
    });

    it('should successfully correct attendance, insert into attendance_corrections, update record, and record CORRECT_ATTENDANCE audit log', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'ABSENT',
          reason: 'Student left early without permission, verified by counselor',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('ABSENT');
      expect(data.data.correction).toBeDefined();
      expect(data.data.correction.previousStatus).toBe('PRESENT');
      expect(data.data.correction.newStatus).toBe('ABSENT');
      expect(data.data.correction.reason).toBe('Student left early without permission, verified by counselor');

      // Verify attendance_corrections table in PostgreSQL
      const correctionRow = await db.select().from(attendanceCorrections)
        .where(eq(attendanceCorrections.attendanceRecordId, testRecordId))
        .then(r => r[0]);
      expect(correctionRow).toBeDefined();
      expect(correctionRow.previousStatus).toBe('PRESENT');
      expect(correctionRow.newStatus).toBe('ABSENT');
      expect(correctionRow.correctedBy).toBe(testStaffId);

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'CORRECT_ATTENDANCE'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testRecordId);
      expect(log.description).toContain('Student left early');
    });
  });

  describe('4. Session Lifecycle: End and Cancellation', () => {
    it('should end active session via POST /api/attendance/sessions/:id/end and record END_ATTENDANCE_SESSION audit log', async () => {
      const res = await app.request(`/api/attendance/sessions/${testSessionId}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('COMPLETED');
      expect(data.data.endedAt).toBeDefined();

      // Verify audit log
      const log = await db.select().from(auditLogs)
        .where(eq(auditLogs.action, 'END_ATTENDANCE_SESSION'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
        .then(r => r[0]);
      expect(log).toBeDefined();
      expect(log.entityId).toBe(testSessionId);
    });

    it('should prevent cancelling completed session with 400', async () => {
      const res = await app.request(`/api/attendance/sessions/${testSessionId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ reason: 'Accidental session' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe('CANNOT_CANCEL_COMPLETED_SESSION');
    });
  });

  afterAll(async () => {
    if (testRecordId) {
      await db.delete(attendanceCorrections).where(eq(attendanceCorrections.attendanceRecordId, testRecordId)).catch(() => {});
    }
    if (testSessionId) {
      await db.delete(attendanceRecords).where(eq(attendanceRecords.attendanceSessionId, testSessionId)).catch(() => {});
      await db.delete(attendanceSessions).where(eq(attendanceSessions.id, testSessionId)).catch(() => {});
    }
    if (testTimetableId) {
      await db.delete(timetables).where(eq(timetables.id, testTimetableId)).catch(() => {});
    }
    if (createdPeriodId) {
      await db.delete(periods).where(eq(periods.id, createdPeriodId)).catch(() => {});
    }
    if (testStudentId) {
      await db.delete(students).where(eq(students.id, testStudentId)).catch(() => {});
    }
    if (createdStaffIds.length > 0) {
      await db.delete(staffRoles).where(inArray(staffRoles.staffId, createdStaffIds)).catch(() => {});
      await db.delete(staff).where(inArray(staff.id, createdStaffIds)).catch(() => {});
    }
  });
});

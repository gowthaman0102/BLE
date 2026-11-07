import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { msAuthService } from '../src/services/session-token.service';
import { db } from '../src/db';
import { departments, classes, academicYears, batches, regulations } from '../src/db/schema/academic';
import { staff, roles, staffRoles } from '../src/db/schema/staff';
import { students } from '../src/db/schema/students';
import { periods, timetables } from '../src/db/schema/timetable';
import { subjects } from '../src/db/schema/subjects';
import { attendanceSessions } from '../src/db/schema/attendance';
import { attendanceRecords, attendanceCorrections, attendanceFallbackRequests } from '../src/db/schema/attendance-records';
import { auditLogs } from '../src/db/schema/audit';
import { eq, and, desc } from 'drizzle-orm';
import app from '../src/index';

describe('Milestone F7 — Audited Fallback & Professor Manual Correction Integration Test Suite', () => {
  let adminToken: string;
  let assignedStaffToken: string;
  let otherStaffToken: string;
  let studentToken: string;
  let otherClassStudentToken: string;

  let testAdminId: string;
  let assignedStaffId: string;
  let otherStaffId: string;
  let testClassId: string;
  let otherClassId: string;
  let testStudentId: string;
  let otherStudentId: string;
  let testTimetableId: string;
  let activeSessionId: string;
  let closedSessionId: string;
  let cancelledSessionId: string;
  let testDate: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';

    const d = new Date();
    testDate = d.toISOString().split('T')[0];
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const currentDayOfWeek = days[d.getDay()];
    const rand = Math.random().toString(36).substring(2, 7);

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
    const sAdmin = await db.insert(staff).values({
      staffCode: `F7-ADM-${rand}`,
      name: 'Dr. F7 Admin',
      collegeEmail: `f7.admin.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testAdminId = sAdmin.id;
    await db.insert(staffRoles).values({ staffId: testAdminId, roleId: rAdmin.id });

    const sAssigned = await db.insert(staff).values({
      staffCode: `F7-PRF-${rand}`,
      name: 'Prof. Assigned Faculty',
      collegeEmail: `f7.assigned.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    assignedStaffId = sAssigned.id;
    await db.insert(staffRoles).values({ staffId: assignedStaffId, roleId: rStaff.id });

    const sOther = await db.insert(staff).values({
      staffCode: `F7-OTH-${rand}`,
      name: 'Prof. Other Faculty',
      collegeEmail: `f7.other.${rand}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    otherStaffId = sOther.id;
    await db.insert(staffRoles).values({ staffId: otherStaffId, roleId: rStaff.id });

    // 3. Departments & Academic Setup
    const dept = await db.insert(departments).values({
      name: `IT Department F7 ${rand}`,
      code: `IT7_${rand}`,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);

    let ay = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1).then(r => r[0]);
    if (!ay) {
      ay = await db.insert(academicYears).values({
        name: `AY-F7-${rand}`,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        isCurrent: true,
      }).returning().then(r => r[0]);
    }

    let batch = await db.select().from(batches).limit(1).then(r => r[0]);
    if (!batch) {
      batch = await db.insert(batches).values({
        name: `BATCH-F7-${rand}`,
        startYear: 2024,
        endYear: 2028,
        departmentId: dept.id,
      }).returning().then(r => r[0]);
    }

    let reg = await db.select().from(regulations).limit(1).then(r => r[0]);
    if (!reg) {
      reg = await db.insert(regulations).values({
        name: `REG-F7-${rand}`,
        year: 2023,
      }).returning().then(r => r[0]);
    }

    // Classes
    const c1 = await db.insert(classes).values({
      name: `Class F7-A-${rand}`,
      yearNumber: 3,
      section: 'A',
      departmentId: dept.id,
      academicYearId: ay.id,
      batchId: batch.id,
      regulationId: reg.id,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testClassId = c1.id;

    const c2 = await db.insert(classes).values({
      name: `Class F7-B-${rand}`,
      yearNumber: 3,
      section: 'B',
      departmentId: dept.id,
      academicYearId: ay.id,
      batchId: batch.id,
      regulationId: reg.id,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    otherClassId = c2.id;

    // Students
    const stu1 = await db.insert(students).values({
      registerNumber: `6178F7A${Date.now().toString().slice(-5)}`,
      name: `Student Fallback ${rand}`,
      collegeEmail: `stu.f7a.${rand}@sonatech.ac.in`,
      classId: testClassId,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testStudentId = stu1.id;

    const stu2 = await db.insert(students).values({
      registerNumber: `6178F7B${Date.now().toString().slice(-5)}`,
      name: `Student Other Class ${rand}`,
      collegeEmail: `stu.f7b.${rand}@sonatech.ac.in`,
      classId: otherClassId,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    otherStudentId = stu2.id;

    // Subject & Period
    let sub = await db.select().from(subjects).limit(1).then(r => r[0]);
    if (!sub) {
      sub = await db.insert(subjects).values({
        code: `SUB-F7-${rand}`,
        name: 'Distributed Systems F7',
        subjectType: 'THEORY',
        yearNumber: 3,
        regulationId: reg.id,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }

    const per = await db.insert(periods).values({
      name: `Period F7-${rand}`,
      periodNumber: Math.floor(Math.random() * 800) + 100,
      startTime: '08:00:00',
      endTime: '09:00:00',
      status: 'ACTIVE',
    }).returning().then(r => r[0]);

    // Timetable assigned to assignedStaff
    const tt = await db.insert(timetables).values({
      academicYearId: ay.id,
      classId: testClassId,
      dayOfWeek: currentDayOfWeek,
      periodId: per.id,
      subjectId: sub.id,
      staffId: assignedStaffId,
      status: 'ACTIVE',
    }).returning().then(r => r[0]);
    testTimetableId = tt.id;

    // Active session
    const sessActive = await db.insert(attendanceSessions).values({
      timetableId: testTimetableId,
      startedByStaffId: assignedStaffId,
      sessionDate: testDate,
      status: 'ACTIVE',
      startedAt: new Date().toISOString(),
    }).returning().then(r => r[0]);
    activeSessionId = sessActive.id;

    // Closed session
    const sessClosed = await db.insert(attendanceSessions).values({
      timetableId: testTimetableId,
      startedByStaffId: assignedStaffId,
      sessionDate: '2026-11-01',
      status: 'COMPLETED',
      startedAt: new Date('2026-11-01T08:00:00Z').toISOString(),
      endedAt: new Date('2026-11-01T09:00:00Z').toISOString(),
    }).returning().then(r => r[0]);
    closedSessionId = sessClosed.id;

    // Cancelled session
    const sessCancelled = await db.insert(attendanceSessions).values({
      timetableId: testTimetableId,
      startedByStaffId: assignedStaffId,
      sessionDate: '2026-11-02',
      status: 'CANCELLED',
      cancellationReason: 'College holiday',
    }).returning().then(r => r[0]);
    cancelledSessionId = sessCancelled.id;

    // Authentication Tokens
    adminToken = await msAuthService.createSessionToken({
      id: testAdminId,
      name: sAdmin.name,
      collegeEmail: sAdmin.collegeEmail,
      roles: ['ADMIN'],
      userType: 'STAFF',
    });

    assignedStaffToken = await msAuthService.createSessionToken({
      id: assignedStaffId,
      name: sAssigned.name,
      collegeEmail: sAssigned.collegeEmail,
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

    studentToken = await msAuthService.createSessionToken({
      id: testStudentId,
      name: stu1.name,
      collegeEmail: stu1.collegeEmail,
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: testClassId,
    });

    otherClassStudentToken = await msAuthService.createSessionToken({
      id: otherStudentId,
      name: stu2.name,
      collegeEmail: stu2.collegeEmail,
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: otherClassId,
    });
  });

  describe('1. Student Fallback Request Workflow', () => {
    let createdRequestId: string;

    it('rejects unauthenticated request to submit fallback', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reasonCategory: 'LIVENESS_FAILED',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects fallback request for an invalid session with 404', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          sessionId: '00000000-0000-0000-0000-000000000000',
          reasonCategory: 'LIVENESS_FAILED',
        }),
      });
      expect(res.status).toBe(404);
    });

    it('rejects fallback request for a cancelled session with 400', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          sessionId: cancelledSessionId,
          reasonCategory: 'CAMERA_UNAVAILABLE',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toMatch(/CANCELLED/i);
    });

    it('rejects fallback request from a student not enrolled in the session class with 403', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherClassStudentToken}`,
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reasonCategory: 'LIVENESS_FAILED',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects invalid or unsupported fallback reason category with 400', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reasonCategory: 'FABRICATED_UNSUPPORTED_REASON',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects excessively long explanation (> 500 characters) with 400', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reasonCategory: 'TECHNICAL_ISSUE',
          explanation: 'A'.repeat(501),
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toMatch(/500 characters/i);
    });

    it('records valid student fallback request without marking attendance PRESENT', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reasonCategory: 'LIVENESS_FAILED',
          explanation: 'Low lighting in the back corner of room A-204 caused challenge timeout.',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.status).toBe('PENDING');
      expect(body.data.reasonCategory).toBe('LIVENESS_FAILED');
      expect(body.data.explanation).toBe('Low lighting in the back corner of room A-204 caused challenge timeout.');
      createdRequestId = body.data.id;

      // CRITICAL CHECK: Attendance record must NOT be present
      const record = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.attendanceSessionId, activeSessionId),
            eq(attendanceRecords.studentId, testStudentId)
          )
        )
        .then((r) => r[0]);

      expect(record?.status).not.toBe('PRESENT');

      // Verify Audit log was created
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, createdRequestId),
            eq(auditLogs.action, 'SUBMIT_ATTENDANCE_FALLBACK')
          )
        )
        .then((r) => r[0]);
      expect(audit).toBeDefined();
      expect(audit.actorRole).toBe('STUDENT');
    });

    it('allows student to fetch their pending fallback request for the session', async () => {
      const res = await app.request(`/api/students/me/attendance/fallback-request?sessionId=${activeSessionId}`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(createdRequestId);
      expect(body.data.status).toBe('PENDING');
    });

    it('rejects duplicate pending fallback request for the same session with 409 Conflict', async () => {
      const res = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reasonCategory: 'CAMERA_UNAVAILABLE',
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('2. Professor Authorization & Fallback Review', () => {
    let pendingRequestId: string;

    beforeAll(async () => {
      // Find created request
      const req = await db
        .select()
        .from(attendanceFallbackRequests)
        .where(
          and(
            eq(attendanceFallbackRequests.attendanceSessionId, activeSessionId),
            eq(attendanceFallbackRequests.studentId, testStudentId)
          )
        )
        .then((r) => r[0]);
      pendingRequestId = req.id;
    });

    it('rejects unauthorized professor from listing fallback requests for another class with 403', async () => {
      const res = await app.request(`/api/attendance/sessions/${activeSessionId}/fallback-requests`, {
        headers: { Authorization: `Bearer ${otherStaffToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('allows assigned professor to list fallback requests for their session with 200', async () => {
      const res = await app.request(`/api/attendance/sessions/${activeSessionId}/fallback-requests`, {
        headers: { Authorization: `Bearer ${assignedStaffToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].id).toBe(pendingRequestId);
      expect(body.data[0].studentName).toBeDefined();
    });

    it('rejects unauthorized professor from resolving fallback request with 403', async () => {
      const res = await app.request(`/api/attendance/sessions/${activeSessionId}/fallback-requests/${pendingRequestId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherStaffToken}`,
        },
        body: JSON.stringify({
          resolution: 'APPROVED',
          notes: 'Audited attendance by unauthorized faculty',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects approval without a mandatory non-empty reason with 400', async () => {
      const res = await app.request(`/api/attendance/sessions/${activeSessionId}/fallback-requests/${pendingRequestId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          resolution: 'APPROVED',
          notes: '   ', // whitespace only
        }),
      });
      expect(res.status).toBe(400);
    });

    it('assigned professor resolves fallback request to APPROVED: atomically marks attendance PRESENT, creates correction, and logs audit', async () => {
      const auditReason = 'Verified student physical presence in classroom desk row 3';
      const res = await app.request(`/api/attendance/sessions/${activeSessionId}/fallback-requests/${pendingRequestId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          resolution: 'APPROVED',
          notes: auditReason,
          newStatus: 'PRESENT',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('APPROVED');
      expect(body.data.reviewedByStaffId).toBe(assignedStaffId);
      expect(body.data.reviewNotes).toBe(auditReason);

      // Verify attendance record was marked PRESENT with source MANUAL
      const rec = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.attendanceSessionId, activeSessionId),
            eq(attendanceRecords.studentId, testStudentId)
          )
        )
        .then((r) => r[0]);

      expect(rec).toBeDefined();
      expect(rec.status).toBe('PRESENT');
      expect(rec.source).toBe('MANUAL');
      expect(rec.markedBy).toBe(assignedStaffId);

      // Verify correction history record was created with fallback link
      const corr = await db
        .select()
        .from(attendanceCorrections)
        .where(eq(attendanceCorrections.attendanceRecordId, rec.id))
        .orderBy(desc(attendanceCorrections.createdAt))
        .then((r) => r[0]);

      expect(corr).toBeDefined();
      expect(corr.newStatus).toBe('PRESENT');
      expect(corr.reason).toContain(auditReason);
      expect(corr.fallbackRequestId).toBe(pendingRequestId);
      expect(corr.isPostClosure).toBe(false);

      // Verify Audit Log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, pendingRequestId),
            eq(auditLogs.action, 'RESOLVE_ATTENDANCE_FALLBACK')
          )
        )
        .then((r) => r[0]);

      expect(audit).toBeDefined();
      expect(audit.actorId).toBe(assignedStaffId);
    });

    it('rejects resolving already resolved fallback request with 409 Conflict', async () => {
      const res = await app.request(`/api/attendance/sessions/${activeSessionId}/fallback-requests/${pendingRequestId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          resolution: 'REJECTED',
          notes: 'Cannot re-resolve',
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('3. Manual Attendance Correction & Closed Session Policy', () => {
    let testRecordId: string;

    beforeAll(async () => {
      // Find record in active session
      const rec = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.attendanceSessionId, activeSessionId),
            eq(attendanceRecords.studentId, testStudentId)
          )
        )
        .then((r) => r[0]);
      testRecordId = rec.id;
    });

    it('rejects correction with missing or whitespace-only reason with 400', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'ABSENT',
          reason: '   ',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toMatch(/REASON_REQUIRED/i);
    });

    it('rejects unauthorized professor from correcting record with 403', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherStaffToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'ABSENT',
          reason: 'Unauthorized correction attempt',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('student cannot execute manual correction (rejected with 403 or 401)', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'PRESENT',
          reason: 'Self-correction attempt',
        }),
      });
      expect([401, 403]).toContain(res.status);
    });

    it('assigned professor corrects record from PRESENT to ABSENT with reason', async () => {
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          recordId: testRecordId,
          newStatus: 'ABSENT',
          reason: 'Student left classroom after initial roll call without permission',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ABSENT');
      expect(body.data.source).toBe('MANUAL');

      // Verify audit trail
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, testRecordId),
            eq(auditLogs.action, 'CORRECT_ATTENDANCE')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .then((r) => r[0]);

      expect(audit).toBeDefined();
      expect((audit.oldValues as any)?.status).toBe('PRESENT');
      expect((audit.newValues as any)?.status).toBe('ABSENT');
    });

    it('post-closure manual correction: sets is_post_closure = true and preserves closed status', async () => {
      // First, create an attendance record in the closed session
      const closedRecord = await db
        .insert(attendanceRecords)
        .values({
          attendanceSessionId: closedSessionId,
          studentId: testStudentId,
          status: 'ABSENT',
          source: 'MANUAL',
          markedAt: new Date().toISOString(),
          markedBy: assignedStaffId,
        })
        .returning()
        .then((r) => r[0]);

      // Apply correction on closed session
      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          recordId: closedRecord.id,
          newStatus: 'PRESENT',
          reason: 'Medical certificate approved by HOD post-session',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('PRESENT');

      // Check isPostClosure flag in corrections table
      const corr = await db
        .select()
        .from(attendanceCorrections)
        .where(eq(attendanceCorrections.attendanceRecordId, closedRecord.id))
        .orderBy(desc(attendanceCorrections.createdAt))
        .then((r) => r[0]);

      expect(corr.isPostClosure).toBe(true);

      // Verify session status is NOT altered implicitly (still COMPLETED)
      const sess = await db
        .select()
        .from(attendanceSessions)
        .where(eq(attendanceSessions.id, closedSessionId))
        .then((r) => r[0]);
      expect(sess.status).toBe('COMPLETED');
    });

    it('rejects correction on a CANCELLED session with 400', async () => {
      // Create record in cancelled session directly
      const cancelledRec = await db
        .insert(attendanceRecords)
        .values({
          attendanceSessionId: cancelledSessionId,
          studentId: testStudentId,
          status: 'ABSENT',
          source: 'MANUAL',
          markedAt: new Date().toISOString(),
        })
        .returning()
        .then((r) => r[0]);

      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignedStaffToken}`,
        },
        body: JSON.stringify({
          recordId: cancelledRec.id,
          newStatus: 'PRESENT',
          reason: 'Attempting to mark cancelled session',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toMatch(/CANCELLED/i);
    });

    it('HOD or Admin can view correction history with post-closure flags', async () => {
      const res = await app.request(`/api/attendance/corrections?sessionId=${closedSessionId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      const postClosureItem = body.data.find((c: any) => c.isPostClosure === true);
      expect(postClosureItem).toBeDefined();
    });
  });
});

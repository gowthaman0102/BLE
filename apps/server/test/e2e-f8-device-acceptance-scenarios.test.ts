import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { db } from '../src/db';
import { students } from '../src/db/schema/students';
import { classes, departments, academicYears, batches, regulations } from '../src/db/schema/academic';
import { attendanceSessions } from '../src/db/schema/attendance';
import { timetables, periods } from '../src/db/schema/timetable';
import { subjects } from '../src/db/schema/subjects';
import { staff, staffRoles, roles } from '../src/db/schema/staff';
import { attendanceBleTokens } from '../src/db/schema/attendance-ble-tokens';
import { attendanceRecords, attendanceCorrections } from '../src/db/schema/attendance-records';
import { studentFaceProfiles, attendanceFaceVerifications, livenessChallenges } from '../src/db/schema/face-verification';
import { FaceVerificationService } from '../src/services/face-verification.service';
import { OpenCvSFaceFaceMatchingProvider, NotConfiguredFaceMatchingProvider } from '../src/services/face-matching-provider';
import { OpenCvChallengeLivenessProvider, NotConfiguredLivenessProvider } from '../src/services/liveness-provider';
import { LivenessChallengeService } from '../src/services/liveness-challenge.service';
import { BleAttendanceService } from '../src/services/ble-attendance.service';
import { AttendanceRecordService } from '../src/services/attendance-record.service';
import { AttendanceFallbackService } from '../src/services/attendance-fallback.service';
import { attendanceRoutes } from '../src/routes/attendance';
import { studentRoutes, setFaceVerificationService } from '../src/routes/students';
import { eq, and } from 'drizzle-orm';
import type { AuthPrincipal } from '@smart-attendance/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Milestone F8 — Physical Device Acceptance Testing & Deployment Verification (Automated Scenarios)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const modelsDir = path.resolve(__dirname, '../models');

  let subjectARef: Buffer;
  let subjectASelfie: Buffer;
  let subjectATurnLeft: Buffer;
  let subjectATurnRight: Buffer;
  let subjectABlink: Buffer;
  let subjectBRef: Buffer;
  let subjectBSelfie: Buffer;
  let corruptedImg: Buffer;
  let noFaceImg: Buffer;

  let testDeptId: string;
  let testClassId: string;
  let otherClassId: string;
  let testStaffId: string;
  let otherStaffId: string;
  let testStudentId: string;
  let unassignedStudentId: string;
  let testTimetableId: string;
  let testSessionId: string;
  let cancelledSessionId: string;

  let livenessProvider: OpenCvChallengeLivenessProvider;
  let matchingProvider: OpenCvSFaceFaceMatchingProvider;
  let faceService: FaceVerificationService;
  let challengeService: LivenessChallengeService;
  let bleAttendanceService: BleAttendanceService;
  let attendanceRecordService: AttendanceRecordService;
  let fallbackService: AttendanceFallbackService;

  let profPrincipal: AuthPrincipal;
  let otherProfPrincipal: AuthPrincipal;
  let studentPrincipal: AuthPrincipal;
  let unassignedStudentPrincipal: AuthPrincipal;

  let app: Hono;

  beforeAll(async () => {
    // 1. Load Fixtures
    subjectARef = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_ref.jpg'));
    subjectASelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_selfie.jpg'));
    subjectATurnLeft = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_turn_left.jpg'));
    subjectATurnRight = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_turn_right.jpg'));
    subjectABlink = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_blink.jpg'));
    subjectBRef = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_ref.jpg'));
    subjectBSelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_selfie.jpg'));
    corruptedImg = fs.readFileSync(path.join(fixturesDir, 'face_corrupted.jpg'));
    noFaceImg = fs.readFileSync(path.join(fixturesDir, 'face_no_face.jpg'));

    // 2. Initialize Face & BLE Services
    matchingProvider = new OpenCvSFaceFaceMatchingProvider({
      modelsDir,
      defaultThreshold: 0.40,
      minConfidence: 0.60,
    });
    livenessProvider = new OpenCvChallengeLivenessProvider({
      modelsDir,
      defaultThreshold: 0.40,
      minConfidence: 0.60,
      pythonPath: 'python',
    });
    challengeService = new LivenessChallengeService();
    faceService = new FaceVerificationService(matchingProvider, undefined, livenessProvider, challengeService);
    setFaceVerificationService(faceService);
    bleAttendanceService = new BleAttendanceService();
    attendanceRecordService = new AttendanceRecordService();
    fallbackService = new AttendanceFallbackService();

    // 3. Provision DB Hierarchy
    const runKey = `f8_${Date.now()}`;
    const [dept] = await db.insert(departments).values({
      code: `F8D_${runKey.slice(-6)}`,
      name: 'F8 Verification Department',
    }).returning();
    testDeptId = dept.id;

    const [ay] = await db.insert(academicYears).values({
      name: `AY 2026-27 ${runKey}`,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2027-05-31'),
      isCurrent: true,
    }).returning();

    const [reg] = await db.insert(regulations).values({
      name: `Regulation 2026 ${runKey.slice(-6)}`,
      year: 2026,
    }).returning();

    const [batch] = await db.insert(batches).values({
      name: `Batch 2026 ${runKey}`,
      departmentId: dept.id,
      startYear: 2026,
      endYear: 2030,
    }).returning();

    const [cls] = await db.insert(classes).values({
      name: `F8-SEC-A-${runKey.slice(-4)}`,
      departmentId: dept.id,
      batchId: batch.id,
      academicYearId: ay.id,
      regulationId: reg.id,
      yearNumber: 3,
      section: `A_${runKey.slice(-4)}`,
    }).returning();
    testClassId = cls.id;

    const [clsOther] = await db.insert(classes).values({
      name: `F8-SEC-B-${runKey.slice(-4)}`,
      departmentId: dept.id,
      batchId: batch.id,
      academicYearId: ay.id,
      regulationId: reg.id,
      yearNumber: 3,
      section: `B_${runKey.slice(-4)}`,
    }).returning();
    otherClassId = clsOther.id;

    const [prof] = await db.insert(staff).values({
      staffCode: `F8PROF_${runKey.slice(-5)}`,
      name: 'Dr. F8 Assigned Professor',
      collegeEmail: `f8prof_${runKey}@sonatech.ac.in`,
    }).returning();
    testStaffId = prof.id;

    const [otherProf] = await db.insert(staff).values({
      staffCode: `F8UNAUTH_${runKey.slice(-5)}`,
      name: 'Dr. F8 Unauthorized Professor',
      collegeEmail: `f8unauth_${runKey}@sonatech.ac.in`,
    }).returning();
    otherStaffId = otherProf.id;

    // Roles
    let [staffRole] = await db.select().from(roles).where(eq(roles.name, 'STAFF'));
    if (!staffRole) {
      [staffRole] = await db.insert(roles).values({ name: 'STAFF', description: 'Faculty' }).returning();
    }
    await db.insert(staffRoles).values([
      { staffId: prof.id, roleId: staffRole.id },
      { staffId: otherProf.id, roleId: staffRole.id },
    ]);

    const [subj] = await db.insert(subjects).values({
      code: `F8CS_${runKey.slice(-5)}`,
      name: 'Device Acceptance & Verification Systems',
      subjectType: 'THEORY',
      regulationId: reg.id,
      yearNumber: 3,
    }).returning();

    let [prd] = await db.select().from(periods).where(eq(periods.periodNumber, 1));
    if (!prd) {
      [prd] = await db.insert(periods).values({
        periodNumber: 1,
        name: 'Period 1',
        startTime: '00:00:00',
        endTime: '23:59:00',
      }).returning();
    } else {
      await db.update(periods).set({ startTime: '00:00:00', endTime: '23:59:00' }).where(eq(periods.id, prd.id));
    }

    const [tt] = await db.insert(timetables).values({
      classId: cls.id,
      subjectId: subj.id,
      staffId: prof.id,
      periodId: prd.id,
      academicYearId: ay.id,
      dayOfWeek: new Date().toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }).toUpperCase(),
    }).returning();
    testTimetableId = tt.id;

    // Students
    const [std] = await db.insert(students).values({
      registerNumber: `6177F8A_${runKey.slice(-4)}`,
      name: 'F8 Alice Eligible Student',
      collegeEmail: `f8alice_${runKey}@sonatech.ac.in`,
      classId: cls.id,
    }).returning();
    testStudentId = std.id;

    const [stdUnassigned] = await db.insert(students).values({
      registerNumber: `6177F8B_${runKey.slice(-4)}`,
      name: 'F8 Bob Unassigned Student',
      collegeEmail: `f8bob_${runKey}@sonatech.ac.in`,
      classId: clsOther.id,
    }).returning();
    unassignedStudentId = stdUnassigned.id;

    // Principals
    profPrincipal = {
      id: prof.id,
      name: prof.name,
      collegeEmail: prof.collegeEmail,
      roles: ['STAFF'],
      userType: 'STAFF',
      departmentId: dept.id,
    };
    otherProfPrincipal = {
      id: otherProf.id,
      name: otherProf.name,
      collegeEmail: otherProf.collegeEmail,
      roles: ['STAFF'],
      userType: 'STAFF',
      departmentId: dept.id,
    };
    studentPrincipal = {
      id: std.id,
      name: std.name,
      collegeEmail: std.collegeEmail,
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: cls.id,
      departmentId: dept.id,
    };
    unassignedStudentPrincipal = {
      id: stdUnassigned.id,
      name: stdUnassigned.name,
      collegeEmail: stdUnassigned.collegeEmail,
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: clsOther.id,
      departmentId: dept.id,
    };

    // Enroll Reference Photo for testStudentId (Alice) using subjectARef
    const extRef = await matchingProvider.extractEmbedding(subjectARef);
    await db.insert(studentFaceProfiles).values({
      studentId: testStudentId,
      status: 'ACTIVE',
      referencePhotoKey: `ref_f8_${testStudentId}.jpg`,
      referenceEmbedding: extRef.embedding,
      modelVersion: 'sface-v1',
    });

    // Setup Hono Test Application
    app = new Hono();
    // Route middlewares injecting mock principals
    app.use('*', async (c, next) => {
      const authHeader = c.req.header('Authorization');
      if (authHeader === 'Bearer prof-token') {
        c.set('user', profPrincipal);
      } else if (authHeader === 'Bearer other-prof-token') {
        c.set('user', otherProfPrincipal);
      } else if (authHeader === 'Bearer student-token') {
        c.set('user', studentPrincipal);
        c.set('student', studentPrincipal);
      } else if (authHeader === 'Bearer unassigned-student-token') {
        c.set('user', unassignedStudentPrincipal);
        c.set('student', unassignedStudentPrincipal);
      }
      await next();
    });
    app.route('/api/attendance', attendanceRoutes);
    app.route('/api/students', studentRoutes);
  });

  // ============================================================================
  // Section A: Complete 10-Step Positive Automated Attendance Lifecycle
  // ============================================================================
  describe('A. Complete 10-Step Positive Automated Attendance Lifecycle', () => {
    let createdSessionId: string;
    let studentTokenStr: string;
    let challengeId: string;
    let challengeType: string;

    it('Step 1: Admin setup verified (class, subject, student, staff present in DB)', async () => {
      const [c] = await db.select().from(classes).where(eq(classes.id, testClassId));
      const [s] = await db.select().from(students).where(eq(students.id, testStudentId));
      expect(c).toBeDefined();
      expect(s).toBeDefined();
      expect(s.classId).toBe(testClassId);
    });

    it('Step 2: Reference photo enrolled with 128-d embedding', async () => {
      const [profile] = await db.select().from(studentFaceProfiles).where(eq(studentFaceProfiles.studentId, testStudentId));
      expect(profile).toBeDefined();
      expect(profile.status).toBe('ACTIVE');
      expect(profile.referenceEmbedding).toHaveLength(128);
    });

    it('Step 3: Professor starts attendance session -> returns ACTIVE session', async () => {
      const res = await app.request('/api/attendance/sessions/start', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer prof-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ timetableId: testTimetableId, date: new Date().toISOString().slice(0, 10) }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ACTIVE');
      createdSessionId = body.data.id;
      testSessionId = createdSessionId;
    });

    it('Step 4: Student discovers active session for their class', async () => {
      const res = await app.request('/api/students/me/attendance/current', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer student-token' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.session.id).toBe(createdSessionId);
    });

    it('Step 5: Student mints BLE token & Professor ingests BLE detection', async () => {
      // 5a. Student mints BLE token
      const tokenRes = await app.request('/api/students/me/attendance/ble-token', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer student-token' },
      });
      expect(tokenRes.status).toBe(200);
      const tokenBody = await tokenRes.json();
      expect(tokenBody.success).toBe(true);
      studentTokenStr = tokenBody.token;

      // 5b. Professor submits scanner detection
      const detRes = await app.request(`/api/attendance/sessions/${createdSessionId}/ble/detections`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer prof-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detections: [
            { token: studentTokenStr, rssi: -58, detectedAt: new Date().toISOString() },
          ],
        }),
      });
      expect(detRes.status).toBe(200);
      const detBody = await detRes.json();
      expect(detBody.data.accepted).toBe(1);
    });

    it('Step 6: Student requests active liveness challenge', async () => {
      const chRes = await app.request('/api/students/me/attendance/face-verification/liveness/challenge', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: createdSessionId }),
      });
      expect(chRes.status).toBe(200);
      const chBody = await chRes.json();
      expect(chBody.success).toBe(true);
      expect(chBody.data.challengeId).toBeDefined();
      expect(chBody.data.challengeType).toBeDefined();
      challengeId = chBody.data.challengeId;
      challengeType = chBody.data.challengeType;
    });

    it('Step 7: Student submits dual-frame verification -> succeeds with LIVE and MATCH', async () => {
      // Select appropriate action frame
      let actionBuf = subjectATurnLeft;
      if (challengeType === 'TURN_HEAD_RIGHT') actionBuf = subjectATurnRight;
      if (challengeType === 'BLINK') actionBuf = subjectABlink;

      const formData = new FormData();
      formData.append('sessionId', createdSessionId);
      formData.append('challengeId', challengeId);
      formData.append('baseSelfie', new Blob([new Uint8Array(subjectASelfie)], { type: 'image/jpeg' }), 'base.jpg');
      formData.append('actionSelfie', new Blob([new Uint8Array(actionBuf)], { type: 'image/jpeg' }), 'action.jpg');

      const vRes = await app.request('/api/students/me/attendance/face-verification/liveness/verify', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token' },
        body: formData,
      });

      expect(vRes.status).toBe(200);
      const vBody = await vRes.json();
      expect(vBody.success).toBe(true);
      expect(vBody.data.status).toBe('VERIFIED');
      expect(vBody.data.livenessResult).toBe('LIVE');
      expect(vBody.data.similarity).toBeGreaterThanOrEqual(0.40);
    });

    it('Step 8: Attendance record created as PRESENT with source BLE and verification record is VERIFIED', async () => {
      const [record] = await db
        .select()
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.attendanceSessionId, createdSessionId),
          eq(attendanceRecords.studentId, testStudentId)
        ));

      expect(record).toBeDefined();
      expect(record.status).toBe('PRESENT');
      expect(record.source).toBe('BLE');
      expect(record.markedAt).toBeDefined();

      const [faceVerif] = await db
        .select()
        .from(attendanceFaceVerifications)
        .where(and(
          eq(attendanceFaceVerifications.attendanceSessionId, createdSessionId),
          eq(attendanceFaceVerifications.studentId, testStudentId)
        ));

      expect(faceVerif).toBeDefined();
      expect(faceVerif.status).toBe('VERIFIED');
      expect(faceVerif.confidenceScore).toBeDefined();
      expect(faceVerif.livenessScore).toBeDefined();
    });

    it('Step 9: Professor reviews live roster -> student displayed as VERIFIED', async () => {
      const liveRes = await app.request(`/api/attendance/sessions/${createdSessionId}/live`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer prof-token' },
      });
      expect(liveRes.status).toBe(200);
      const liveBody = await liveRes.json();
      const studentEntry = liveBody.data.students.find((s: any) => s.studentId === testStudentId);
      expect(studentEntry).toBeDefined();
      expect(studentEntry.status).toBe('PRESENT');
      expect(studentEntry.faceVerificationStatus).toBe('VERIFIED');
    });

    it('Step 10: Session closes -> reports reflect verified attendance', async () => {
      // 10a. Professor ends session
      const endRes = await app.request(`/api/attendance/sessions/${createdSessionId}/end`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer prof-token' },
      });
      expect(endRes.status).toBe(200);
      const endBody = await endRes.json();
      expect(endBody.data.status).toBe('COMPLETED');

      // 10b. Class summary report check
      const rptRes = await app.request(`/api/attendance/reports/class-summary?classId=${testClassId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer prof-token' },
      });
      expect(rptRes.status).toBe(200);
      const rptBody = await rptRes.json();
      expect(rptBody.success).toBe(true);
      expect(rptBody.data.metrics.conductedSessions).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Section B: All 17 Negative Failure Scenarios (Section 9 Specification)
  // ============================================================================
  describe('B. All 17 Negative Failure Scenarios', () => {
    let failureSessionId: string;
    let failureStudentId: string;
    let failureStudentPrincipal: AuthPrincipal;

    beforeAll(async () => {
      // Create a fresh active session for negative failure testing
      const runKey = `f8neg_${Date.now()}`;
      const [regRow] = await db.select().from(regulations);
      const [subjNeg] = await db.insert(subjects).values({
        code: `NEG_${runKey.slice(-5)}`,
        name: 'Failure Scenarios Subject',
        subjectType: 'THEORY',
        regulationId: regRow.id,
        yearNumber: 3,
      }).returning();

      const [ttNeg] = await db.insert(timetables).values({
        classId: testClassId,
        subjectId: subjNeg.id,
        staffId: testStaffId,
        periodId: (await db.select().from(periods))[0].id,
        academicYearId: (await db.select().from(academicYears))[0].id,
        dayOfWeek: new Date().toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }).toUpperCase(),
      }).returning();

      const [sess] = await db.insert(attendanceSessions).values({
        timetableId: ttNeg.id,
        startedByStaffId: testStaffId,
        sessionDate: new Date().toISOString().slice(0, 10),
        status: 'ACTIVE',
      }).returning();
      failureSessionId = sess.id;

      // Cancelled session for testing
      const [sessCancelled] = await db.insert(attendanceSessions).values({
        timetableId: ttNeg.id,
        startedByStaffId: testStaffId,
        sessionDate: '2026-01-01',
        status: 'CANCELLED',
      }).returning();
      cancelledSessionId = sessCancelled.id;

      // Student with enrolled reference photo for failure testing
      const [sNeg] = await db.insert(students).values({
        registerNumber: `6177NEG_${runKey.slice(-4)}`,
        name: 'F8 Negative Test Student',
        collegeEmail: `f8neg_${runKey}@sonatech.ac.in`,
        classId: testClassId,
      }).returning();
      failureStudentId = sNeg.id;

      failureStudentPrincipal = {
        id: sNeg.id,
        name: sNeg.name,
        collegeEmail: sNeg.collegeEmail,
        roles: ['STUDENT'],
        userType: 'STUDENT',
        classId: testClassId,
        departmentId: testDeptId,
      };

      const ext = await matchingProvider.extractEmbedding(subjectARef);
      await db.insert(studentFaceProfiles).values({
        studentId: failureStudentId,
        status: 'ACTIVE',
        referencePhotoKey: `ref_neg_${failureStudentId}.jpg`,
        referenceEmbedding: ext.embedding,
        modelVersion: 'sface-v1',
      });
    });

    it('Scenario 1: Student not assigned to the class -> rejected with 403/404', async () => {
      const res = await app.request('/api/students/me/attendance/current', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer unassigned-student-token' },
      });
      // Unassigned student has no active session for their class
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session).toBeNull();
    });

    it('Scenario 2: No active session -> rejected with 400 or 404', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';
      const res = await app.request('/api/students/me/attendance/face-verification/liveness/challenge', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: fakeSessionId }),
      });
      expect([400, 404]).toContain(res.status);
    });

    it('Scenario 3: Expired / completed session -> rejected with 400', async () => {
      // Create expired/completed session
      const [closedSess] = await db.insert(attendanceSessions).values({
        timetableId: testTimetableId,
        startedByStaffId: testStaffId,
        sessionDate: '2026-01-02',
        status: 'COMPLETED',
      }).returning();

      const res = await app.request('/api/students/me/attendance/face-verification/liveness/challenge', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: closedSess.id }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('SESSION_NOT_ACTIVE');
    });

    it('Scenario 4: Invalid BLE token -> rejected (accepted: 0, rejected: 1)', async () => {
      const res = await app.request(`/api/attendance/sessions/${failureSessionId}/ble/detections`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer prof-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detections: [
            { token: '0123456789abcdef0123456789abcdef', rssi: -60, detectedAt: new Date().toISOString() },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.accepted).toBe(0);
      expect(body.data.rejected).toBe(1);
    });

    it('Scenario 5: BLE unavailable -> student attempts verification without BLE eligibility -> rejected', async () => {
      // failureStudentId does not have a BLE token in failureSessionId
      await expect(
        faceService.verifyStudentLivenessAndIdentity({
          sessionId: failureSessionId,
          studentId: failureStudentId,
          challengeId: 'dummy-ch-id',
          baseBuffer: subjectASelfie,
          actionBuffer: subjectATurnLeft,
        })
      ).rejects.toThrow('BLE_ELIGIBILITY_REQUIRED');

      // Verify no PRESENT attendance record exists
      const [rec] = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.attendanceSessionId, failureSessionId),
        eq(attendanceRecords.studentId, failureStudentId)
      ));
      expect(rec).toBeUndefined();
    });

    it('Scenario 6: Face mismatch (wrong reference identity) -> rejected without attendance mutation', async () => {
      // Grant BLE token to failureStudentId
      await db.insert(attendanceBleTokens).values({
        attendanceSessionId: failureSessionId,
        studentId: failureStudentId,
        tokenHash: 'f8_neg_ble_token',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'ACTIVE',
      });

      // Issue challenge
      const ch = await challengeService.createChallenge(failureStudentId, failureSessionId);

      // Submit subject B's face against Alice's enrolled profile (Mismatch)
      const result = await faceService.verifyStudentLivenessAndIdentity({
        sessionId: failureSessionId,
        studentId: failureStudentId,
        challengeId: ch.challengeId,
        baseBuffer: subjectBSelfie,
        actionBuffer: subjectBSelfie,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      // Verify attendance NOT marked PRESENT
      const [rec] = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.attendanceSessionId, failureSessionId),
        eq(attendanceRecords.studentId, failureStudentId)
      ));
      expect(rec).toBeUndefined();
    });

    it('Scenario 7: Liveness failure (static photo replay) -> rejected with STATIC_IMAGE_DETECTED', async () => {
      const ch = await challengeService.createChallenge(failureStudentId, failureSessionId);

      // Replay same static selfie image
      const result = await faceService.verifyStudentLivenessAndIdentity({
        sessionId: failureSessionId,
        studentId: failureStudentId,
        challengeId: ch.challengeId,
        baseBuffer: subjectASelfie,
        actionBuffer: subjectASelfie,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.livenessFailureReason).toBe('STATIC_IMAGE_DETECTED');

      // Verify attendance NOT marked
      const [rec] = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.attendanceSessionId, failureSessionId),
        eq(attendanceRecords.studentId, failureStudentId)
      ));
      expect(rec).toBeUndefined();
    });

    it('Scenario 8: Liveness inconclusive (no face detected in frame) -> rejected with NO_FACE_DETECTED', async () => {
      // Clear attempt count so MAX_ATTEMPTS_EXCEEDED does not mask the specific failure check
      await db.delete(attendanceFaceVerifications).where(eq(attendanceFaceVerifications.studentId, failureStudentId));

      const ch = await challengeService.createChallenge(failureStudentId, failureSessionId);

      const result = await faceService.verifyStudentLivenessAndIdentity({
        sessionId: failureSessionId,
        studentId: failureStudentId,
        challengeId: ch.challengeId,
        baseBuffer: subjectASelfie,
        actionBuffer: noFaceImg,
      });

      expect(result.success).toBe(false);
      expect(['SPOOF', 'INCONCLUSIVE']).toContain(result.livenessResult);
      expect(result.livenessFailureReason).toBe('NO_FACE_DETECTED');
    });

    it('Scenario 9: Expired challenge -> rejected with CHALLENGE_EXPIRED', async () => {
      // Insert challenge with expired timestamp
      const [expiredCh] = await db.insert(livenessChallenges).values({
        studentId: failureStudentId,
        attendanceSessionId: failureSessionId,
        challengeType: 'TURN_HEAD_LEFT',
        nonce: 'expired_nonce_123',
        expiresAt: new Date(Date.now() - 5000).toISOString(),
        status: 'PENDING',
      }).returning();

      await expect(
        challengeService.validateAndConsumeChallenge({
          challengeId: expiredCh.id,
          studentId: failureStudentId,
          sessionId: failureSessionId,
        })
      ).rejects.toThrow('CHALLENGE_EXPIRED');
    });

    it('Scenario 10: Replayed challenge -> rejected with CHALLENGE_ALREADY_USED', async () => {
      const ch = await challengeService.createChallenge(failureStudentId, failureSessionId);

      // Consume once
      await challengeService.validateAndConsumeChallenge({
        challengeId: ch.challengeId,
        studentId: failureStudentId,
        sessionId: failureSessionId,
      });

      // Attempt to reuse
      await expect(
        challengeService.validateAndConsumeChallenge({
          challengeId: ch.challengeId,
          studentId: failureStudentId,
          sessionId: failureSessionId,
        })
      ).rejects.toThrow('CHALLENGE_ALREADY_USED');
    });

    it('Scenario 11: Provider unavailable / not configured -> returns truthful NOT_CONFIGURED without marking PRESENT', async () => {
      // Clear attempt count for this scenario
      await db.delete(attendanceFaceVerifications).where(eq(attendanceFaceVerifications.studentId, failureStudentId));

      const unconfiguredService = new FaceVerificationService(
        new NotConfiguredFaceMatchingProvider(),
        undefined,
        new NotConfiguredLivenessProvider(),
        challengeService
      );

      const ch = await challengeService.createChallenge(failureStudentId, failureSessionId);
      const res = await unconfiguredService.verifyStudentLivenessAndIdentity({
        sessionId: failureSessionId,
        studentId: failureStudentId,
        challengeId: ch.challengeId,
        baseBuffer: subjectASelfie,
        actionBuffer: subjectATurnLeft,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.livenessFailureReason).toBe('PROVIDER_NOT_CONFIGURED');

      // Verify record is NOT marked PRESENT
      const [rec] = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.attendanceSessionId, failureSessionId),
        eq(attendanceRecords.studentId, failureStudentId)
      ));
      expect(rec).toBeUndefined();
    });

    it('Scenario 12: Network interruption / malformed request payload -> rejected with 400', async () => {
      const formData = new FormData();
      formData.append('sessionId', failureSessionId);
      // Missing challengeId, missing frames

      const res = await app.request('/api/students/me/attendance/face-verification/liveness/verify', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token' },
        body: formData,
      });
      expect(res.status).toBe(400);
    });

    it('Scenario 13: Duplicate verification submission -> rejected or returns existing state without duplication', async () => {
      // testStudentId is already VERIFIED in testSessionId
      const chRes = await app.request('/api/students/me/attendance/face-verification/liveness/challenge', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: testSessionId }),
      });
      // When session is completed or student is already marked present, challenge returns error
      expect([400, 409]).toContain(chRes.status);
    });

    it('Scenario 14: Student attempts self-marking through fallback -> request remains PENDING, student remains ABSENT', async () => {
      const fbRes = await app.request('/api/students/me/attendance/fallback-request', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: failureSessionId,
          reasonCategory: 'CAMERA_UNAVAILABLE',
          explanation: 'Front optical camera hardware sensor cracked.',
        }),
      });
      expect(fbRes.status).toBe(201);
      const fbBody = await fbRes.json();
      expect(fbBody.data.status).toBe('PENDING');

      // Verify student attendance is NOT marked PRESENT
      const [rec] = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.attendanceSessionId, failureSessionId),
        eq(attendanceRecords.studentId, testStudentId)
      ));
      expect(rec).toBeUndefined();
    });

    it('Scenario 15: Unauthorized professor attempts correction -> rejected with 403', async () => {
      const [recToCorrect] = await db.insert(attendanceRecords).values({
        attendanceSessionId: failureSessionId,
        studentId: testStudentId,
        status: 'ABSENT',
        source: 'MANUAL',
        markedAt: new Date().toISOString(),
      }).returning();

      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer other-prof-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: recToCorrect.id,
          newStatus: 'PRESENT',
          reason: 'Attempted unauthorized cross-class teacher override',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('Scenario 16: Correction submitted without a reason -> rejected with 400', async () => {
      const [recToCorrect] = await db.insert(attendanceRecords).values({
        attendanceSessionId: failureSessionId,
        studentId: failureStudentId,
        status: 'ABSENT',
        source: 'MANUAL',
        markedAt: new Date().toISOString(),
      }).returning();

      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer prof-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: recToCorrect.id,
          newStatus: 'PRESENT',
          reason: '   ', // Whitespace-only reason
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('CORRECTION_REASON_REQUIRED');
    });

    it('Scenario 17: Correction against a cancelled session -> rejected with 400', async () => {
      const [cancelledRec] = await db.insert(attendanceRecords).values({
        attendanceSessionId: cancelledSessionId,
        studentId: testStudentId,
        status: 'ABSENT',
        source: 'MANUAL',
        markedAt: new Date().toISOString(),
      }).returning();

      const res = await app.request('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer prof-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: cancelledRec.id,
          newStatus: 'PRESENT',
          reason: 'Attempting to correct attendance in a cancelled session',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('SESSION_CANCELLED');
    });
  });
});

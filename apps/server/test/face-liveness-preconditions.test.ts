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
import { staff } from '../src/db/schema/staff';
import { attendanceBleTokens } from '../src/db/schema/attendance-ble-tokens';
import { attendanceRecords } from '../src/db/schema/attendance-records';
import { studentFaceProfiles, attendanceFaceVerifications, livenessChallenges } from '../src/db/schema/face-verification';
import { FaceVerificationService } from '../src/services/face-verification.service';
import { OpenCvSFaceFaceMatchingProvider } from '../src/services/face-matching-provider';
import { OpenCvChallengeLivenessProvider } from '../src/services/liveness-provider';
import { LivenessChallengeService } from '../src/services/liveness-challenge.service';
import { studentRoutes } from '../src/routes/students';
import { eq, and } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Milestone F6 — Full Liveness Preconditions & Attendance Marking Verification', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const modelsDir = path.resolve(__dirname, '../models');

  let subjectARef: Buffer;
  let subjectASelfie: Buffer;
  let subjectATurnLeft: Buffer;
  let subjectATurnRight: Buffer;
  let subjectABlink: Buffer;
  let subjectBSelfie: Buffer;

  let testDeptId: string;
  let testClassId: string;
  let testStudentId: string;
  let testStudentUser: any;
  let testSessionId: string;
  let testTimetableId: string;

  let livenessProvider: OpenCvChallengeLivenessProvider;
  let matchingProvider: OpenCvSFaceFaceMatchingProvider;
  let faceService: FaceVerificationService;
  let challengeService: LivenessChallengeService;

  beforeAll(async () => {
    subjectARef = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_ref.jpg'));
    subjectASelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_selfie.jpg'));
    subjectATurnLeft = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_turn_left.jpg'));
    subjectATurnRight = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_turn_right.jpg'));
    subjectABlink = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_blink.jpg'));
    subjectBSelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_selfie.jpg'));

    matchingProvider = new OpenCvSFaceFaceMatchingProvider({
      modelsDir,
      defaultThreshold: 0.40,
      minConfidence: 0.60,
    });

    livenessProvider = new OpenCvChallengeLivenessProvider({
      modelsDir,
      defaultThreshold: 0.40,
      minConfidence: 0.60,
    });

    challengeService = new LivenessChallengeService();
    faceService = new FaceVerificationService(matchingProvider, undefined, livenessProvider, challengeService);

    // Setup academic hierarchy
    let dept = await db.select().from(departments).limit(1).then(r => r[0]);
    if (!dept) {
      dept = await db.insert(departments).values({
        name: 'Computer Science Preconditions',
        code: 'CSP_' + Date.now().toString().slice(-4),
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }
    testDeptId = dept.id;

    let ay = await db.select().from(academicYears).limit(1).then(r => r[0]);
    if (!ay) {
      ay = await db.insert(academicYears).values({
        name: `AY-${Date.now()}`,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        isCurrent: true,
      }).returning().then(r => r[0]);
    }

    let batch = await db.select().from(batches).limit(1).then(r => r[0]);
    if (!batch) {
      batch = await db.insert(batches).values({
        name: `BATCH-${Date.now()}`,
        startYear: 2024,
        endYear: 2028,
        departmentId: testDeptId,
      }).returning().then(r => r[0]);
    }

    let reg = await db.select().from(regulations).limit(1).then(r => r[0]);
    if (!reg) {
      reg = await db.insert(regulations).values({
        name: `REG-${Date.now()}`,
        year: 2023,
      }).returning().then(r => r[0]);
    }

    let cls = await db.select().from(classes).where(eq(classes.departmentId, testDeptId)).limit(1).then(r => r[0]);
    if (!cls) {
      cls = await db.insert(classes).values({
        name: 'CSE Preconditions F6',
        yearNumber: 3,
        section: 'A',
        departmentId: testDeptId,
        academicYearId: ay.id,
        batchId: batch.id,
        regulationId: reg.id,
      }).returning().then(r => r[0]);
    }
    testClassId = cls.id;

    const [std] = await db.insert(students).values({
      classId: testClassId,
      registerNumber: 'PREC_' + Date.now().toString().slice(-6),
      name: 'Grace Hopper',
      collegeEmail: `grace.${Date.now()}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning();
    testStudentId = std.id;
    testStudentUser = {
      id: std.id,
      name: std.name,
      collegeEmail: std.collegeEmail,
      userType: 'STUDENT',
      roles: ['STUDENT'],
      classId: testClassId,
    };

    let staffMember = await db.select().from(staff).limit(1).then(r => r[0]);
    if (!staffMember) {
      staffMember = await db.insert(staff).values({
        staffCode: `STF-${Date.now().toString().slice(-4)}`,
        name: 'Prof. Hopper',
        collegeEmail: `hopper.staff.${Date.now()}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }

    let subj = await db.select().from(subjects).limit(1).then(r => r[0]);
    if (!subj) {
      subj = await db.insert(subjects).values({
        code: `CSP${Date.now().toString().slice(-4)}`,
        name: 'Preconditions Liveness',
        subjectType: 'THEORY',
        yearNumber: 3,
        regulationId: reg.id,
      }).returning().then(r => r[0]);
    }

    let prd = await db.select().from(periods).limit(1).then(r => r[0]);
    if (!prd) {
      prd = await db.insert(periods).values({
        periodNumber: 88,
        name: 'Period 88',
        startTime: '11:00',
        endTime: '12:00',
      }).returning().then(r => r[0]);
    }

    let tt = await db.select().from(timetables).where(eq(timetables.classId, testClassId)).limit(1).then(r => r[0]);
    if (!tt) {
      tt = await db.insert(timetables).values({
        academicYearId: ay.id,
        classId: testClassId,
        dayOfWeek: 'THURSDAY',
        subjectId: subj.id,
        staffId: staffMember.id,
        periodId: prd.id,
      }).returning().then(r => r[0]);
    }
    testTimetableId = tt.id;

    let [sess] = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, '2026-11-09')))
      .limit(1);
    if (!sess) {
      [sess] = await db.insert(attendanceSessions).values({
        timetableId: tt.id,
        sessionDate: '2026-11-09',
        status: 'ACTIVE',
      }).returning();
    } else if (sess.status !== 'ACTIVE') {
      [sess] = await db.update(attendanceSessions).set({ status: 'ACTIVE' }).where(eq(attendanceSessions.id, sess.id)).returning();
    }
    testSessionId = sess.id;
  });

  describe('1. Precondition Checks Before Liveness Challenge or Attendance', () => {
    it('Precondition: fails if BLE attendance eligibility is not met', async () => {
      // testStudentId has not yet received a BLE token in testSessionId
      await expect(
        faceService.verifyStudentLivenessAndIdentity({
          sessionId: testSessionId,
          studentId: testStudentId,
          challengeId: 'dummy-challenge-id',
          baseBuffer: subjectASelfie,
          actionBuffer: subjectATurnLeft,
        })
      ).rejects.toThrow('BLE_ELIGIBILITY_REQUIRED');
    });

    it('Precondition: fails if student face reference photo is not enrolled', async () => {
      // Grant BLE token
      await db.insert(attendanceBleTokens).values({
        attendanceSessionId: testSessionId,
        studentId: testStudentId,
        tokenHash: 'grace_hopper_ble_token',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'ACTIVE',
      });

      // Still no face profile enrolled
      await expect(
        faceService.verifyStudentLivenessAndIdentity({
          sessionId: testSessionId,
          studentId: testStudentId,
          challengeId: 'dummy-challenge-id',
          baseBuffer: subjectASelfie,
          actionBuffer: subjectATurnLeft,
        })
      ).rejects.toThrow('STUDENT_NOT_ENROLLED');
    });

    it('Precondition: fails if challenge is invalid or already consumed', async () => {
      // Enroll reference photo with embedding
      const ext = await matchingProvider.extractEmbedding(subjectARef);
      await db.insert(studentFaceProfiles).values({
        studentId: testStudentId,
        status: 'ACTIVE',
        referencePhotoKey: 'grace_ref.jpg',
        referenceEmbedding: ext.embedding,
        modelVersion: 'sface-v1',
      });

      // Issue challenge
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      // Consume it once manually
      await challengeService.validateAndConsumeChallenge({
        challengeId: challenge.challengeId,
        studentId: testStudentId,
        sessionId: testSessionId,
      });

      // Now attempt verification with the consumed challenge
      await expect(
        faceService.verifyStudentLivenessAndIdentity({
          sessionId: testSessionId,
          studentId: testStudentId,
          challengeId: challenge.challengeId,
          baseBuffer: subjectASelfie,
          actionBuffer: subjectATurnLeft,
        })
      ).rejects.toThrow('CHALLENGE_ALREADY_USED');
    });
  });

  describe('2. Anti-Spoofing Rejection & Absence of Attendance Mutation', () => {
    it('rejects static photo replay and DOES NOT mutate attendance record to PRESENT', async () => {
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      // Submit identical frame for base and action (spoof attack)
      const result = await faceService.verifyStudentLivenessAndIdentity({
        sessionId: testSessionId,
        studentId: testStudentId,
        challengeId: challenge.challengeId,
        baseBuffer: subjectASelfie,
        actionBuffer: subjectASelfie, // Spoof: same static image!
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.livenessFailureReason).toBe('STATIC_IMAGE_DETECTED');

      // Verify attendance record was NOT marked PRESENT
      const [record] = await db
        .select()
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.attendanceSessionId, testSessionId),
          eq(attendanceRecords.studentId, testStudentId)
        ));

      expect(record).toBeUndefined();
    });
  });

  describe('3. Successful Liveness & Face Verification Marks Attendance PRESENT', () => {
    it('strictly satisfies all 7 preconditions, verifies liveness, and marks record PRESENT with source BLE', async () => {
      // Request active challenge
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      // Select matching action frame based on challengeType
      let actionBuf: Buffer;
      if (challenge.challengeType === 'TURN_HEAD_LEFT') {
        actionBuf = subjectATurnLeft;
      } else if (challenge.challengeType === 'TURN_HEAD_RIGHT') {
        actionBuf = subjectATurnRight;
      } else {
        actionBuf = subjectABlink;
      }

      const result = await faceService.verifyStudentLivenessAndIdentity({
        sessionId: testSessionId,
        studentId: testStudentId,
        challengeId: challenge.challengeId,
        baseBuffer: subjectASelfie,
        actionBuffer: actionBuf,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('VERIFIED');
      expect(result.livenessResult).toBe('LIVE');
      expect(result.similarity).toBeGreaterThanOrEqual(0.40);
      expect(result.livenessScore).toBeGreaterThanOrEqual(0.80);
      expect(result.verifiedAt).toBeDefined();

      // Verify database record has been marked PRESENT with source BLE
      const [record] = await db
        .select()
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.attendanceSessionId, testSessionId),
          eq(attendanceRecords.studentId, testStudentId)
        ));

      expect(record).toBeDefined();
      expect(record.status).toBe('PRESENT');
      expect(record.source).toBe('BLE');
      expect(record.markedAt).toBeDefined();

      // Verify face verification attempt is logged in audit / verification tables
      const [verifLog] = await db
        .select()
        .from(attendanceFaceVerifications)
        .where(and(
          eq(attendanceFaceVerifications.attendanceSessionId, testSessionId),
          eq(attendanceFaceVerifications.studentId, testStudentId),
          eq(attendanceFaceVerifications.status, 'VERIFIED')
        ));

      expect(verifLog).toBeDefined();
      expect(verifLog.status).toBe('VERIFIED');
      expect(verifLog.confidenceScore).toBeDefined();
      expect(verifLog.livenessScore).toBeDefined();
    });
  });
});

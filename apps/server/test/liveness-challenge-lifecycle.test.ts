import { describe, expect, it, beforeAll } from 'vitest';
import { db } from '../src/db';
import { students } from '../src/db/schema/students';
import { departments, classes, academicYears, batches, regulations } from '../src/db/schema/academic';
import { attendanceSessions } from '../src/db/schema/attendance';
import { timetables, periods } from '../src/db/schema/timetable';
import { staff } from '../src/db/schema/staff';
import { subjects } from '../src/db/schema/subjects';
import { attendanceBleTokens } from '../src/db/schema/attendance-ble-tokens';
import { studentFaceProfiles, livenessChallenges } from '../src/db/schema/face-verification';
import { LivenessChallengeService } from '../src/services/liveness-challenge.service';
import { eq, and } from 'drizzle-orm';

describe('Milestone F6 — Liveness Challenge Lifecycle & Replay Protection', () => {
  let challengeService: LivenessChallengeService;
  let testStudentId: string;
  let otherStudentId: string;
  let testSessionId: string;
  let otherSessionId: string;
  let inactiveSessionId: string;

  beforeAll(async () => {
    challengeService = new LivenessChallengeService();

    let dept = await db.select().from(departments).limit(1).then(r => r[0]);
    if (!dept) {
      dept = await db.insert(departments).values({
        name: 'Computer Science Liveness',
        code: 'CSL_' + Date.now().toString().slice(-4),
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }

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
        departmentId: dept.id,
      }).returning().then(r => r[0]);
    }

    let reg = await db.select().from(regulations).limit(1).then(r => r[0]);
    if (!reg) {
      reg = await db.insert(regulations).values({
        name: `REG-${Date.now()}`,
        year: 2023,
      }).returning().then(r => r[0]);
    }

    let cls = await db.select().from(classes).where(eq(classes.departmentId, dept.id)).limit(1).then(r => r[0]);
    if (!cls) {
      cls = await db.insert(classes).values({
        name: 'CSE Liveness F6',
        yearNumber: 3,
        section: 'A',
        departmentId: dept.id,
        academicYearId: ay.id,
        batchId: batch.id,
        regulationId: reg.id,
      }).returning().then(r => r[0]);
    }

    const [std1] = await db.insert(students).values({
      classId: cls.id,
      registerNumber: 'LIVE_' + Date.now().toString().slice(-6),
      name: 'Ada Lovelace',
      collegeEmail: `live.student.${Date.now()}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning();
    testStudentId = std1.id;

    const [std2] = await db.insert(students).values({
      classId: cls.id,
      registerNumber: 'LIVE2_' + Date.now().toString().slice(-6),
      name: 'Charles Babbage',
      collegeEmail: `live2.student.${Date.now()}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning();
    otherStudentId = std2.id;

    // Enroll reference profile for testStudentId
    await db.insert(studentFaceProfiles).values({
      studentId: testStudentId,
      status: 'ACTIVE',
      referencePhotoKey: 'live_test_ref_key.jpg',
      modelVersion: 'arcface-r100-v1',
    });

    let staffMember = await db.select().from(staff).limit(1).then(r => r[0]);
    if (!staffMember) {
      staffMember = await db.insert(staff).values({
        staffCode: `STF-${Date.now().toString().slice(-4)}`,
        name: 'Prof. Liveness',
        collegeEmail: `live.staff.${Date.now()}@sonatech.ac.in`,
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }

    let subj = await db.select().from(subjects).limit(1).then(r => r[0]);
    if (!subj) {
      subj = await db.insert(subjects).values({
        code: `CSL${Date.now().toString().slice(-4)}`,
        name: 'Anti Spoofing',
        subjectType: 'THEORY',
        yearNumber: 3,
        regulationId: reg.id,
      }).returning().then(r => r[0]);
    }

    let prd = await db.select().from(periods).limit(1).then(r => r[0]);
    if (!prd) {
      prd = await db.insert(periods).values({
        periodNumber: 99,
        name: 'Period 99',
        startTime: '10:00',
        endTime: '11:00',
      }).returning().then(r => r[0]);
    }

    let tt = await db.select().from(timetables).where(eq(timetables.classId, cls.id)).limit(1).then(r => r[0]);
    if (!tt) {
      tt = await db.insert(timetables).values({
        academicYearId: ay.id,
        classId: cls.id,
        dayOfWeek: 'FRIDAY',
        subjectId: subj.id,
        staffId: staffMember.id,
        periodId: prd.id,
      }).returning().then(r => r[0]);
    }

    let [activeSess] = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, '2026-11-06')))
      .limit(1);
    if (!activeSess) {
      [activeSess] = await db.insert(attendanceSessions).values({
        timetableId: tt.id,
        sessionDate: '2026-11-06',
        status: 'ACTIVE',
      }).returning();
    } else if (activeSess.status !== 'ACTIVE') {
      [activeSess] = await db.update(attendanceSessions).set({ status: 'ACTIVE' }).where(eq(attendanceSessions.id, activeSess.id)).returning();
    }
    testSessionId = activeSess.id;

    let [otherSess] = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, '2026-11-07')))
      .limit(1);
    if (!otherSess) {
      [otherSess] = await db.insert(attendanceSessions).values({
        timetableId: tt.id,
        sessionDate: '2026-11-07',
        status: 'ACTIVE',
      }).returning();
    } else if (otherSess.status !== 'ACTIVE') {
      [otherSess] = await db.update(attendanceSessions).set({ status: 'ACTIVE' }).where(eq(attendanceSessions.id, otherSess.id)).returning();
    }
    otherSessionId = otherSess.id;

    let [inactSess] = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, '2026-11-08')))
      .limit(1);
    if (!inactSess) {
      [inactSess] = await db.insert(attendanceSessions).values({
        timetableId: tt.id,
        sessionDate: '2026-11-08',
        status: 'COMPLETED',
      }).returning();
    } else if (inactSess.status !== 'COMPLETED') {
      [inactSess] = await db.update(attendanceSessions).set({ status: 'COMPLETED' }).where(eq(attendanceSessions.id, inactSess.id)).returning();
    }
    inactiveSessionId = inactSess.id;

    // Grant BLE eligibility to testStudentId in testSessionId
    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'sample_ble_token_hash_liveness',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: 'ACTIVE',
    });
  });

  describe('1. Unpredictable Challenge Generation', () => {
    it('successfully issues unpredictable challenge bounded to student and session', async () => {
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      expect(challenge).toBeDefined();
      expect(challenge.challengeId).toBeDefined();
      expect(['TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT', 'BLINK']).toContain(challenge.challengeType);
      expect(challenge.promptInstruction).toBeDefined();
      expect(challenge.ttlSeconds).toBe(90);
      expect(challenge.sessionId).toBe(testSessionId);

      const [record] = await db
        .select()
        .from(livenessChallenges)
        .where(eq(livenessChallenges.id, challenge.challengeId));

      expect(record).toBeDefined();
      expect(record.status).toBe('PENDING');
      expect(record.studentId).toBe(testStudentId);
      expect(record.attendanceSessionId).toBe(testSessionId);
      expect(record.nonce).toHaveLength(64);
    });

    it('rejects challenge request when session is not ACTIVE', async () => {
      await expect(
        challengeService.createChallenge(testStudentId, inactiveSessionId)
      ).rejects.toThrow('SESSION_NOT_ACTIVE');
    });

    it('rejects challenge request when student has no BLE eligibility', async () => {
      // otherStudentId has no BLE token or record in testSessionId
      await expect(
        challengeService.createChallenge(otherStudentId, testSessionId)
      ).rejects.toThrow('BLE_ELIGIBILITY_REQUIRED');
    });

    it('rejects challenge request when student has no enrolled reference photo', async () => {
      // Grant BLE eligibility to otherStudentId, but otherStudentId has NO face profile enrolled
      await db.insert(attendanceBleTokens).values({
        attendanceSessionId: testSessionId,
        studentId: otherStudentId,
        tokenHash: 'other_ble_token_hash',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'ACTIVE',
      });

      await expect(
        challengeService.createChallenge(otherStudentId, testSessionId)
      ).rejects.toThrow('STUDENT_NOT_ENROLLED');
    });
  });

  describe('2. Single-Use Consumption and Replay Protection', () => {
    it('allows valid consumption on first attempt and invalidates challenge immediately', async () => {
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      const consumed = await challengeService.validateAndConsumeChallenge({
        challengeId: challenge.challengeId,
        studentId: testStudentId,
        sessionId: testSessionId,
      });

      expect(consumed.id).toBe(challenge.challengeId);
      expect(consumed.challengeType).toBe(challenge.challengeType);

      // Verify second attempt with SAME challenge fails (replay protection)
      await expect(
        challengeService.validateAndConsumeChallenge({
          challengeId: challenge.challengeId,
          studentId: testStudentId,
          sessionId: testSessionId,
        })
      ).rejects.toThrow('CHALLENGE_ALREADY_USED');
    });

    it('rejects consumption when challenge is presented by a different student', async () => {
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      await expect(
        challengeService.validateAndConsumeChallenge({
          challengeId: challenge.challengeId,
          studentId: otherStudentId, // Wrong student attempting to hijack challenge
          sessionId: testSessionId,
        })
      ).rejects.toThrow('CHALLENGE_STUDENT_MISMATCH');
    });

    it('rejects consumption when challenge is presented for a different session', async () => {
      const challenge = await challengeService.createChallenge(testStudentId, testSessionId);

      await expect(
        challengeService.validateAndConsumeChallenge({
          challengeId: challenge.challengeId,
          studentId: testStudentId,
          sessionId: otherSessionId, // Wrong session
        })
      ).rejects.toThrow('CHALLENGE_SESSION_MISMATCH');
    });

    it('rejects consumption when challenge TTL has expired', async () => {
      // Insert an expired challenge
      const [expiredRecord] = await db
        .insert(livenessChallenges)
        .values({
          studentId: testStudentId,
          attendanceSessionId: testSessionId,
          challengeType: 'TURN_HEAD_LEFT',
          nonce: 'expired_nonce_123',
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 5000).toISOString(), // 5 seconds in the past
        })
        .returning();

      await expect(
        challengeService.validateAndConsumeChallenge({
          challengeId: expiredRecord.id,
          studentId: testStudentId,
          sessionId: testSessionId,
        })
      ).rejects.toThrow('CHALLENGE_EXPIRED');
    });
  });
});

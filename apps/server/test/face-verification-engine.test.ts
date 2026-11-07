import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db';
import { students } from '../src/db/schema/students';
import { classes, departments, academicYears, batches, regulations } from '../src/db/schema/academic';
import { attendanceSessions } from '../src/db/schema/attendance';
import { timetables, periods } from '../src/db/schema/timetable';
import { subjects } from '../src/db/schema/subjects';
import { staff } from '../src/db/schema/staff';
import { attendanceBleTokens } from '../src/db/schema/attendance-ble-tokens';
import { attendanceRecords } from '../src/db/schema/attendance-records';
import { studentFaceProfiles, attendanceFaceVerifications } from '../src/db/schema/face-verification';
import { FaceVerificationService } from '../src/services/face-verification.service';
import {
  OpenCvSFaceFaceMatchingProvider,
  NotConfiguredFaceMatchingProvider,
} from '../src/services/face-matching-provider';
import { eq, and } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Milestone F5 — Face Verification Service & Biometric Engine Integration', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const modelsDir = path.resolve(__dirname, '../models');

  let subjectARef: Buffer;
  let subjectASelfie: Buffer;
  let subjectBSelfie: Buffer;
  let noFaceImg: Buffer;
  let multiFaceImg: Buffer;

  let testDeptId: string;
  let testClassId: string;
  let testStudentId: string;
  let testSessionId: string;

  let biometricProvider: OpenCvSFaceFaceMatchingProvider;
  let service: FaceVerificationService;

  beforeAll(async () => {
    subjectARef = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_ref.jpg'));
    subjectASelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_selfie.jpg'));
    subjectBSelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_selfie.jpg'));
    noFaceImg = fs.readFileSync(path.join(fixturesDir, 'face_no_face.jpg'));
    multiFaceImg = fs.readFileSync(path.join(fixturesDir, 'face_multi_face.jpg'));

    biometricProvider = new OpenCvSFaceFaceMatchingProvider({
      modelsDir,
      defaultThreshold: 0.40,
      minConfidence: 0.60,
    });
    service = new FaceVerificationService(biometricProvider);

    // Setup academic hierarchy in database
    let dept = await db.select().from(departments).limit(1).then(r => r[0]);
    if (!dept) {
      dept = await db.insert(departments).values({
        name: 'Computer Science Biometrics',
        code: 'CSB_' + Date.now().toString().slice(-4),
        status: 'ACTIVE',
      }).returning().then(r => r[0]);
    }
    testDeptId = dept.id;

    let cls = await db.select().from(classes).where(eq(classes.departmentId, testDeptId)).limit(1).then(r => r[0]);
    if (!cls) {
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

      cls = await db.insert(classes).values({
        name: 'CSE Biometrics F5',
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
      registerNumber: 'BIO_' + Date.now().toString().slice(-6),
      name: 'Eileen Collins',
      collegeEmail: `biotest_${Date.now()}@sonatech.ac.in`,
      status: 'ACTIVE',
    }).returning();
    testStudentId = std.id;

    let tt = await db.select().from(timetables).where(eq(timetables.classId, testClassId)).limit(1).then(r => r[0]);
    if (!tt) {
      let staffMember = await db.select().from(staff).limit(1).then(r => r[0]);
      if (!staffMember) {
        staffMember = await db.insert(staff).values({
          staffCode: `STF-${Date.now().toString().slice(-4)}`,
          name: 'Prof. Biometrics',
          collegeEmail: `bio.staff.${Date.now()}@sonatech.ac.in`,
          status: 'ACTIVE',
        }).returning().then(r => r[0]);
      }

      let subj = await db.select().from(subjects).limit(1).then(r => r[0]);
      if (!subj) {
        subj = await db.insert(subjects).values({
          code: `CS${Date.now().toString().slice(-4)}`,
          name: 'Biometric Security',
          subjectType: 'THEORY',
          yearNumber: 3,
          regulationId: cls.regulationId,
        }).returning().then(r => r[0]);
      }

      let prd = await db.select().from(periods).limit(1).then(r => r[0]);
      if (!prd) {
        prd = await db.insert(periods).values({
          periodNumber: 1,
          name: 'Period 1',
          startTime: '09:00',
          endTime: '10:00',
        }).returning().then(r => r[0]);
      }

      tt = await db.insert(timetables).values({
        academicYearId: cls.academicYearId,
        classId: testClassId,
        dayOfWeek: 'THURSDAY',
        subjectId: subj.id,
        staffId: staffMember.id,
        periodId: prd.id,
      }).returning().then(r => r[0]);
    }

    let [sess] = await db
      .select()
      .from(attendanceSessions)
      .where(and(
        eq(attendanceSessions.timetableId, tt.id),
        eq(attendanceSessions.sessionDate, '2026-11-05')
      ))
      .limit(1);

    if (!sess) {
      [sess] = await db.insert(attendanceSessions).values({
        timetableId: tt.id,
        sessionDate: '2026-11-05',
        status: 'ACTIVE',
      }).returning();
    } else if (sess.status !== 'ACTIVE') {
      [sess] = await db
        .update(attendanceSessions)
        .set({ status: 'ACTIVE' })
        .where(eq(attendanceSessions.id, sess.id))
        .returning();
    }
    testSessionId = sess.id;
  });

  beforeEach(async () => {
    // Purge previous verification records and tokens for clean isolation
    await db.delete(attendanceFaceVerifications)
      .where(eq(attendanceFaceVerifications.studentId, testStudentId));
    await db.delete(attendanceRecords)
      .where(eq(attendanceRecords.studentId, testStudentId));
    await db.delete(attendanceBleTokens)
      .where(eq(attendanceBleTokens.studentId, testStudentId));
  });

  it('enrolls reference photo and pre-extracts 128-d reference embedding into database', async () => {
    const profile = await service.enrollReferencePhoto({
      studentId: testStudentId,
      buffer: subjectARef,
      reason: 'Enrolled official college photo for biometric matching',
    });

    expect(profile.status).toBe('ACTIVE');
    expect(profile.referencePhotoKey).toBeDefined();

    // Verify database record has reference_embedding populated
    const [row] = await db
      .select({
        refKey: studentFaceProfiles.referencePhotoKey,
        refEmb: studentFaceProfiles.referenceEmbedding,
        model: studentFaceProfiles.embeddingModel,
      })
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, testStudentId));

    expect(row.refKey).toBe(profile.referencePhotoKey);
    expect(row.refEmb).toBeDefined();
    expect(Array.isArray(row.refEmb)).toBe(true);
    expect((row.refEmb as number[]).length).toBe(128);
    expect(row.model).toBe('sface-v1');
  });

  it('rejects face verification when student has NO BLE eligibility (BLE_ELIGIBILITY_REQUIRED)', async () => {
    await expect(service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectASelfie,
    })).rejects.toThrow('BLE_ELIGIBILITY_REQUIRED');
  });

  it('successfully verifies genuine matching selfie when BLE verified, and marks attendance PRESENT atomically', async () => {
    // 1. Grant BLE eligibility via token
    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'ble_hash_' + Date.now(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'ACTIVE',
    });

    // 2. Student captures and submits matching selfie
    const res = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectASelfie,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('VERIFIED');
    expect(res.attemptNumber).toBe(1);
    expect(res.remainingAttempts).toBe(2);
    expect(res.verifiedAt).toBeDefined();

    // 3. Confirm attendance record was marked PRESENT atomically
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
  });

  it('rejects an impostor mismatch selfie, decrements remaining attempts, and DOES NOT mark attendance PRESENT', async () => {
    // 1. Grant BLE eligibility
    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'ble_hash_' + Date.now(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'ACTIVE',
    });

    // 2. Submit Subject B selfie against Subject A reference
    const res = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectBSelfie,
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('FAILED');
    expect(res.failureReason).toBe('FACE_MISMATCH');
    expect(res.attemptNumber).toBe(1);
    expect(res.remainingAttempts).toBe(2);

    // 3. Confirm attendance record was NOT marked PRESENT
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, testSessionId),
        eq(attendanceRecords.studentId, testStudentId)
      ));

    expect(record).toBeUndefined();
  });

  it('rejects selfie with no face detected (NO_FACE_DETECTED) without marking attendance', async () => {
    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'ble_hash_' + Date.now(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'ACTIVE',
    });

    const res = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: noFaceImg,
    });

    expect(res.success).toBe(false);
    expect(res.failureReason).toBe('NO_FACE_DETECTED');
    expect(res.attemptNumber).toBe(1);

    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, testSessionId),
        eq(attendanceRecords.studentId, testStudentId)
      ));
    expect(record).toBeUndefined();
  });

  it('rejects selfie with multiple faces detected (MULTIPLE_FACES_DETECTED)', async () => {
    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'ble_hash_' + Date.now(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'ACTIVE',
    });

    const res = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: multiFaceImg,
    });

    expect(res.success).toBe(false);
    expect(res.failureReason).toBe('MULTIPLE_FACES_DETECTED');
  });

  it('enforces attempt limit strictly (max 3 attempts per session)', async () => {
    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'ble_hash_' + Date.now(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'ACTIVE',
    });

    // Attempt 1: mismatch
    const a1 = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectBSelfie,
    });
    expect(a1.attemptNumber).toBe(1);
    expect(a1.remainingAttempts).toBe(2);

    // Attempt 2: mismatch
    const a2 = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectBSelfie,
    });
    expect(a2.attemptNumber).toBe(2);
    expect(a2.remainingAttempts).toBe(1);

    // Attempt 3: mismatch
    const a3 = await service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectBSelfie,
    });
    expect(a3.attemptNumber).toBe(3);
    expect(a3.remainingAttempts).toBe(0);

    // Attempt 4: blocked
    await expect(service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectASelfie,
    })).rejects.toThrow('MAX_ATTEMPTS_EXCEEDED');
  });

  it('rejects verification when reference photo is REVOKED', async () => {
    await service.revokeReferencePhoto({
      studentId: testStudentId,
      reason: 'Photo expired or invalid',
    });

    await db.insert(attendanceBleTokens).values({
      attendanceSessionId: testSessionId,
      studentId: testStudentId,
      tokenHash: 'ble_hash_' + Date.now(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'ACTIVE',
    });

    await expect(service.verifyStudentFace({
      sessionId: testSessionId,
      studentId: testStudentId,
      selfieBuffer: subjectASelfie,
    })).rejects.toThrow('STUDENT_NOT_ENROLLED');
  });

  it('never exposes raw biometric embeddings in public StudentFaceProfile responses', async () => {
    // Re-enroll to active state
    await service.enrollReferencePhoto({
      studentId: testStudentId,
      buffer: subjectARef,
    });

    const publicProfile = await service.getStudentFaceProfile(testStudentId);
    expect(publicProfile.studentId).toBe(testStudentId);
    expect(publicProfile.status).toBe('ACTIVE');
    expect((publicProfile as any).referenceEmbedding).toBeUndefined();
  });
});

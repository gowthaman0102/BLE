import { db } from '../db';
import { studentFaceProfiles, attendanceFaceVerifications, faceProfileStatusEnum } from '../db/schema/face-verification';
import { students } from '../db/schema/students';
import { classes } from '../db/schema/academic';
import { attendanceSessions } from '../db/schema/attendance';
import { timetables } from '../db/schema/timetable';
import { attendanceBleTokens } from '../db/schema/attendance-ble-tokens';
import { attendanceRecords } from '../db/schema/attendance-records';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import { AuditService } from './audit.service';
import {
  FaceMatchingProvider,
  NotConfiguredFaceMatchingProvider,
  OpenCvSFaceFaceMatchingProvider,
} from './face-matching-provider';
import {
  FaceLivenessProvider,
  NotConfiguredLivenessProvider,
  OpenCvChallengeLivenessProvider,
} from './liveness-provider';
import { LivenessChallengeService } from './liveness-challenge.service';
import { ReferencePhotoStorageProvider } from './storage/storage-provider';
import { LocalReferencePhotoStorage } from './storage/local-reference-photo-storage';
import { ImageValidationService } from './image-validation.service';
import { getConfig } from '../config/env';
import type {
  StudentFaceProfile,
  FaceProfileStatus,
  FaceVerificationResponse,
  StudentFaceVerificationStatus,
  FaceVerificationStatus,
  LivenessChallengeType,
  LivenessResult,
  LivenessFailureReason,
  LivenessVerificationResponse,
} from '@smart-attendance/shared';

export interface AuditActor {
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  departmentId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class FaceVerificationService {
  private audit = new AuditService();
  private provider: FaceMatchingProvider;
  private storageProvider: ReferencePhotoStorageProvider;
  private livenessProvider: FaceLivenessProvider;
  private challengeService: LivenessChallengeService;

  constructor(
    provider?: FaceMatchingProvider,
    storageProvider?: ReferencePhotoStorageProvider,
    livenessProvider?: FaceLivenessProvider,
    challengeService?: LivenessChallengeService,
  ) {
    if (provider) {
      this.provider = provider;
    } else {
      try {
        const config = getConfig();
        if (config.faceMatchingProvider === 'OPENCV_SFACE') {
          this.provider = new OpenCvSFaceFaceMatchingProvider({
            defaultThreshold: config.faceMatchThreshold,
            minConfidence: config.faceMinConfidence,
            pythonPath: config.pythonExecutable,
          });
        } else {
          this.provider = new NotConfiguredFaceMatchingProvider();
        }
      } catch {
        this.provider = new NotConfiguredFaceMatchingProvider();
      }
    }
    this.storageProvider = storageProvider || new LocalReferencePhotoStorage();

    if (livenessProvider) {
      this.livenessProvider = livenessProvider;
    } else {
      try {
        const config = getConfig();
        if (config.faceMatchingProvider === 'OPENCV_SFACE') {
          this.livenessProvider = new OpenCvChallengeLivenessProvider({
            defaultThreshold: config.faceMatchThreshold,
            minConfidence: config.faceMinConfidence,
            pythonPath: config.pythonExecutable,
          });
        } else {
          this.livenessProvider = new NotConfiguredLivenessProvider();
        }
      } catch {
        this.livenessProvider = new NotConfiguredLivenessProvider();
      }
    }
    this.challengeService = challengeService || new LivenessChallengeService();
  }

  getMatchingProvider(): FaceMatchingProvider {
    return this.provider;
  }

  getLivenessProvider(): FaceLivenessProvider {
    return this.livenessProvider;
  }

  getChallengeService(): LivenessChallengeService {
    return this.challengeService;
  }

  getStorageProvider(): ReferencePhotoStorageProvider {
    return this.storageProvider;
  }

  /**
   * Retrieves the current face profile for a student.
   * Defaults to NOT_ENROLLED if no record exists.
   */
  async getStudentFaceProfile(studentId: string): Promise<StudentFaceProfile> {
    const [profile] = await db
      .select()
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    if (!profile) {
      return {
        studentId,
        status: 'NOT_ENROLLED',
        enrolledAt: null,
        enrolledByStaffId: null,
        referencePhotoKey: null,
        referencePhotoSha256: null,
        imageVersion: 1,
        mimeType: null,
        fileSize: null,
        width: null,
        height: null,
        revokedAt: null,
        revokedByStaffId: null,
        revocationReason: null,
        modelVersion: 'arcface-r100-v1',
        updatedAt: new Date().toISOString(),
        faceDetectionAvailable: false,
      };
    }

    return {
      studentId: profile.studentId,
      status: profile.status as FaceProfileStatus,
      enrolledAt: profile.enrolledAt,
      enrolledByStaffId: profile.enrolledBy,
      referencePhotoKey: profile.referencePhotoKey,
      referencePhotoSha256: profile.referencePhotoSha256,
      imageVersion: profile.imageVersion,
      mimeType: profile.mimeType,
      fileSize: profile.fileSize,
      width: profile.width,
      height: profile.height,
      revokedAt: profile.revokedAt,
      revokedByStaffId: profile.revokedBy,
      revocationReason: profile.revocationReason,
      modelVersion: profile.modelVersion,
      updatedAt: profile.updatedAt,
      faceDetectionAvailable: false,
    };
  }

  /**
   * Enforces department scoping: HOD/Deputy HOD may only manage students
   * whose class belongs to their department. Admin has global scope.
   */
  async checkDepartmentScope(classId: string, actor?: AuditActor): Promise<void> {
    if (!actor || !actor.departmentId) return;
    if (actor.actorRole === 'ADMIN') return;

    const [cls] = await db
      .select({ departmentId: classes.departmentId })
      .from(classes)
      .where(eq(classes.id, classId))
      .limit(1);

    if (cls && cls.departmentId !== actor.departmentId) {
      throw new Error('DEPARTMENT_MISMATCH');
    }
  }

  /**
   * Enrolls or replaces an approved reference photo for a student.
   * Uploaded by HOD or Admin via Admin Web Portal.
   */
  async enrollReferencePhoto(params: {
    studentId: string;
    buffer: Buffer;
    originalFilename?: string;
    actor?: AuditActor;
    reason?: string;
  }): Promise<StudentFaceProfile> {
    const { studentId, buffer, actor, reason } = params;

    // 1. Validate student existence and status
    const [student] = await db
      .select({
        id: students.id,
        registerNumber: students.registerNumber,
        name: students.name,
        classId: students.classId,
        status: students.status,
      })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) {
      throw new Error('STUDENT_NOT_FOUND');
    }
    if (student.status !== 'ACTIVE') {
      throw new Error('STUDENT_INACTIVE');
    }

    // 2. Department scoping check
    await this.checkDepartmentScope(student.classId, actor);

    // 3. Validate image payload (magic bytes, size, dimensions, hash)
    const validation = ImageValidationService.validate(buffer);

    // 4. Determine version & old storage key
    // 4. Extract biometric reference embedding if configured matching engine is active
    let referenceEmbedding: number[] | null = null;
    let embeddingExtractedAt: string | null = null;
    let embeddingModel: string | null = null;

    if (this.provider.extractEmbedding && (await this.provider.isAvailable())) {
      const extractResult = await this.provider.extractEmbedding(buffer);
      if (!extractResult.success) {
        if (extractResult.failureReason === 'NO_FACE_DETECTED') {
          throw new Error('NO_FACE_DETECTED');
        }
        if (extractResult.failureReason === 'MULTIPLE_FACES_DETECTED') {
          throw new Error('MULTIPLE_FACES_DETECTED');
        }
        throw new Error(extractResult.failureReason || 'REFERENCE_IMAGE_UNUSABLE');
      }
      referenceEmbedding = extractResult.embedding || null;
      embeddingExtractedAt = new Date().toISOString();
      embeddingModel = 'sface-v1';
    }

    const [existingRow] = await db
      .select()
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    const oldKey = existingRow?.referencePhotoKey;
    const newVersion = (existingRow?.imageVersion || 0) + 1;

    // 5. Persist to storage provider
    const saved = await this.storageProvider.savePhoto({
      studentId,
      version: newVersion,
      buffer,
      mimeType: validation.mimeType,
    });

    // 6. Update database record with transactional cleanup on failure
    const now = new Date().toISOString();

    try {
      if (existingRow) {
        await db
          .update(studentFaceProfiles)
          .set({
            status: 'ACTIVE',
            referencePhotoKey: saved.key,
            referencePhotoSha256: saved.sha256,
            referenceEmbedding,
            embeddingExtractedAt,
            embeddingModel,
            imageVersion: newVersion,
            mimeType: validation.mimeType,
            fileSize: validation.fileSize,
            width: validation.width,
            height: validation.height,
            enrolledAt: now,
            enrolledBy: actor?.actorId || null,
            revokedAt: null,
            revokedBy: null,
            revocationReason: null,
            updatedAt: now,
          })
          .where(eq(studentFaceProfiles.studentId, studentId));
      } else {
        await db
          .insert(studentFaceProfiles)
          .values({
            studentId,
            status: 'ACTIVE',
            referencePhotoKey: saved.key,
            referencePhotoSha256: saved.sha256,
            referenceEmbedding,
            embeddingExtractedAt,
            embeddingModel,
            imageVersion: newVersion,
            mimeType: validation.mimeType,
            fileSize: validation.fileSize,
            width: validation.width,
            height: validation.height,
            enrolledAt: now,
            enrolledBy: actor?.actorId || null,
            updatedAt: now,
          });
      }

      // Cleanup old photo if existing
      if (oldKey && oldKey !== saved.key) {
        await this.storageProvider.deletePhoto(oldKey).catch(() => {});
      }
    } catch (dbErr) {
      // Rollback: delete the newly uploaded file to avoid orphaned storage files
      await this.storageProvider.deletePhoto(saved.key).catch(() => {});
      throw dbErr;
    }

    // 7. Audit log (strictly without image binary or base64)
    const isReplacement = Boolean(existingRow && existingRow.referencePhotoKey);
    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: isReplacement ? 'REFERENCE_PHOTO_REPLACED' : 'REFERENCE_PHOTO_ENROLLED',
      entityType: 'STUDENT_FACE_PROFILE',
      entityId: studentId,
      description: `${isReplacement ? 'Replaced' : 'Enrolled'} reference photo for student ${student.registerNumber} (v${newVersion}, ${validation.width}x${validation.height}, ${(validation.fileSize / 1024).toFixed(1)} KB, SHA-256: ${saved.sha256.substring(0, 16)}...).${reason ? ` Reason: ${reason}` : ''}`,
      oldValues: existingRow ? {
        version: existingRow.imageVersion,
        sha256: existingRow.referencePhotoSha256,
        status: existingRow.status,
      } : undefined,
      newValues: {
        version: newVersion,
        sha256: saved.sha256,
        mimeType: validation.mimeType,
        width: validation.width,
        height: validation.height,
        fileSize: validation.fileSize,
        status: 'ACTIVE',
      },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return this.getStudentFaceProfile(studentId);
  }

  /**
   * Retrieves an enrolled reference photo stream/buffer.
   */
  async getReferencePhoto(studentId: string, actor?: { id: string; roles: string[]; userType: string; departmentId?: string }): Promise<{
    buffer: Buffer;
    mimeType: string;
    profile: StudentFaceProfile;
  }> {
    const [student] = await db
      .select({
        id: students.id,
        classId: students.classId,
      })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) {
      throw new Error('STUDENT_NOT_FOUND');
    }

    // Role check
    if (actor) {
      const isSelf = actor.userType === 'STUDENT' && actor.id === studentId;
      const isLeadership = actor.roles.some((r) => ['ADMIN', 'HOD', 'DEPUTY_HOD'].includes(r));
      if (!isSelf && !isLeadership) {
        throw new Error('FORBIDDEN');
      }
      if (isLeadership && actor.departmentId && !actor.roles.includes('ADMIN')) {
        await this.checkDepartmentScope(student.classId, { actorRole: actor.roles[0], departmentId: actor.departmentId });
      }
    }

    const [profile] = await db
      .select()
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    if (!profile || !profile.referencePhotoKey) {
      throw new Error('REFERENCE_PHOTO_NOT_FOUND');
    }

    const file = await this.storageProvider.getPhoto(profile.referencePhotoKey, profile.mimeType || undefined);
    if (!file) {
      throw new Error('REFERENCE_PHOTO_FILE_MISSING');
    }

    const fullProfile = await this.getStudentFaceProfile(studentId);

    return {
      buffer: file.buffer,
      mimeType: file.mimeType,
      profile: fullProfile,
    };
  }

  /**
   * Revokes an existing reference photo.
   */
  async revokeReferencePhoto(params: {
    studentId: string;
    actor?: AuditActor;
    reason?: string;
  }): Promise<StudentFaceProfile> {
    const { studentId, actor, reason } = params;

    const [student] = await db
      .select({
        id: students.id,
        registerNumber: students.registerNumber,
        classId: students.classId,
      })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) {
      throw new Error('STUDENT_NOT_FOUND');
    }

    await this.checkDepartmentScope(student.classId, actor);

    const [existingRow] = await db
      .select()
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    if (!existingRow || existingRow.status === 'NOT_ENROLLED') {
      throw new Error('REFERENCE_PHOTO_NOT_FOUND');
    }

    const now = new Date().toISOString();
    await db
      .update(studentFaceProfiles)
      .set({
        status: 'REVOKED',
        referenceEmbedding: null,
        embeddingExtractedAt: null,
        revokedAt: now,
        revokedBy: actor?.actorId || null,
        revocationReason: reason || 'Revoked by authorized staff',
        updatedAt: now,
      })
      .where(eq(studentFaceProfiles.studentId, studentId));

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'REFERENCE_PHOTO_REVOKED',
      entityType: 'STUDENT_FACE_PROFILE',
      entityId: studentId,
      description: `Revoked reference photo for student ${student.registerNumber}.${reason ? ` Reason: ${reason}` : ''}`,
      oldValues: { status: existingRow.status },
      newValues: { status: 'REVOKED', reason: reason || 'Revoked by authorized staff' },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return this.getStudentFaceProfile(studentId);
  }

  /**
   * Updates or initializes a student's face profile status (Admin/HOD operation).
   */
  async updateFaceProfileStatus(
    studentId: string,
    status: FaceProfileStatus,
    actor?: AuditActor,
    reason?: string
  ): Promise<StudentFaceProfile> {
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) {
      throw new Error('STUDENT_NOT_FOUND');
    }

    const existing = await this.getStudentFaceProfile(studentId);

    const now = new Date().toISOString();
    let updated;

    const [existingRow] = await db
      .select()
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    if (existingRow) {
      [updated] = await db
        .update(studentFaceProfiles)
        .set({
          status,
          enrolledBy: actor?.actorId || null,
          updatedAt: now,
        })
        .where(eq(studentFaceProfiles.studentId, studentId))
        .returning();
    } else {
      [updated] = await db
        .insert(studentFaceProfiles)
        .values({
          studentId,
          status,
          enrolledBy: actor?.actorId || null,
          enrolledAt: status === 'ACTIVE' ? now : null,
          updatedAt: now,
        })
        .returning();
    }

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'FACE_PROFILE_STATUS_UPDATE',
      entityType: 'STUDENT_FACE_PROFILE',
      entityId: studentId,
      description: `Updated face profile status for student ${student.registerNumber} from ${existing.status} to ${status}.${reason ? ` Reason: ${reason}` : ''}`,
      oldValues: { status: existing.status },
      newValues: { status },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return {
      studentId: updated.studentId,
      status: updated.status as FaceProfileStatus,
      enrolledAt: updated.enrolledAt,
      enrolledByStaffId: updated.enrolledBy,
      referencePhotoKey: updated.referencePhotoKey,
      modelVersion: updated.modelVersion,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Checks the multi-factor face verification eligibility and status for a student in a session.
   */
  async getVerificationStatus(sessionId: string, studentId: string): Promise<StudentFaceVerificationStatus> {
    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);

    const [tokenRecord] = await db
      .select()
      .from(attendanceBleTokens)
      .where(and(
        eq(attendanceBleTokens.attendanceSessionId, sessionId),
        eq(attendanceBleTokens.studentId, studentId)
      ))
      .limit(1);

    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, sessionId),
        eq(attendanceRecords.studentId, studentId)
      ))
      .limit(1);

    const bleDetected = !!tokenRecord || !!record;

    const profile = await this.getStudentFaceProfile(studentId);

    const attempts = await db
      .select()
      .from(attendanceFaceVerifications)
      .where(and(
        eq(attendanceFaceVerifications.attendanceSessionId, sessionId),
        eq(attendanceFaceVerifications.studentId, studentId)
      ))
      .orderBy(desc(attendanceFaceVerifications.createdAt));

    const attemptCount = attempts.length;
    const remainingAttempts = Math.max(0, 3 - attemptCount);

    const latestAttempt = attempts[0];
    let verificationStatus: FaceVerificationStatus = 'PENDING';

    if (latestAttempt) {
      if (latestAttempt.status === 'VERIFIED') verificationStatus = 'VERIFIED';
      else if (latestAttempt.status === 'NOT_CONFIGURED') verificationStatus = 'NOT_CONFIGURED';
      else if (remainingAttempts === 0) verificationStatus = 'BLOCKED';
      else verificationStatus = 'FAILED';
    }

    const isEligibleForVerification = 
      bleDetected &&
      profile.status === 'ACTIVE' &&
      remainingAttempts > 0 &&
      session?.status === 'ACTIVE';

    return {
      sessionId,
      bleDetected,
      profileStatus: profile.status,
      verificationStatus,
      attemptCount,
      remainingAttempts,
      isEligibleForVerification,
      verifiedAt: latestAttempt?.verifiedAt || null,
    };
  }

  /**
   * Handles a student's selfie verification submission.
   * Enforces all 5 business rules:
   * 1. Valid student identity
   * 2. Active attendance session
   * 3. Valid BLE attendance eligibility
   * 4. Successful face verification
   * 5. No duplicate or closed-session attendance mutation
   */
  async verifyStudentFace(params: {
    sessionId: string;
    studentId: string;
    selfieBase64?: string;
    selfieBuffer?: Buffer;
    clientMetadata?: any;
    actor?: AuditActor;
  }): Promise<FaceVerificationResponse> {
    const { sessionId, studentId, selfieBase64, selfieBuffer, clientMetadata, actor } = params;

    // 1. Validate session exists and is ACTIVE
    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    if (session.status !== 'ACTIVE') {
      throw new Error('SESSION_NOT_ACTIVE');
    }

    // 2. Validate student identity and class membership
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student || student.status !== 'ACTIVE') {
      throw new Error('STUDENT_INACTIVE');
    }

    const [timetable] = await db
      .select()
      .from(timetables)
      .where(eq(timetables.id, session.timetableId))
      .limit(1);

    if (!timetable || student.classId !== timetable.classId) {
      throw new Error('STUDENT_WRONG_CLASS');
    }

    // 3. Validate BLE attendance eligibility (must have token or detection)
    const [tokenRecord] = await db
      .select()
      .from(attendanceBleTokens)
      .where(and(
        eq(attendanceBleTokens.attendanceSessionId, sessionId),
        eq(attendanceBleTokens.studentId, studentId)
      ))
      .limit(1);

    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, sessionId),
        eq(attendanceRecords.studentId, studentId)
      ))
      .limit(1);

    if (!tokenRecord && !record) {
      throw new Error('BLE_ELIGIBILITY_REQUIRED');
    }

    // 4. Validate HOD-managed reference photo profile
    const profile = await this.getStudentFaceProfile(studentId);
    if (profile.status !== 'ACTIVE' || !profile.referencePhotoKey) {
      throw new Error('STUDENT_NOT_ENROLLED');
    }

    // 5. Technical image quality checks on uploaded selfie (F4)
    let verifiedBuffer: Buffer | undefined = selfieBuffer;
    if (!verifiedBuffer && selfieBase64) {
      try {
        const cleanBase64 = selfieBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        verifiedBuffer = Buffer.from(cleanBase64, 'base64');
      } catch {
        throw new Error('INVALID_IMAGE_PAYLOAD');
      }
    }

    if (verifiedBuffer && verifiedBuffer.length > 0) {
      // Validates magic bytes (JPEG/PNG/WebP), size (5KB - 5MB), dimensions (200x200 - 4096x4096px)
      ImageValidationService.validate(verifiedBuffer);
    }

    // 6. Enforce attempt limit (max 3 per session)
    const existingAttempts = await db
      .select({ count: count() })
      .from(attendanceFaceVerifications)
      .where(and(
        eq(attendanceFaceVerifications.attendanceSessionId, sessionId),
        eq(attendanceFaceVerifications.studentId, studentId)
      ));

    const priorAttemptCount = Number(existingAttempts[0]?.count || 0);
    if (priorAttemptCount >= 3) {
      throw new Error('MAX_ATTEMPTS_EXCEEDED');
    }

    const attemptNumber = priorAttemptCount + 1;
    const remainingAttempts = Math.max(0, 3 - attemptNumber);

    // 7. Resolve reference photo buffer or cached 128-d embedding
    const [profileRow] = await db
      .select({
        referenceEmbedding: studentFaceProfiles.referenceEmbedding,
      })
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    let refBuffer: Buffer | undefined;
    let refEmbedding: number[] | undefined;

    if (profileRow?.referenceEmbedding && Array.isArray(profileRow.referenceEmbedding) && (profileRow.referenceEmbedding as any[]).length === 128) {
      refEmbedding = profileRow.referenceEmbedding as number[];
    } else if (profile.referencePhotoKey && this.provider.name !== 'NOT_CONFIGURED') {
      try {
        const photoResult = await this.storageProvider.getPhoto(profile.referencePhotoKey);
        if (!photoResult || !photoResult.buffer) {
          throw new Error('REFERENCE_IMAGE_UNUSABLE');
        }
        refBuffer = photoResult.buffer;
      } catch (streamErr: any) {
        if (streamErr?.message === 'REFERENCE_IMAGE_UNUSABLE') throw streamErr;
        throw new Error('REFERENCE_IMAGE_UNUSABLE');
      }
    }

    // 8. Invoke the matching provider abstraction with genuine biometric inputs
    const matchResult = await this.provider.verifyFace({
      studentId,
      referencePhotoKey: profile.referencePhotoKey,
      referencePhotoBuffer: refBuffer,
      referenceEmbedding: refEmbedding,
      selfieBase64: selfieBase64 || verifiedBuffer?.toString('base64'),
      selfieBuffer: verifiedBuffer,
      clientMetadata,
    });

    // Populate embedding cache if previously uncached and extraction succeeds
    if (!refEmbedding && refBuffer && this.provider.extractEmbedding) {
      this.provider.extractEmbedding(refBuffer).then(async (ext) => {
        if (ext.success && ext.embedding) {
          await db
            .update(studentFaceProfiles)
            .set({
              referenceEmbedding: ext.embedding,
              embeddingExtractedAt: new Date().toISOString(),
              embeddingModel: 'sface-v1',
            })
            .where(eq(studentFaceProfiles.studentId, studentId))
            .catch(() => {});
        }
      }).catch(() => {});
    }

    let outcome: 'VERIFIED' | 'FAILED_NO_MATCH' | 'NOT_CONFIGURED' | 'FAILED_LIVENESS' = 'FAILED_NO_MATCH';
    if (matchResult.failureReason === 'PROVIDER_NOT_CONFIGURED') {
      outcome = 'NOT_CONFIGURED';
    } else if (matchResult.success) {
      outcome = 'VERIFIED';
    } else if (matchResult.failureReason === 'LIVENESS_FAILED') {
      outcome = 'FAILED_LIVENESS';
    }

    const now = new Date().toISOString();

    // 9. Record verification attempt in database (biometrics/selfies never logged or exposed)
    await db.insert(attendanceFaceVerifications).values({
      attendanceSessionId: sessionId,
      studentId,
      status: outcome,
      attemptNumber,
      confidenceScore: matchResult.confidenceScore ? String(matchResult.confidenceScore) : null,
      livenessScore: matchResult.livenessScore ? String(matchResult.livenessScore) : null,
      failureReason: matchResult.failureReason || null,
      clientMetadata: clientMetadata || null,
      verifiedAt: matchResult.success ? now : null,
    });

    // 10. Attendance marking strictly requires matchResult.success === true
    if (matchResult.success) {
      if (record) {
        await db
          .update(attendanceRecords)
          .set({
            status: 'PRESENT',
            markedAt: now,
          })
          .where(eq(attendanceRecords.id, record.id));
      } else {
        await db.insert(attendanceRecords).values({
          attendanceSessionId: sessionId,
          studentId,
          status: 'PRESENT',
          source: 'BLE',
          firstDetectedAt: now,
          lastDetectedAt: now,
          detectionCount: 1,
          markedAt: now,
        });
      }

      await this.audit.log({
        actorId: actor?.actorRole === 'STAFF' || actor?.actorRole === 'ADMIN' || actor?.actorRole === 'HOD' ? actor?.actorId : undefined,
        actorName: student.name,
        actorRole: 'STUDENT',
        action: 'ATTENDANCE_MARKED_FACE_BLE',
        entityType: 'ATTENDANCE_RECORD',
        entityId: record?.id || sessionId,
        description: `Student ${student.registerNumber} verified face successfully (confidence: ${matchResult.confidenceScore || 'match'}). Attendance marked PRESENT.`,
        oldValues: record ? { status: record.status } : undefined,
        newValues: { status: 'PRESENT', source: 'BLE', confidence: matchResult.confidenceScore },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });

      return {
        success: true,
        status: 'VERIFIED',
        message: 'Face verification successful. Attendance marked PRESENT.',
        attemptNumber,
        remainingAttempts,
        verifiedAt: now,
      };
    }

    // 11. When verification fails or is not configured: NEVER mark attendance
    await this.audit.log({
      actorId: actor?.actorRole === 'STAFF' || actor?.actorRole === 'ADMIN' || actor?.actorRole === 'HOD' ? actor?.actorId : undefined,
      actorName: student.name,
      actorRole: 'STUDENT',
      action: 'FACE_VERIFICATION_ATTEMPT_FAILED',
      entityType: 'ATTENDANCE_SESSION',
      entityId: sessionId,
      description: `Student ${student.registerNumber} face verification attempt #${attemptNumber} failed: ${matchResult.failureReason || 'MISMATCH'}.`,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return {
      success: false,
      status: outcome === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED',
      failureReason: (matchResult.failureReason as any) || 'FACE_MISMATCH',
      message: matchResult.message,
      attemptNumber,
      remainingAttempts,
      verifiedAt: null,
    };
  }

  /**
   * Milestone F6: Multi-factor anti-spoofing, active challenge-response, and biometric verification.
   * Strictly enforces all 7 preconditions before marking attendance:
   * 1. Authenticated active student
   * 2. Active attendance session
   * 3. Valid BLE attendance eligibility
   * 4. Enrolled active reference photo profile
   * 5. Valid single-use server-issued challenge (unexpired, matching student & session)
   * 6. Genuine biometric liveness (LIVE, no static photo, correct action, continuity >= 0.70)
   * 7. Successful biometric identity match against college reference photo (>= 0.40)
   */
  async verifyStudentLivenessAndIdentity(params: {
    sessionId: string;
    studentId: string;
    challengeId: string;
    baseBuffer?: Buffer;
    baseBase64?: string;
    actionBuffer?: Buffer;
    actionBase64?: string;
    clientMetadata?: any;
    actor?: AuditActor;
  }): Promise<LivenessVerificationResponse> {
    const {
      sessionId,
      studentId,
      challengeId,
      baseBuffer,
      baseBase64,
      actionBuffer,
      actionBase64,
      clientMetadata,
      actor,
    } = params;

    // Precondition 1: Validate active session
    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    if (session.status !== 'ACTIVE') {
      throw new Error('SESSION_NOT_ACTIVE');
    }

    // Precondition 2: Validate student identity and class membership
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student || student.status !== 'ACTIVE') {
      throw new Error('STUDENT_INACTIVE');
    }

    const [timetable] = await db
      .select()
      .from(timetables)
      .where(eq(timetables.id, session.timetableId))
      .limit(1);

    if (!timetable || student.classId !== timetable.classId) {
      throw new Error('STUDENT_WRONG_CLASS');
    }

    // Precondition 3: Validate BLE attendance eligibility
    const [tokenRecord] = await db
      .select()
      .from(attendanceBleTokens)
      .where(and(
        eq(attendanceBleTokens.attendanceSessionId, sessionId),
        eq(attendanceBleTokens.studentId, studentId)
      ))
      .limit(1);

    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, sessionId),
        eq(attendanceRecords.studentId, studentId)
      ))
      .limit(1);

    if (!tokenRecord && !record) {
      throw new Error('BLE_ELIGIBILITY_REQUIRED');
    }

    // Precondition 4: Validate HOD-managed reference photo profile
    const profile = await this.getStudentFaceProfile(studentId);
    if (profile.status !== 'ACTIVE' || !profile.referencePhotoKey) {
      throw new Error('STUDENT_NOT_ENROLLED');
    }

    // Precondition 5: Enforce attempt limits (max 3 per session)
    const existingAttempts = await db
      .select({ count: count() })
      .from(attendanceFaceVerifications)
      .where(and(
        eq(attendanceFaceVerifications.attendanceSessionId, sessionId),
        eq(attendanceFaceVerifications.studentId, studentId)
      ));

    const priorAttemptCount = Number(existingAttempts[0]?.count || 0);
    if (priorAttemptCount >= 3) {
      throw new Error('MAX_ATTEMPTS_EXCEEDED');
    }

    const attemptNumber = priorAttemptCount + 1;
    const remainingAttempts = Math.max(0, 3 - attemptNumber);

    // Precondition 6: Validate and consume single-use challenge
    const consumedChallenge = await this.challengeService.validateAndConsumeChallenge({
      challengeId,
      studentId,
      sessionId,
    });

    // Technical image validation on both frames
    let verifiedBaseBuffer: Buffer | undefined = baseBuffer;
    if (!verifiedBaseBuffer && baseBase64) {
      try {
        const cleanBase64 = baseBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        verifiedBaseBuffer = Buffer.from(cleanBase64, 'base64');
      } catch {
        throw new Error('INVALID_IMAGE_PAYLOAD');
      }
    }

    let verifiedActionBuffer: Buffer | undefined = actionBuffer;
    if (!verifiedActionBuffer && actionBase64) {
      try {
        const cleanBase64 = actionBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        verifiedActionBuffer = Buffer.from(cleanBase64, 'base64');
      } catch {
        throw new Error('INVALID_IMAGE_PAYLOAD');
      }
    }

    if (!verifiedBaseBuffer || verifiedBaseBuffer.length === 0) {
      throw new Error('BASE_SELFIE_REQUIRED');
    }
    if (!verifiedActionBuffer || verifiedActionBuffer.length === 0) {
      throw new Error('ACTION_SELFIE_REQUIRED');
    }

    ImageValidationService.validate(verifiedBaseBuffer);
    ImageValidationService.validate(verifiedActionBuffer);

    // Resolve reference embedding or photo buffer
    const [profileRow] = await db
      .select({
        referenceEmbedding: studentFaceProfiles.referenceEmbedding,
      })
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    let refBuffer: Buffer | undefined;
    let refEmbedding: number[] | undefined;

    if (
      profileRow?.referenceEmbedding &&
      Array.isArray(profileRow.referenceEmbedding) &&
      (profileRow.referenceEmbedding as any[]).length === 128
    ) {
      refEmbedding = profileRow.referenceEmbedding as number[];
    } else if (profile.referencePhotoKey && this.livenessProvider.name !== 'NOT_CONFIGURED') {
      try {
        const photoResult = await this.storageProvider.getPhoto(profile.referencePhotoKey);
        if (photoResult && photoResult.buffer) {
          refBuffer = photoResult.buffer;
        }
      } catch {
        // Continue, provider will handle missing reference gracefully
      }
    }

    // Precondition 7: Biometric liveness and anti-spoofing verification
    const livenessResult = await this.livenessProvider.verifyLiveness({
      studentId,
      challengeType: consumedChallenge.challengeType,
      baseBuffer: verifiedBaseBuffer,
      baseBase64: baseBase64 || verifiedBaseBuffer.toString('base64'),
      actionBuffer: verifiedActionBuffer,
      actionBase64: actionBase64 || verifiedActionBuffer.toString('base64'),
      referencePhotoBuffer: refBuffer,
      referenceEmbedding: refEmbedding,
    });

    let outcome: 'VERIFIED' | 'FAILED_NO_MATCH' | 'FAILED_LIVENESS' | 'FAILED_POOR_QUALITY' | 'NOT_CONFIGURED' =
      'FAILED_LIVENESS';

    if (livenessResult.failureReason === 'PROVIDER_NOT_CONFIGURED') {
      outcome = 'NOT_CONFIGURED';
    } else if (livenessResult.success) {
      outcome = 'VERIFIED';
    } else if (livenessResult.failureReason === 'FACE_MISMATCH') {
      outcome = 'FAILED_NO_MATCH';
    } else if (livenessResult.failureReason === 'POOR_QUALITY') {
      outcome = 'FAILED_POOR_QUALITY';
    } else {
      outcome = 'FAILED_LIVENESS';
    }

    const now = new Date().toISOString();

    // Record verification attempt in database (biometrics/selfies never logged or exposed)
    await db.insert(attendanceFaceVerifications).values({
      attendanceSessionId: sessionId,
      studentId,
      status: outcome,
      attemptNumber,
      confidenceScore: livenessResult.similarity ? String(livenessResult.similarity) : null,
      livenessScore: livenessResult.livenessScore ? String(livenessResult.livenessScore) : null,
      failureReason: livenessResult.failureReason || null,
      clientMetadata: {
        ...(clientMetadata || {}),
        challengeType: consumedChallenge.challengeType,
        challengeId: consumedChallenge.id,
      },
      verifiedAt: livenessResult.success ? now : null,
    });

    // Attendance marking strictly requires livenessResult.success === true
    if (livenessResult.success) {
      if (record) {
        await db
          .update(attendanceRecords)
          .set({
            status: 'PRESENT',
            markedAt: now,
          })
          .where(eq(attendanceRecords.id, record.id));
      } else {
        await db.insert(attendanceRecords).values({
          attendanceSessionId: sessionId,
          studentId,
          status: 'PRESENT',
          source: 'BLE',
          firstDetectedAt: now,
          lastDetectedAt: now,
          detectionCount: 1,
          markedAt: now,
        });
      }

      await this.audit.log({
        actorId: actor?.actorRole === 'STAFF' || actor?.actorRole === 'ADMIN' || actor?.actorRole === 'HOD' ? actor?.actorId : undefined,
        actorName: student.name,
        actorRole: 'STUDENT',
        action: 'ATTENDANCE_MARKED_FACE_BLE',
        entityType: 'ATTENDANCE_RECORD',
        entityId: record?.id || sessionId,
        description: `Student ${student.registerNumber} passed liveness and face verification (score: ${livenessResult.livenessScore}, similarity: ${livenessResult.similarity}). Attendance marked PRESENT.`,
        oldValues: record ? { status: record.status } : undefined,
        newValues: { status: 'PRESENT', source: 'BLE', livenessScore: livenessResult.livenessScore, similarity: livenessResult.similarity },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });

      return {
        success: true,
        status: 'VERIFIED',
        livenessResult: 'LIVE',
        livenessScore: livenessResult.livenessScore,
        similarity: livenessResult.similarity,
        message: 'Liveness and biometric identity verified successfully. Attendance marked PRESENT.',
        attemptNumber,
        remainingAttempts,
        verifiedAt: now,
      };
    }

    // When verification fails or is not configured: NEVER mark attendance
    await this.audit.log({
      actorId: actor?.actorRole === 'STAFF' || actor?.actorRole === 'ADMIN' || actor?.actorRole === 'HOD' ? actor?.actorId : undefined,
      actorName: student.name,
      actorRole: 'STUDENT',
      action: 'FACE_VERIFICATION_ATTEMPT_FAILED',
      entityType: 'ATTENDANCE_SESSION',
      entityId: sessionId,
      description: `Student ${student.registerNumber} liveness attempt #${attemptNumber} failed: ${livenessResult.failureReason || 'LIVENESS_FAILED'}.`,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return {
      success: false,
      status: outcome === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED',
      livenessResult: livenessResult.livenessResult,
      livenessScore: livenessResult.livenessScore,
      similarity: livenessResult.similarity,
      failureReason: livenessResult.failureReason === 'FACE_MISMATCH' ? 'FACE_MISMATCH' : 'LIVENESS_FAILED',
      livenessFailureReason: livenessResult.failureReason,
      message: livenessResult.message,
      attemptNumber,
      remainingAttempts,
      verifiedAt: null,
    };
  }
}


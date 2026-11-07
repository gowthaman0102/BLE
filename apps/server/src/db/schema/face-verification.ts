import { pgTable, uuid, varchar, timestamp, pgEnum, integer, text, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { students } from './students';
import { staff } from './staff';
import { attendanceSessions } from './attendance';

export const faceProfileStatusEnum = pgEnum('face_profile_status', [
  'NOT_ENROLLED',
  'PENDING',
  'ACTIVE',
  'REVOKED',
]);

export const faceVerificationOutcomeEnum = pgEnum('face_verification_outcome', [
  'PENDING',
  'VERIFIED',
  'FAILED_NO_MATCH',
  'FAILED_LIVENESS',
  'FAILED_POOR_QUALITY',
  'FAILED_ATTEMPT_LIMIT',
  'FAILED_EXPIRED',
  'NOT_CONFIGURED',
]);

export const studentFaceProfiles = pgTable('student_face_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull().unique(),
  status: faceProfileStatusEnum('status').default('NOT_ENROLLED').notNull(),
  referencePhotoKey: varchar('reference_photo_key', { length: 512 }),
  referencePhotoSha256: varchar('reference_photo_sha256', { length: 64 }),
  imageVersion: integer('image_version').default(1).notNull(),
  mimeType: varchar('mime_type', { length: 50 }),
  fileSize: integer('file_size'),
  width: integer('width'),
  height: integer('height'),
  referenceEmbedding: jsonb('reference_embedding'),
  embeddingExtractedAt: timestamp('embedding_extracted_at', { mode: 'string' }),
  embeddingModel: varchar('embedding_model', { length: 50 }),
  modelVersion: varchar('model_version', { length: 50 }).default('arcface-r100-v1').notNull(),
  enrolledBy: uuid('enrolled_by').references(() => staff.id),
  enrolledAt: timestamp('enrolled_at', { mode: 'string' }),
  revokedAt: timestamp('revoked_at', { mode: 'string' }),
  revokedBy: uuid('revoked_by').references(() => staff.id),
  revocationReason: text('revocation_reason'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  studentIdx: uniqueIndex('student_face_profiles_student_id_unique_idx').on(table.studentId),
  statusIdx: index('student_face_profiles_status_idx').on(table.status),
}));

export const attendanceFaceVerifications = pgTable('attendance_face_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  attendanceSessionId: uuid('attendance_session_id').references(() => attendanceSessions.id, { onDelete: 'cascade' }).notNull(),
  studentId: uuid('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  status: faceVerificationOutcomeEnum('status').default('PENDING').notNull(),
  attemptNumber: integer('attempt_number').default(1).notNull(),
  confidenceScore: varchar('confidence_score', { length: 20 }),
  livenessScore: varchar('liveness_score', { length: 20 }),
  failureReason: text('failure_reason'),
  clientMetadata: jsonb('client_metadata'),
  verifiedAt: timestamp('verified_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  sessionStudentIdx: index('face_verifications_session_student_idx').on(table.attendanceSessionId, table.studentId),
  studentIdx: index('face_verifications_student_idx').on(table.studentId),
  sessionStatusIdx: index('face_verifications_session_status_idx').on(table.attendanceSessionId, table.status),
}));

export const livenessChallengeStatusEnum = pgEnum('liveness_challenge_status', [
  'PENDING',
  'CONSUMED',
  'EXPIRED',
]);

export const livenessChallenges = pgTable('liveness_challenges', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  attendanceSessionId: uuid('attendance_session_id').references(() => attendanceSessions.id, { onDelete: 'cascade' }).notNull(),
  challengeType: varchar('challenge_type', { length: 50 }).notNull(),
  nonce: varchar('nonce', { length: 64 }).notNull(),
  status: livenessChallengeStatusEnum('status').default('PENDING').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  consumedAt: timestamp('consumed_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  studentSessionIdx: index('liveness_challenges_student_session_idx').on(table.studentId, table.attendanceSessionId),
  statusIdx: index('liveness_challenges_status_idx').on(table.status),
  expiresAtIdx: index('liveness_challenges_expires_at_idx').on(table.expiresAt),
}));


import { pgTable, uuid, timestamp, varchar, pgEnum, integer, uniqueIndex, text, boolean, index } from 'drizzle-orm/pg-core';
import { attendanceSessions } from './attendance';
import { students } from './students';
import { staff } from './staff';

export const attendanceRecordStatusEnum = pgEnum('attendance_record_status', ['PRESENT', 'ABSENT', 'LATE', 'MANUAL']);
export const attendanceRecordSourceEnum = pgEnum('attendance_record_source', ['BLE', 'MANUAL']);
export const attendanceFallbackStatusEnum = pgEnum('attendance_fallback_status', ['PENDING', 'APPROVED', 'REJECTED']);

export const attendanceRecords = pgTable('attendance_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  attendanceSessionId: uuid('attendance_session_id').notNull().references(() => attendanceSessions.id),
  studentId: uuid('student_id').notNull().references(() => students.id),
  status: attendanceRecordStatusEnum('status').notNull(),
  source: attendanceRecordSourceEnum('source').notNull(),
  firstDetectedAt: timestamp('first_detected_at', { mode: 'string' }),
  lastDetectedAt: timestamp('last_detected_at', { mode: 'string' }),
  detectionCount: integer('detection_count').default(0).notNull(),
  markedAt: timestamp('marked_at', { mode: 'string' }).notNull(),
  markedBy: uuid('marked_by').references(() => staff.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    recordUniqueIdx: uniqueIndex('record_session_student_idx').on(table.attendanceSessionId, table.studentId),
  };
});

export const attendanceFallbackRequests = pgTable('attendance_fallback_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  attendanceSessionId: uuid('attendance_session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  reasonCategory: varchar('reason_category', { length: 50 }).notNull(),
  explanation: varchar('explanation', { length: 500 }),
  status: attendanceFallbackStatusEnum('status').default('PENDING').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => staff.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    fallbackSessionStudentIdx: index('attendance_fallback_session_student_idx').on(table.attendanceSessionId, table.studentId),
    fallbackStatusIdx: index('attendance_fallback_status_idx').on(table.status),
  };
});

export const attendanceCorrections = pgTable('attendance_corrections', {
  id: uuid('id').defaultRandom().primaryKey(),
  attendanceRecordId: uuid('attendance_record_id').notNull().references(() => attendanceRecords.id, { onDelete: 'cascade' }),
  previousStatus: varchar('previous_status', { length: 50 }).notNull(),
  newStatus: varchar('new_status', { length: 50 }).notNull(),
  reason: text('reason').notNull(),
  correctedBy: uuid('corrected_by').references(() => staff.id).notNull(),
  isPostClosure: boolean('is_post_closure').default(false).notNull(),
  fallbackRequestId: uuid('fallback_request_id').references(() => attendanceFallbackRequests.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


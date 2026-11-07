import { db } from "../db";
import { attendanceRecords, attendanceCorrections } from "../db/schema/attendance-records";
import { attendanceSessions } from "../db/schema/attendance";
import { students } from "../db/schema/students";
import { classes } from "../db/schema/academic";
import { staff } from "../db/schema/staff";
import { eq, and, desc, sql } from "drizzle-orm";

export interface AttendanceRecordFilter {
  sessionId?: string;
  studentId?: string;
  classId?: string;
  date?: string;
  status?: string;
}

export interface AttendanceCorrectionFilter {
  recordId?: string;
  sessionId?: string;
  classId?: string;
  limit?: number;
  offset?: number;
}

export class AttendanceRecordRepository {
  async getRecords(filter: AttendanceRecordFilter = {}) {
    const conditions = [];

    if (filter.sessionId) {
      conditions.push(eq(attendanceRecords.attendanceSessionId, filter.sessionId));
    }
    if (filter.studentId) {
      conditions.push(eq(attendanceRecords.studentId, filter.studentId));
    }
    if (filter.classId) {
      conditions.push(eq(students.classId, filter.classId));
    }
    if (filter.date) {
      conditions.push(eq(attendanceSessions.sessionDate, filter.date));
    }
    if (filter.status) {
      conditions.push(eq(attendanceRecords.status, filter.status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await db
      .select({
        id: attendanceRecords.id,
        sessionId: attendanceRecords.attendanceSessionId,
        studentId: attendanceRecords.studentId,
        registerNumber: students.registerNumber,
        studentName: students.name,
        collegeEmail: students.collegeEmail,
        classId: students.classId,
        className: classes.name,
        status: attendanceRecords.status,
        source: attendanceRecords.source,
        firstDetectedAt: attendanceRecords.firstDetectedAt,
        lastDetectedAt: attendanceRecords.lastDetectedAt,
        detectionCount: attendanceRecords.detectionCount,
        markedAt: attendanceRecords.markedAt,
        markedByStaffId: attendanceRecords.markedBy,
        markedByName: staff.name,
        sessionDate: attendanceSessions.sessionDate,
      })
      .from(attendanceRecords)
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .innerJoin(attendanceSessions, eq(attendanceRecords.attendanceSessionId, attendanceSessions.id))
      .leftJoin(classes, eq(students.classId, classes.id))
      .leftJoin(staff, eq(attendanceRecords.markedBy, staff.id))
      .where(whereClause)
      .orderBy(students.registerNumber);
  }

  async getRecordById(id: string) {
    const rows = await db
      .select({
        id: attendanceRecords.id,
        sessionId: attendanceRecords.attendanceSessionId,
        studentId: attendanceRecords.studentId,
        registerNumber: students.registerNumber,
        studentName: students.name,
        collegeEmail: students.collegeEmail,
        classId: students.classId,
        className: classes.name,
        status: attendanceRecords.status,
        source: attendanceRecords.source,
        firstDetectedAt: attendanceRecords.firstDetectedAt,
        lastDetectedAt: attendanceRecords.lastDetectedAt,
        detectionCount: attendanceRecords.detectionCount,
        markedAt: attendanceRecords.markedAt,
        markedByStaffId: attendanceRecords.markedBy,
        markedByName: staff.name,
        sessionDate: attendanceSessions.sessionDate,
      })
      .from(attendanceRecords)
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .innerJoin(attendanceSessions, eq(attendanceRecords.attendanceSessionId, attendanceSessions.id))
      .leftJoin(classes, eq(students.classId, classes.id))
      .leftJoin(staff, eq(attendanceRecords.markedBy, staff.id))
      .where(eq(attendanceRecords.id, id));

    return rows[0] || null;
  }

  async getRecordBySessionAndStudent(sessionId: string, studentId: string) {
    const rows = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.attendanceSessionId, sessionId),
          eq(attendanceRecords.studentId, studentId)
        )
      );
    return rows[0] || null;
  }

  async findBySessionAndStudent(sessionId: string, studentId: string) {
    return await this.getRecordBySessionAndStudent(sessionId, studentId);
  }

  async update(id: string, data: any) {
    return await db
      .update(attendanceRecords)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, id))
      .returning()
      .then((r) => r[0]);
  }

  async create(data: any) {
    return await db
      .insert(attendanceRecords)
      .values({
        ...data,
        markedAt: data.markedAt || new Date().toISOString(),
      })
      .returning()
      .then((r) => r[0]);
  }

  async findAllBySession(sessionId: string) {
    return await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.attendanceSessionId, sessionId));
  }

  async upsertRecord(data: {
    attendanceSessionId: string;
    studentId: string;
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL';
    source: 'BLE' | 'MANUAL';
    markedBy?: string;
  }, tx?: any) {
    const client = tx || db;
    const nowStr = new Date().toISOString();
    return await client
      .insert(attendanceRecords)
      .values({
        attendanceSessionId: data.attendanceSessionId,
        studentId: data.studentId,
        status: data.status,
        source: data.source,
        markedAt: nowStr,
        markedBy: data.markedBy,
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.attendanceSessionId, attendanceRecords.studentId],
        set: {
          status: data.status,
          source: data.source,
          markedBy: data.markedBy,
          updatedAt: new Date(),
        },
      })
      .returning()
      .then((r: any) => r[0]);
  }

  async createCorrection(data: {
    attendanceRecordId: string;
    previousStatus: string;
    newStatus: string;
    reason: string;
    correctedBy: string;
    isPostClosure?: boolean;
    fallbackRequestId?: string;
  }, tx?: any) {
    const client = tx || db;
    return await client
      .insert(attendanceCorrections)
      .values({
        attendanceRecordId: data.attendanceRecordId,
        previousStatus: data.previousStatus,
        newStatus: data.newStatus,
        reason: data.reason,
        correctedBy: data.correctedBy,
        isPostClosure: data.isPostClosure || false,
        fallbackRequestId: data.fallbackRequestId || null,
      })
      .returning()
      .then((r: any) => r[0]);
  }

  async getCorrections(filter?: string | AttendanceCorrectionFilter) {
    const opts: AttendanceCorrectionFilter =
      typeof filter === "string" ? { recordId: filter } : filter || {};

    const conditions = [];
    if (opts.recordId) {
      conditions.push(eq(attendanceCorrections.attendanceRecordId, opts.recordId));
    }
    if (opts.sessionId) {
      conditions.push(eq(attendanceRecords.attendanceSessionId, opts.sessionId));
    }
    if (opts.classId) {
      conditions.push(eq(students.classId, opts.classId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limitVal = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 100;

    let query = db
      .select({
        id: attendanceCorrections.id,
        attendanceRecordId: attendanceCorrections.attendanceRecordId,
        sessionId: attendanceRecords.attendanceSessionId,
        sessionDate: attendanceSessions.sessionDate,
        studentId: attendanceRecords.studentId,
        studentName: students.name,
        registerNumber: students.registerNumber,
        classId: students.classId,
        previousStatus: attendanceCorrections.previousStatus,
        newStatus: attendanceCorrections.newStatus,
        reason: attendanceCorrections.reason,
        correctedByStaffId: attendanceCorrections.correctedBy,
        correctedByName: staff.name,
        isPostClosure: attendanceCorrections.isPostClosure,
        fallbackRequestId: attendanceCorrections.fallbackRequestId,
        createdAt: attendanceCorrections.createdAt,
      })
      .from(attendanceCorrections)
      .innerJoin(attendanceRecords, eq(attendanceCorrections.attendanceRecordId, attendanceRecords.id))
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .innerJoin(attendanceSessions, eq(attendanceRecords.attendanceSessionId, attendanceSessions.id))
      .innerJoin(staff, eq(attendanceCorrections.correctedBy, staff.id))
      .where(whereClause)
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(limitVal);

    if (opts.offset && opts.offset > 0) {
      query = (query as any).offset(opts.offset);
    }

    return await query;
  }
}

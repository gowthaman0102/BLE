import { AttendanceRecordRepository, AttendanceRecordFilter, AttendanceCorrectionFilter } from "../repositories/attendance-record.repository";
import { AttendanceSessionRepository } from "../repositories/attendanceSession.repository";
import { AuditService } from "./audit.service";
import type { AuditActor } from "./staff.service";
import { db } from "../db";
import { attendanceRecords } from "../db/schema/attendance-records";
import { attendanceSessions } from "../db/schema/attendance";
import { timetables, periods } from "../db/schema/timetable";
import { subjects } from "../db/schema/subjects";
import { staff } from "../db/schema/staff";
import { classes } from "../db/schema/academic";
import { students } from "../db/schema/students";
import { eq, and, inArray, ne } from "drizzle-orm";
import { getDateInTimeZone, getWeekdayInTimeZone } from "../utils/date";
import type { StudentAttendanceSummary, TodayAttendanceStatus, StudentAttendanceHistoryItem } from "@smart-attendance/shared";

export interface AttendanceCorrectionInput {
  recordId: string;
  newStatus: "PRESENT" | "ABSENT" | "LATE" | "MANUAL";
  reason: string;
  actor: AuditActor;
}

export interface ManualMarkInput {
  sessionId: string;
  studentId: string;
  status: "PRESENT" | "ABSENT" | "LATE" | "MANUAL";
  reason?: string;
  actor: AuditActor;
}

export class AttendanceRecordService {
  private repo: AttendanceRecordRepository;
  private sessionRepo: AttendanceSessionRepository;
  private audit: AuditService;

  constructor() {
    this.repo = new AttendanceRecordRepository();
    this.sessionRepo = new AttendanceSessionRepository();
    this.audit = new AuditService();
  }

  async getRecords(filter: AttendanceRecordFilter = {}) {
    return await this.repo.getRecords(filter);
  }

  async getStudentRecordForSession(sessionId: string, studentId: string) {
    return await this.repo.findBySessionAndStudent(sessionId, studentId);
  }

  async getRecordById(id: string) {
    const record = await this.repo.getRecordById(id);
    if (!record) throw new Error("RECORD_NOT_FOUND");
    const corrections = await this.repo.getCorrections(id);
    return { ...record, corrections };
  }

  async getCorrections(filter?: string | AttendanceCorrectionFilter) {
    return await this.repo.getCorrections(filter);
  }

  /**
   * Computes class-wise attendance summary and session breakdown for a date range.
   */
  async getClassSummary(classId: string, startDate?: string, endDate?: string) {
    if (!classId) throw new Error("CLASS_ID_REQUIRED");

    // 1. Verify class exists
    const [classRecord] = await db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(eq(classes.id, classId));
    if (!classRecord) throw new Error("CLASS_NOT_FOUND");

    // 2. Date validation
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !dateRegex.test(startDate)) {
      throw new Error("INVALID_START_DATE");
    }
    if (endDate && !dateRegex.test(endDate)) {
      throw new Error("INVALID_END_DATE");
    }
    if (startDate && endDate && startDate > endDate) {
      throw new Error("INVALID_DATE_RANGE");
    }

    // 3. Count eligible active students in this class
    const activeStudents = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.classId, classId), eq(students.status, "ACTIVE")));
    const totalStudents = activeStudents.length;

    // 4. Fetch all sessions for this class within the date range
    const sessions = await this.sessionRepo.findAll({
      classId,
      startDate,
      endDate,
    });

    const qualifyingStatuses = ["PRESENT", "LATE", "MANUAL", "ON_DUTY"];

    // 5. If sessions exist, fetch all attendance records for these sessions
    let sessionRecordMap = new Map<string, { status: string; studentId: string }[]>();
    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);
      const records = await db
        .select({
          sessionId: attendanceRecords.attendanceSessionId,
          studentId: attendanceRecords.studentId,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords)
        .where(inArray(attendanceRecords.attendanceSessionId, sessionIds));

      for (const rec of records) {
        const list = sessionRecordMap.get(rec.sessionId) || [];
        list.push({ status: rec.status, studentId: rec.studentId });
        sessionRecordMap.set(rec.sessionId, list);
      }
    }

    // 6. Partition sessions by status according to verified backend rules
    const conductedSessions = sessions.filter(
      (s) => s.status === "COMPLETED" || s.status === "EXPIRED"
    );
    const cancelledSessions = sessions.filter((s) => s.status === "CANCELLED");
    const activeSessions = sessions.filter((s) => s.status === "ACTIVE");
    const scheduledSessions = sessions.filter((s) => s.status === "SCHEDULED");

    // Aggregate attendance across conducted sessions
    let totalPresentInConducted = 0;
    for (const session of conductedSessions) {
      const recs = sessionRecordMap.get(session.id) || [];
      const presentInSession = recs.filter((r) => qualifyingStatuses.includes(r.status)).length;
      totalPresentInConducted += presentInSession;
    }

    const totalConductedSlots = conductedSessions.length * totalStudents;
    const totalAbsentInConducted = Math.max(0, totalConductedSlots - totalPresentInConducted);

    const hasData = conductedSessions.length > 0 && totalStudents > 0;
    const attendancePercentage = hasData
      ? Math.round((totalPresentInConducted / totalConductedSlots) * 100)
      : null;

    // 7. Build session breakdown
    const sessionBreakdown = sessions.map((session) => {
      const recs = sessionRecordMap.get(session.id) || [];
      const isConducted = session.status === "COMPLETED" || session.status === "EXPIRED";
      const isActive = session.status === "ACTIVE";
      const isCancelled = session.status === "CANCELLED";

      let presentCount = 0;
      let absentCount = 0;
      let percentage: number | null = null;

      if (isConducted || isActive) {
        presentCount = recs.filter((r) => qualifyingStatuses.includes(r.status)).length;
        absentCount = Math.max(0, totalStudents - presentCount);
        percentage = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : null;
      }

      return {
        id: session.id,
        sessionDate: session.sessionDate,
        status: session.status,
        subjectName: session.subjectName,
        periodName: session.periodName,
        periodStartTime: session.periodStartTime,
        periodEndTime: session.periodEndTime,
        staffName: session.staffName,
        cancellationReason: session.cancellationReason,
        totalStudents,
        presentCount: isCancelled ? 0 : presentCount,
        absentCount: isCancelled ? 0 : absentCount,
        percentage: isCancelled ? null : percentage,
      };
    });

    return {
      classId,
      className: classRecord.name,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      metrics: {
        eligibleSessions: sessions.length - cancelledSessions.length,
        conductedSessions: conductedSessions.length,
        cancelledSessions: cancelledSessions.length,
        activeSessions: activeSessions.length,
        scheduledSessions: scheduledSessions.length,
        totalStudents,
        totalPresent: totalPresentInConducted,
        totalAbsent: totalAbsentInConducted,
        attendancePercentage,
        hasData,
      },
      sessions: sessionBreakdown,
    };
  }

  async correctAttendance(input: AttendanceCorrectionInput) {
    if (!input.recordId) throw new Error("RECORD_ID_REQUIRED");
    if (!input.newStatus) throw new Error("NEW_STATUS_REQUIRED");
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error("CORRECTION_REASON_REQUIRED");
    }

    const validStatuses = ["PRESENT", "ABSENT", "LATE", "MANUAL"];
    if (!validStatuses.includes(input.newStatus)) {
      throw new Error("INVALID_ATTENDANCE_STATUS");
    }

    const existing = await this.repo.getRecordById(input.recordId);
    if (!existing) throw new Error("RECORD_NOT_FOUND");

    if (existing.status === input.newStatus) {
      throw new Error("STATUS_UNCHANGED");
    }

    const actorId = input.actor.actorId;
    if (!actorId) throw new Error("ACTOR_ID_REQUIRED");

    const session = await this.sessionRepo.findById(existing.sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.status === "CANCELLED") {
      throw new Error("SESSION_CANCELLED");
    }
    const isPostClosure = session.status === "COMPLETED" || session.status === "EXPIRED";

    let result: any = null;
    await db.transaction(async (tx) => {
      // 1. Record correction history
      const correction = await this.repo.createCorrection(
        {
          attendanceRecordId: existing.id,
          previousStatus: existing.status,
          newStatus: input.newStatus,
          reason: input.reason.trim(),
          correctedBy: actorId,
          isPostClosure,
        },
        tx
      );

      // 2. Update the record
      const updated = await this.repo.upsertRecord(
        {
          attendanceSessionId: existing.sessionId,
          studentId: existing.studentId,
          status: input.newStatus,
          source: "MANUAL",
          markedBy: actorId,
        },
        tx
      );

      // 3. Audit log
      await this.audit.log(
        {
          actorId: actorId,
          actorName: input.actor.actorName,
          actorRole: input.actor.actorRole,
          action: "CORRECT_ATTENDANCE",
          entityType: "ATTENDANCE_RECORD",
          entityId: existing.id,
          description: `Corrected attendance for ${existing.studentName} (${existing.registerNumber}) from ${existing.status} to ${input.newStatus}. Reason: ${input.reason.trim()}${isPostClosure ? " (Post-Closure)" : ""}`,
          oldValues: { status: existing.status },
          newValues: { status: input.newStatus, reason: input.reason.trim(), isPostClosure },
          ipAddress: input.actor.ipAddress,
          userAgent: input.actor.userAgent,
        },
        tx
      );

      result = { ...updated, correction };
    });

    return result;
  }

  async manualMark(input: ManualMarkInput) {
    if (!input.sessionId) throw new Error("SESSION_ID_REQUIRED");
    if (!input.studentId) throw new Error("STUDENT_ID_REQUIRED");
    if (!input.status) throw new Error("STATUS_REQUIRED");
    const actorId = input.actor.actorId;
    if (!actorId) throw new Error("ACTOR_ID_REQUIRED");

    const session = await this.sessionRepo.findById(input.sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.status === "CANCELLED") {
      throw new Error("SESSION_CANCELLED");
    }
    const isPostClosure = session.status === "COMPLETED" || session.status === "EXPIRED";

    const existing = await this.repo.getRecordBySessionAndStudent(input.sessionId, input.studentId);
    const previousStatus = existing ? existing.status : null;

    let result: any = null;
    await db.transaction(async (tx) => {
      const record = await this.repo.upsertRecord(
        {
          attendanceSessionId: input.sessionId,
          studentId: input.studentId,
          status: input.status,
          source: "MANUAL",
          markedBy: actorId,
        },
        tx
      );

      if (previousStatus && previousStatus !== input.status && input.reason) {
        await this.repo.createCorrection(
          {
            attendanceRecordId: record.id,
            previousStatus,
            newStatus: input.status,
            reason: input.reason.trim(),
            correctedBy: actorId,
            isPostClosure,
          },
          tx
        );
      }

      await this.audit.log(
        {
          actorId: input.actor.actorId,
          actorName: input.actor.actorName,
          actorRole: input.actor.actorRole,
          action: "MANUAL_MARK_ATTENDANCE",
          entityType: "ATTENDANCE_RECORD",
          entityId: record.id,
          description: `Manually marked student attendance as ${input.status} for session ${input.sessionId}${isPostClosure ? " (Post-Closure)" : ""}`,
          oldValues: previousStatus ? { status: previousStatus } : undefined,
          newValues: { status: input.status, reason: input.reason, isPostClosure },
          ipAddress: input.actor.ipAddress,
          userAgent: input.actor.userAgent,
        },
        tx
      );

      result = record;
    });

    return result;
  }

  /**
   * Computes the overall attendance summary and today's status for a student.
   */
  async getStudentSummary(studentId: string, classId: string): Promise<StudentAttendanceSummary> {
    // 1. Overall Attendance: Eligible conducted sessions (COMPLETED / EXPIRED) for this class
    const conductedSessions = await db
      .select({
        id: attendanceSessions.id,
      })
      .from(attendanceSessions)
      .innerJoin(timetables, eq(attendanceSessions.timetableId, timetables.id))
      .where(
        and(
          eq(timetables.classId, classId),
          inArray(attendanceSessions.status, ["COMPLETED", "EXPIRED"])
        )
      );

    const totalConducted = conductedSessions.length;
    let attendedSessions = 0;

    if (totalConducted > 0) {
      const conductedSessionIds = conductedSessions.map((s) => s.id);
      const records = await db
        .select({
          id: attendanceRecords.id,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, studentId),
            inArray(attendanceRecords.attendanceSessionId, conductedSessionIds)
          )
        );

      const qualifyingStatuses = ["PRESENT", "LATE", "MANUAL", "ON_DUTY"];
      attendedSessions = records.filter((r) => qualifyingStatuses.includes(r.status)).length;
    }

    const overall = {
      percentage: totalConducted > 0 ? Math.round((attendedSessions / totalConducted) * 100) : null,
      attendedSessions,
      totalSessions: totalConducted,
      hasData: totalConducted > 0,
    };

    // 2. Today's Attendance Status
    const today = getDateInTimeZone();
    const todayDay = getWeekdayInTimeZone();

    const todaySessions = await db
      .select({
        id: attendanceSessions.id,
        status: attendanceSessions.status,
        startedAt: attendanceSessions.startedAt,
        endedAt: attendanceSessions.endedAt,
        subjectName: subjects.name,
        subjectCode: subjects.code,
        periodName: periods.name,
        periodNumber: periods.periodNumber,
        periodStartTime: periods.startTime,
        periodEndTime: periods.endTime,
      })
      .from(attendanceSessions)
      .innerJoin(timetables, eq(attendanceSessions.timetableId, timetables.id))
      .innerJoin(subjects, eq(timetables.subjectId, subjects.id))
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .where(
        and(
          eq(timetables.classId, classId),
          eq(attendanceSessions.sessionDate, today),
          ne(attendanceSessions.status, "CANCELLED")
        )
      )
      .orderBy(periods.periodNumber);

    let todayRecordMap = new Map<string, { status: string; markedAt: string }>();
    if (todaySessions.length > 0) {
      const records = await db
        .select({
          sessionId: attendanceRecords.attendanceSessionId,
          status: attendanceRecords.status,
          markedAt: attendanceRecords.markedAt,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, studentId),
            inArray(attendanceRecords.attendanceSessionId, todaySessions.map((s) => s.id))
          )
        );
      todayRecordMap = new Map(records.map((r) => [r.sessionId, { status: r.status, markedAt: r.markedAt }]));
    }

    let todayStatus: TodayAttendanceStatus = "NO_SESSION";
    let todaySessionName: string | undefined = undefined;
    let todayPeriodTime: string | undefined = undefined;
    let todayMarkedAt: string | null = null;

    // Precedence 1: Current ACTIVE session
    const activeSession = todaySessions.find((s) => s.status === "ACTIVE");
    if (activeSession) {
      const record = todayRecordMap.get(activeSession.id);
      todaySessionName = `${activeSession.subjectName} (${activeSession.periodName})`;
      todayPeriodTime = `${activeSession.periodStartTime} – ${activeSession.periodEndTime}`;
      if (record) {
        todayStatus = record.status === "MANUAL" ? "PRESENT" : (record.status as TodayAttendanceStatus);
        todayMarkedAt = record.markedAt;
      } else {
        todayStatus = "IN_PROGRESS";
      }
    } else {
      // Precedence 2: Next upcoming SCHEDULED session
      const scheduledSession = todaySessions.find((s) => s.status === "SCHEDULED");
      if (scheduledSession) {
        todayStatus = "NOT_STARTED";
        todaySessionName = `${scheduledSession.subjectName} (${scheduledSession.periodName})`;
        todayPeriodTime = `${scheduledSession.periodStartTime} – ${scheduledSession.periodEndTime}`;
      } else {
        // Precedence 3: Today's COMPLETED or EXPIRED session (prefer latest completed)
        const completedSessions = todaySessions.filter((s) => s.status === "COMPLETED" || s.status === "EXPIRED");
        if (completedSessions.length > 0) {
          const latestCompleted = completedSessions[completedSessions.length - 1];
          const record = todayRecordMap.get(latestCompleted.id);
          todaySessionName = `${latestCompleted.subjectName} (${latestCompleted.periodName})`;
          todayPeriodTime = `${latestCompleted.periodStartTime} – ${latestCompleted.periodEndTime}`;
          if (record) {
            todayStatus = record.status === "MANUAL" ? "PRESENT" : (record.status as TodayAttendanceStatus);
            todayMarkedAt = record.markedAt;
          } else {
            todayStatus = "ABSENT";
          }
        } else {
          // Precedence 4: Check if any timetable slots are scheduled for today
          const todayTimetable = await db
            .select({ id: timetables.id })
            .from(timetables)
            .where(
              and(
                eq(timetables.classId, classId),
                eq(timetables.dayOfWeek, todayDay),
                eq(timetables.status, "ACTIVE")
              )
            )
            .limit(1);

          if (todayTimetable.length > 0) {
            todayStatus = "NOT_STARTED";
          } else {
            todayStatus = "NO_SESSION";
          }
        }
      }
    }

    return {
      overall,
      today: {
        status: todayStatus,
        sessionName: todaySessionName,
        periodTime: todayPeriodTime,
        markedAt: todayMarkedAt,
      },
    };
  }

  /**
   * Retrieves the attendance history for a student, ordered newest date first, then by period.
   */
  async getStudentHistory(studentId: string, classId?: string): Promise<StudentAttendanceHistoryItem[]> {
    // 1. Fetch explicit attendance records for this student
    const records = await db
      .select({
        id: attendanceRecords.id,
        sessionId: attendanceRecords.attendanceSessionId,
        status: attendanceRecords.status,
        source: attendanceRecords.source,
        markedAt: attendanceRecords.markedAt,
        sessionDate: attendanceSessions.sessionDate,
        sessionStatus: attendanceSessions.status,
        subjectName: subjects.name,
        subjectCode: subjects.code,
        periodName: periods.name,
        periodNumber: periods.periodNumber,
        periodStartTime: periods.startTime,
        periodEndTime: periods.endTime,
        staffName: staff.name,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceRecords.attendanceSessionId, attendanceSessions.id))
      .innerJoin(timetables, eq(attendanceSessions.timetableId, timetables.id))
      .innerJoin(subjects, eq(timetables.subjectId, subjects.id))
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .leftJoin(staff, eq(attendanceSessions.startedByStaffId, staff.id))
      .where(
        and(
          eq(attendanceRecords.studentId, studentId),
          ne(attendanceSessions.status, "CANCELLED")
        )
      );

    const recordSessionIds = new Set(records.map((r) => r.sessionId));

    // 2. Fetch completed/expired sessions for this student's class where student has no explicit record (unattended -> ABSENT)
    let unrecordedSessions: StudentAttendanceHistoryItem[] = [];
    if (classId) {
      const conducted = await db
        .select({
          sessionId: attendanceSessions.id,
          sessionDate: attendanceSessions.sessionDate,
          sessionStatus: attendanceSessions.status,
          endedAt: attendanceSessions.endedAt,
          subjectName: subjects.name,
          subjectCode: subjects.code,
          periodName: periods.name,
          periodNumber: periods.periodNumber,
          periodStartTime: periods.startTime,
          periodEndTime: periods.endTime,
          staffName: staff.name,
        })
        .from(attendanceSessions)
        .innerJoin(timetables, eq(attendanceSessions.timetableId, timetables.id))
        .innerJoin(subjects, eq(timetables.subjectId, subjects.id))
        .innerJoin(periods, eq(timetables.periodId, periods.id))
        .leftJoin(staff, eq(attendanceSessions.startedByStaffId, staff.id))
        .where(
          and(
            eq(timetables.classId, classId),
            inArray(attendanceSessions.status, ["COMPLETED", "EXPIRED"])
          )
        );

      unrecordedSessions = conducted
        .filter((s) => !recordSessionIds.has(s.sessionId))
        .map((s) => ({
          id: `unrecorded-${s.sessionId}`,
          sessionId: s.sessionId,
          sessionDate: s.sessionDate,
          status: "ABSENT" as const,
          source: "MANUAL" as const,
          markedAt: s.endedAt || null,
          subjectName: s.subjectName,
          subjectCode: s.subjectCode,
          periodName: s.periodName,
          periodNumber: s.periodNumber,
          periodStartTime: s.periodStartTime,
          periodEndTime: s.periodEndTime,
          staffName: s.staffName || undefined,
        }));
    }

    // Combine and sort newest date first, then by period
    const combined: StudentAttendanceHistoryItem[] = [
      ...records.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        sessionDate: r.sessionDate,
        status: (r.status === "MANUAL" ? "PRESENT" : r.status) as StudentAttendanceHistoryItem["status"],
        source: r.source,
        markedAt: r.markedAt,
        subjectName: r.subjectName,
        subjectCode: r.subjectCode,
        periodName: r.periodName,
        periodNumber: r.periodNumber,
        periodStartTime: r.periodStartTime,
        periodEndTime: r.periodEndTime,
        staffName: r.staffName || undefined,
      })),
      ...unrecordedSessions,
    ];

    combined.sort((a, b) => {
      // 1. Newest date first
      if (a.sessionDate !== b.sessionDate) {
        return b.sessionDate.localeCompare(a.sessionDate);
      }
      // 2. Then period order
      if (a.periodStartTime && b.periodStartTime) {
        return a.periodStartTime.localeCompare(b.periodStartTime);
      }
      return (a.periodNumber || 0) - (b.periodNumber || 0);
    });

    return combined;
  }
}

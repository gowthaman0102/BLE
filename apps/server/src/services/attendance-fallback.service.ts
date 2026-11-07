import { db } from "../db";
import { AttendanceFallbackRepository } from "../repositories/attendance-fallback.repository";
import { AttendanceRecordRepository } from "../repositories/attendance-record.repository";
import { AttendanceSessionRepository } from "../repositories/attendanceSession.repository";
import { attendanceAuthService } from "./attendance-auth.service";
import { AuditService } from "./audit.service";
import type { AuditActor } from "./staff.service";
import { students } from "../db/schema/students";
import { timetables } from "../db/schema/timetable";
import { eq } from "drizzle-orm";
import type {
  AttendanceFallbackReason,
  AttendanceFallbackRequest,
  CreateFallbackRequestInput,
  ResolveFallbackRequestInput,
  AuthPrincipal,
} from "@smart-attendance/shared";

export const ALLOWED_FALLBACK_REASONS: AttendanceFallbackReason[] = [
  "CAMERA_PERMISSION_DENIED",
  "CAMERA_UNAVAILABLE",
  "LIVENESS_FAILED",
  "LIVENESS_EXPIRED",
  "FACE_MISMATCH",
  "BLE_UNAVAILABLE",
  "TECHNICAL_ISSUE",
];

export class AttendanceFallbackService {
  private repo: AttendanceFallbackRepository;
  private recordRepo: AttendanceRecordRepository;
  private sessionRepo: AttendanceSessionRepository;
  private audit: AuditService;

  constructor() {
    this.repo = new AttendanceFallbackRepository();
    this.recordRepo = new AttendanceRecordRepository();
    this.sessionRepo = new AttendanceSessionRepository();
    this.audit = new AuditService();
  }

  async submitRequest(
    studentId: string,
    input: CreateFallbackRequestInput,
    actor?: AuditActor
  ): Promise<AttendanceFallbackRequest> {
    if (!studentId) throw new Error("STUDENT_ID_REQUIRED");
    if (!input.sessionId) throw new Error("SESSION_ID_REQUIRED");
    if (!input.reasonCategory) throw new Error("REASON_CATEGORY_REQUIRED");

    if (!ALLOWED_FALLBACK_REASONS.includes(input.reasonCategory)) {
      throw new Error("INVALID_FALLBACK_REASON_CATEGORY");
    }

    if (input.explanation && input.explanation.length > 500) {
      throw new Error("EXPLANATION_TOO_LONG");
    }

    // 1. Verify student exists and is ACTIVE
    const [student] = await db
      .select({ id: students.id, classId: students.classId, name: students.name, status: students.status })
      .from(students)
      .where(eq(students.id, studentId));
    if (!student) throw new Error("STUDENT_NOT_FOUND");
    if (student.status !== "ACTIVE") throw new Error("STUDENT_INACTIVE");

    // 2. Verify session exists and is not CANCELLED
    const session = await this.sessionRepo.findById(input.sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.status === "CANCELLED") {
      throw new Error("SESSION_CANCELLED");
    }
    if (session.status === "SCHEDULED") {
      throw new Error("SESSION_NOT_ACTIVE");
    }

    // 3. Verify student belongs to class of the session
    const [tt] = await db
      .select({ classId: timetables.classId })
      .from(timetables)
      .where(eq(timetables.id, session.timetableId));
    if (!tt || tt.classId !== student.classId) {
      throw new Error("STUDENT_WRONG_CLASS");
    }

    // 4. Check for existing pending request
    const existingPending = await this.repo.findPendingBySessionAndStudent(input.sessionId, studentId);
    if (existingPending) {
      throw new Error("FALLBACK_REQUEST_ALREADY_PENDING");
    }

    // 5. Create request record (DOES NOT touch attendance_records)
    const created = await this.repo.createRequest({
      attendanceSessionId: input.sessionId,
      studentId,
      reasonCategory: input.reasonCategory,
      explanation: input.explanation?.trim(),
    });

    // 6. Audit log
    await this.audit.log({
      actorId: undefined, // actorId has FK to staff.id
      actorName: student.name,
      actorRole: "STUDENT",
      action: "SUBMIT_ATTENDANCE_FALLBACK",
      entityType: "ATTENDANCE_FALLBACK_REQUEST",
      entityId: created.id,
      description: `Student submitted attendance fallback request for session ${input.sessionId}. Reason: ${input.reasonCategory}`,
      newValues: {
        studentId: studentId,
        sessionId: input.sessionId,
        reasonCategory: input.reasonCategory,
        explanation: input.explanation,
      },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return {
      id: created.id,
      sessionId: created.attendanceSessionId,
      studentId: created.studentId,
      studentName: student.name,
      reasonCategory: created.reasonCategory as AttendanceFallbackReason,
      explanation: created.explanation,
      status: created.status as any,
      reviewedByStaffId: created.reviewedBy,
      reviewedAt: created.reviewedAt ? new Date(created.reviewedAt).toISOString() : null,
      reviewNotes: created.reviewNotes,
      createdAt: new Date(created.createdAt).toISOString(),
      updatedAt: new Date(created.updatedAt).toISOString(),
    };
  }

  async getStudentRequest(studentId: string, sessionId: string): Promise<AttendanceFallbackRequest | null> {
    if (!studentId || !sessionId) return null;
    const item = await this.repo.findLatestBySessionAndStudent(sessionId, studentId);
    if (!item) return null;
    return {
      id: item.id,
      sessionId: item.sessionId,
      studentId: item.studentId,
      reasonCategory: item.reasonCategory as AttendanceFallbackReason,
      explanation: item.explanation,
      status: item.status as any,
      reviewedByStaffId: item.reviewedByStaffId,
      reviewedByName: item.reviewedByName,
      reviewedAt: item.reviewedAt ? new Date(item.reviewedAt).toISOString() : null,
      reviewNotes: item.reviewNotes,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    };
  }

  async listRequestsForSession(sessionId: string, user: AuthPrincipal): Promise<AttendanceFallbackRequest[]> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");

    const canAccess = await attendanceAuthService.canAccessSession(user, session);
    if (!canAccess) throw new Error("ACCESS_DENIED");

    const items = await this.repo.findAllBySession(sessionId);
    return items.map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      studentId: item.studentId,
      studentName: item.studentName,
      registerNumber: item.registerNumber,
      reasonCategory: item.reasonCategory as AttendanceFallbackReason,
      explanation: item.explanation,
      status: item.status as any,
      reviewedByStaffId: item.reviewedByStaffId,
      reviewedByName: item.reviewedByName,
      reviewedAt: item.reviewedAt ? new Date(item.reviewedAt).toISOString() : null,
      reviewNotes: item.reviewNotes,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    }));
  }

  async resolveRequest(
    sessionId: string,
    requestId: string,
    user: AuthPrincipal,
    input: ResolveFallbackRequestInput,
    actor: AuditActor
  ): Promise<AttendanceFallbackRequest> {
    if (!sessionId) throw new Error("SESSION_ID_REQUIRED");
    if (!requestId) throw new Error("REQUEST_ID_REQUIRED");
    if (!input.resolution || !["APPROVED", "REJECTED"].includes(input.resolution)) {
      throw new Error("INVALID_RESOLUTION");
    }

    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");

    const canMutate = await attendanceAuthService.canMutateSession(user, session);
    if (!canMutate) throw new Error("ACCESS_DENIED");

    const existingRequest = await this.repo.findById(requestId);
    if (!existingRequest) throw new Error("REQUEST_NOT_FOUND");
    if (existingRequest.sessionId !== sessionId) throw new Error("SESSION_MISMATCH");
    if (existingRequest.status !== "PENDING") {
      throw new Error("REQUEST_ALREADY_RESOLVED");
    }

    const staffId = actor.actorId || user.id;
    if (!staffId) throw new Error("ACTOR_ID_REQUIRED");

    const notes = input.notes?.trim();
    if (input.resolution === "APPROVED") {
      if (!notes || notes.length < 3) {
        throw new Error("REASON_REQUIRED");
      }
    }

    const isPostClosure = session.status === "COMPLETED" || session.status === "EXPIRED";
    const newStatus = input.newStatus || "PRESENT";

    // Atomic transaction for resolution, attendance record update, correction history, and audit
    await db.transaction(async (tx) => {
      // 1. Update fallback request
      await this.repo.updateResolution(
        requestId,
        {
          status: input.resolution,
          reviewedBy: staffId,
          reviewedAt: new Date(),
          reviewNotes: notes,
        },
        tx
      );

      if (input.resolution === "APPROVED") {
        // 2. Fetch existing attendance record
        const existingRecord = await this.recordRepo.getRecordBySessionAndStudent(sessionId, existingRequest.studentId);
        const previousStatus = existingRecord ? existingRecord.status : "ABSENT";

        // 3. Upsert attendance record
        const updatedRecord = await this.recordRepo.upsertRecord(
          {
            attendanceSessionId: sessionId,
            studentId: existingRequest.studentId,
            status: newStatus,
            source: "MANUAL",
            markedBy: staffId,
          },
          tx
        );

        // 4. Create correction record
        await this.recordRepo.createCorrection(
          {
            attendanceRecordId: updatedRecord.id,
            previousStatus,
            newStatus,
            reason: `[Fallback Approved] ${notes}`,
            correctedBy: staffId,
            isPostClosure,
            fallbackRequestId: requestId,
          },
          tx
        );

        // 5. Audit log
        await this.audit.log(
          {
            actorId: staffId,
            actorName: actor.actorName || user.name,
            actorRole: actor.actorRole || user.roles[0] || "STAFF",
            action: "RESOLVE_ATTENDANCE_FALLBACK",
            entityType: "ATTENDANCE_FALLBACK_REQUEST",
            entityId: requestId,
            description: `Approved fallback request for ${existingRequest.studentName} (${existingRequest.registerNumber}). Marked as ${newStatus}. Reason: ${notes}${isPostClosure ? " (Post-Closure)" : ""}`,
            oldValues: { status: "PENDING", attendanceStatus: previousStatus },
            newValues: { status: "APPROVED", attendanceStatus: newStatus, isPostClosure, reason: notes },
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
          },
          tx
        );
      } else {
        // REJECTED
        await this.audit.log(
          {
            actorId: staffId,
            actorName: actor.actorName || user.name,
            actorRole: actor.actorRole || user.roles[0] || "STAFF",
            action: "REJECT_ATTENDANCE_FALLBACK",
            entityType: "ATTENDANCE_FALLBACK_REQUEST",
            entityId: requestId,
            description: `Rejected fallback request for ${existingRequest.studentName} (${existingRequest.registerNumber}). Reason: ${notes || "None"}`,
            oldValues: { status: "PENDING" },
            newValues: { status: "REJECTED", notes },
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
          },
          tx
        );
      }
    });

    const updated = await this.repo.findById(requestId);
    return {
      id: updated!.id,
      sessionId: updated!.sessionId,
      studentId: updated!.studentId,
      studentName: updated!.studentName,
      registerNumber: updated!.registerNumber,
      reasonCategory: updated!.reasonCategory as AttendanceFallbackReason,
      explanation: updated!.explanation,
      status: updated!.status as any,
      reviewedByStaffId: updated!.reviewedByStaffId,
      reviewedByName: updated!.reviewedByName,
      reviewedAt: updated!.reviewedAt ? new Date(updated!.reviewedAt).toISOString() : null,
      reviewNotes: updated!.reviewNotes,
      createdAt: new Date(updated!.createdAt).toISOString(),
      updatedAt: new Date(updated!.updatedAt).toISOString(),
    };
  }
}

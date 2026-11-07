import { db } from "../db";
import { attendanceFallbackRequests } from "../db/schema/attendance-records";
import { students } from "../db/schema/students";
import { staff } from "../db/schema/staff";
import { eq, and, desc } from "drizzle-orm";
import type { AttendanceFallbackReason, AttendanceFallbackStatus } from "@smart-attendance/shared";

export class AttendanceFallbackRepository {
  async createRequest(
    data: {
      attendanceSessionId: string;
      studentId: string;
      reasonCategory: AttendanceFallbackReason;
      explanation?: string;
    },
    tx?: any
  ) {
    const client = tx || db;
    const [created] = await client
      .insert(attendanceFallbackRequests)
      .values({
        attendanceSessionId: data.attendanceSessionId,
        studentId: data.studentId,
        reasonCategory: data.reasonCategory,
        explanation: data.explanation || null,
        status: "PENDING",
      })
      .returning();
    return created;
  }

  async findPendingBySessionAndStudent(sessionId: string, studentId: string) {
    const rows = await db
      .select()
      .from(attendanceFallbackRequests)
      .where(
        and(
          eq(attendanceFallbackRequests.attendanceSessionId, sessionId),
          eq(attendanceFallbackRequests.studentId, studentId),
          eq(attendanceFallbackRequests.status, "PENDING")
        )
      )
      .limit(1);
    return rows[0] || null;
  }

  async findLatestBySessionAndStudent(sessionId: string, studentId: string) {
    const rows = await db
      .select({
        id: attendanceFallbackRequests.id,
        sessionId: attendanceFallbackRequests.attendanceSessionId,
        studentId: attendanceFallbackRequests.studentId,
        reasonCategory: attendanceFallbackRequests.reasonCategory,
        explanation: attendanceFallbackRequests.explanation,
        status: attendanceFallbackRequests.status,
        reviewedByStaffId: attendanceFallbackRequests.reviewedBy,
        reviewedByName: staff.name,
        reviewedAt: attendanceFallbackRequests.reviewedAt,
        reviewNotes: attendanceFallbackRequests.reviewNotes,
        createdAt: attendanceFallbackRequests.createdAt,
        updatedAt: attendanceFallbackRequests.updatedAt,
      })
      .from(attendanceFallbackRequests)
      .leftJoin(staff, eq(attendanceFallbackRequests.reviewedBy, staff.id))
      .where(
        and(
          eq(attendanceFallbackRequests.attendanceSessionId, sessionId),
          eq(attendanceFallbackRequests.studentId, studentId)
        )
      )
      .orderBy(desc(attendanceFallbackRequests.createdAt))
      .limit(1);
    return rows[0] || null;
  }

  async findById(id: string) {
    const rows = await db
      .select({
        id: attendanceFallbackRequests.id,
        sessionId: attendanceFallbackRequests.attendanceSessionId,
        studentId: attendanceFallbackRequests.studentId,
        studentName: students.name,
        registerNumber: students.registerNumber,
        reasonCategory: attendanceFallbackRequests.reasonCategory,
        explanation: attendanceFallbackRequests.explanation,
        status: attendanceFallbackRequests.status,
        reviewedByStaffId: attendanceFallbackRequests.reviewedBy,
        reviewedByName: staff.name,
        reviewedAt: attendanceFallbackRequests.reviewedAt,
        reviewNotes: attendanceFallbackRequests.reviewNotes,
        createdAt: attendanceFallbackRequests.createdAt,
        updatedAt: attendanceFallbackRequests.updatedAt,
      })
      .from(attendanceFallbackRequests)
      .innerJoin(students, eq(attendanceFallbackRequests.studentId, students.id))
      .leftJoin(staff, eq(attendanceFallbackRequests.reviewedBy, staff.id))
      .where(eq(attendanceFallbackRequests.id, id))
      .limit(1);
    return rows[0] || null;
  }

  async findAllBySession(sessionId: string) {
    return await db
      .select({
        id: attendanceFallbackRequests.id,
        sessionId: attendanceFallbackRequests.attendanceSessionId,
        studentId: attendanceFallbackRequests.studentId,
        studentName: students.name,
        registerNumber: students.registerNumber,
        reasonCategory: attendanceFallbackRequests.reasonCategory,
        explanation: attendanceFallbackRequests.explanation,
        status: attendanceFallbackRequests.status,
        reviewedByStaffId: attendanceFallbackRequests.reviewedBy,
        reviewedByName: staff.name,
        reviewedAt: attendanceFallbackRequests.reviewedAt,
        reviewNotes: attendanceFallbackRequests.reviewNotes,
        createdAt: attendanceFallbackRequests.createdAt,
        updatedAt: attendanceFallbackRequests.updatedAt,
      })
      .from(attendanceFallbackRequests)
      .innerJoin(students, eq(attendanceFallbackRequests.studentId, students.id))
      .leftJoin(staff, eq(attendanceFallbackRequests.reviewedBy, staff.id))
      .where(eq(attendanceFallbackRequests.attendanceSessionId, sessionId))
      .orderBy(desc(attendanceFallbackRequests.createdAt));
  }

  async updateResolution(
    id: string,
    data: {
      status: AttendanceFallbackStatus;
      reviewedBy: string;
      reviewedAt: Date;
      reviewNotes?: string;
    },
    tx?: any
  ) {
    const client = tx || db;
    const [updated] = await client
      .update(attendanceFallbackRequests)
      .set({
        status: data.status,
        reviewedBy: data.reviewedBy,
        reviewedAt: data.reviewedAt,
        reviewNotes: data.reviewNotes || null,
        updatedAt: new Date(),
      })
      .where(eq(attendanceFallbackRequests.id, id))
      .returning();
    return updated;
  }
}

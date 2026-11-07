import { TimetableRepository } from "../repositories/timetable.repository";
import { ClassSubjectRepository } from "../repositories/class-subject.repository";
import { StaffRepository } from "../repositories/staff.repository";
import { AcademicRepository } from "../repositories/academic.repository";
import { SubjectRepository } from "../repositories/subject.repository";
import { PeriodRepository } from "../repositories/period.repository";
import { AuditService } from "./audit.service";
import type { AuditActor } from "./staff.service";
import { db } from "../db";
import { attendanceSessions } from "../db/schema/attendance";
import { eq, sql } from "drizzle-orm";

const TEACHING_ROLES = ['STAFF', 'FACULTY', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR'];
const VALID_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export class TimetableService {
  private repo: TimetableRepository;
  private classSubjectRepo: ClassSubjectRepository;
  private staffRepo: StaffRepository;
  private academicRepo: AcademicRepository;
  private subjectRepo: SubjectRepository;
  private periodRepo: PeriodRepository;
  private audit: AuditService;

  constructor() {
    this.repo = new TimetableRepository();
    this.classSubjectRepo = new ClassSubjectRepository();
    this.staffRepo = new StaffRepository();
    this.academicRepo = new AcademicRepository();
    this.subjectRepo = new SubjectRepository();
    this.periodRepo = new PeriodRepository();
    this.audit = new AuditService();
  }

  async getTimetableByClass(classId: string, academicYearId?: string) {
    return await this.repo.findByClass(classId, academicYearId);
  }

  async getTimetableByStaff(staffId: string, academicYearId?: string) {
    return await this.repo.findByStaff(staffId, academicYearId);
  }

  async createTimetableEntry(data: any, actor?: AuditActor) {
    // 1. Basic required fields check
    if (!data.academicYearId || !data.classId || !data.dayOfWeek || !data.periodId || !data.subjectId || !data.staffId) {
      throw new Error("Missing required fields: academicYearId, classId, dayOfWeek, periodId, subjectId, and staffId are required.");
    }

    if (!VALID_DAYS.includes(data.dayOfWeek)) {
      throw new Error("INVALID_DAY_OF_WEEK");
    }

    // 2. Validate Academic Year
    const academicYear = await this.academicRepo.getAcademicYearById(data.academicYearId);
    if (!academicYear) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
    if (academicYear.status !== 'ACTIVE') throw new Error("ACADEMIC_YEAR_INACTIVE");

    // 3. Validate Class
    const classItem = await this.academicRepo.getClassById(data.classId);
    if (!classItem) throw new Error("CLASS_NOT_FOUND");
    if (classItem.status !== 'ACTIVE') throw new Error("CLASS_INACTIVE");

    // 4. Validate Staff & Role
    const staffMember = await this.staffRepo.getStaffById(data.staffId);
    if (!staffMember) throw new Error("STAFF_NOT_FOUND");
    if (staffMember.status !== 'ACTIVE') throw new Error("STAFF_INACTIVE");
    const staffRoles = staffMember.roles || [];
    if (!staffRoles.some((r: string) => TEACHING_ROLES.includes(r))) {
      throw new Error("STAFF_ROLE_NOT_PERMITTED");
    }

    // 5. Validate Subject
    const subject = await this.subjectRepo.findById(data.subjectId);
    if (!subject) throw new Error("SUBJECT_NOT_FOUND");
    if (subject.status !== 'ACTIVE') throw new Error("SUBJECT_INACTIVE");

    // 6. Validate Period & Times
    const period = await this.periodRepo.findById(data.periodId);
    if (!period) throw new Error("PERIOD_NOT_FOUND");
    if (period.status !== 'ACTIVE') throw new Error("PERIOD_INACTIVE");
    if (period.startTime >= period.endTime) {
      throw new Error("PERIOD_INVALID_TIMES");
    }

    // 7. Check Class Conflict (Overlap)
    const classConflict = await this.repo.checkClassConflict(data.academicYearId, data.classId, data.dayOfWeek, data.periodId);
    if (classConflict) throw new Error("CLASS_TIMETABLE_CONFLICT");

    // 8. Check Staff Conflict (Overlap)
    const staffConflict = await this.repo.checkStaffConflict(data.academicYearId, data.staffId, data.dayOfWeek, data.periodId);
    if (staffConflict) throw new Error("STAFF_TIMETABLE_CONFLICT");

    // 9. Ensure Class-Subject link exists
    const isAssigned = await this.classSubjectRepo.checkExists(data.classId, data.subjectId, data.academicYearId);
    if (!isAssigned) {
      await this.classSubjectRepo.create({
        classId: data.classId,
        subjectId: data.subjectId,
        academicYearId: data.academicYearId,
        status: 'ACTIVE'
      });
    }

    const payload = {
      academicYearId: data.academicYearId,
      classId: data.classId,
      dayOfWeek: data.dayOfWeek,
      periodId: data.periodId,
      subjectId: data.subjectId,
      staffId: data.staffId,
      status: data.status || 'ACTIVE'
    };

    const entry = await this.repo.create(payload);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: "CREATE_TIMETABLE_ENTRY",
      entityType: "TIMETABLE",
      entityId: entry.id,
      description: `Scheduled "${subject.code} - ${subject.name}" for class "${classItem.name}" on ${data.dayOfWeek} (${period.name}) taught by "${staffMember.name}"`,
      newValues: payload,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return entry;
  }

  async updateTimetableEntry(id: string, data: any, actor?: AuditActor) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("TIMETABLE_NOT_FOUND");

    const merged = { ...existing, ...data };

    if (data.dayOfWeek) {
      if (!VALID_DAYS.includes(data.dayOfWeek)) throw new Error("INVALID_DAY_OF_WEEK");
    }

    if (data.academicYearId && data.academicYearId !== existing.academicYearId) {
      const ay = await this.academicRepo.getAcademicYearById(data.academicYearId);
      if (!ay) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
      if (ay.status !== 'ACTIVE') throw new Error("ACADEMIC_YEAR_INACTIVE");
    }

    if (data.classId && data.classId !== existing.classId) {
      const cl = await this.academicRepo.getClassById(data.classId);
      if (!cl) throw new Error("CLASS_NOT_FOUND");
      if (cl.status !== 'ACTIVE') throw new Error("CLASS_INACTIVE");
    }

    if (data.staffId && data.staffId !== existing.staffId) {
      const st = await this.staffRepo.getStaffById(data.staffId);
      if (!st) throw new Error("STAFF_NOT_FOUND");
      if (st.status !== 'ACTIVE') throw new Error("STAFF_INACTIVE");
      const staffRoles = st.roles || [];
      if (!staffRoles.some((r: string) => TEACHING_ROLES.includes(r))) {
        throw new Error("STAFF_ROLE_NOT_PERMITTED");
      }
    }

    if (data.subjectId && data.subjectId !== existing.subjectId) {
      const sb = await this.subjectRepo.findById(data.subjectId);
      if (!sb) throw new Error("SUBJECT_NOT_FOUND");
      if (sb.status !== 'ACTIVE') throw new Error("SUBJECT_INACTIVE");
      const isAssigned = await this.classSubjectRepo.checkExists(merged.classId, data.subjectId, merged.academicYearId);
      if (!isAssigned) {
        await this.classSubjectRepo.create({
          classId: merged.classId,
          subjectId: data.subjectId,
          academicYearId: merged.academicYearId,
          status: 'ACTIVE'
        });
      }
    }

    if (data.periodId && data.periodId !== existing.periodId) {
      const pr = await this.periodRepo.findById(data.periodId);
      if (!pr) throw new Error("PERIOD_NOT_FOUND");
      if (pr.status !== 'ACTIVE') throw new Error("PERIOD_INACTIVE");
      if (pr.startTime >= pr.endTime) throw new Error("PERIOD_INVALID_TIMES");
    }

    // Conflicts validation (excluding current id)
    if (data.classId || data.dayOfWeek || data.periodId || data.academicYearId) {
      const classConflict = await this.repo.checkClassConflict(merged.academicYearId, merged.classId, merged.dayOfWeek, merged.periodId, id);
      if (classConflict) throw new Error("CLASS_TIMETABLE_CONFLICT");
    }

    if (data.staffId || data.dayOfWeek || data.periodId || data.academicYearId) {
      const staffConflict = await this.repo.checkStaffConflict(merged.academicYearId, merged.staffId, merged.dayOfWeek, merged.periodId, id);
      if (staffConflict) throw new Error("STAFF_TIMETABLE_CONFLICT");
    }

    const updated = await this.repo.update(id, data);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: "UPDATE_TIMETABLE_ENTRY",
      entityType: "TIMETABLE",
      entityId: id,
      description: `Updated timetable entry ${id}`,
      oldValues: existing,
      newValues: data,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async getTimetableStats(academicYearId?: string) {
    return await this.repo.getTimetableStats(academicYearId);
  }

  async getTodayTimetable(academicYearId?: string, classId?: string) {
    return await this.repo.getTodayTimetable(academicYearId, classId);
  }

  async deleteTimetableEntry(id: string, actor?: AuditActor) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("TIMETABLE_NOT_FOUND");

    const [sessCount] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(attendanceSessions)
      .where(eq(attendanceSessions.timetableId, id));

    if ((sessCount?.count || 0) > 0) {
      throw new Error(`Cannot delete timetable slot: ${sessCount.count} attendance session(s) are linked to this schedule. Deactivate this slot instead.`);
    }

    const result = await this.repo.delete(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: "DELETE_TIMETABLE_ENTRY",
      entityType: "TIMETABLE",
      entityId: id,
      description: `Deleted timetable entry ${id}`,
      oldValues: existing,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return result;
  }
}

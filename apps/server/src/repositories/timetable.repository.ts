import { db } from "../db";
import { timetables, periods } from "../db/schema/timetable";
import { academicYears } from "../db/schema/academic";
import { subjects } from "../db/schema/subjects";
import { staff } from "../db/schema/staff";
import { classes } from "../db/schema/academic";
import { eq, and, sql } from "drizzle-orm";
import { getWeekdayInTimeZone } from "../utils/date";

export class TimetableRepository {
  async findByClass(classId: string, academicYearId?: string) {
    const conditions = [eq(timetables.classId, classId)];
    if (academicYearId) conditions.push(eq(timetables.academicYearId, academicYearId));

    return await db
      .select({
        id: timetables.id,
        academicYearId: timetables.academicYearId,
        classId: timetables.classId,
        dayOfWeek: timetables.dayOfWeek,
        periodId: timetables.periodId,
        subjectId: timetables.subjectId,
        staffId: timetables.staffId,
        staffName: staff.name,
        subjectName: subjects.name,
        subjectCode: subjects.code,
        periodNumber: periods.periodNumber,
        periodName: periods.name,
        periodStartTime: periods.startTime,
        periodEndTime: periods.endTime
      })
      .from(timetables)
      .innerJoin(subjects, eq(timetables.subjectId, subjects.id))
      .innerJoin(staff, eq(timetables.staffId, staff.id))
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .where(and(...conditions))
      .orderBy(periods.periodNumber);
  }

  async findByStaff(staffId: string, academicYearId?: string) {
    const conditions = [eq(timetables.staffId, staffId)];
    if (academicYearId) conditions.push(eq(timetables.academicYearId, academicYearId));

    return await db
      .select({
        id: timetables.id,
        academicYearId: timetables.academicYearId,
        classId: timetables.classId,
        className: classes.name,
        dayOfWeek: timetables.dayOfWeek,
        periodId: timetables.periodId,
        subjectId: timetables.subjectId,
        staffId: timetables.staffId,
        subjectName: subjects.name,
        subjectCode: subjects.code,
        periodName: periods.name,
        periodNumber: periods.periodNumber,
        periodStartTime: periods.startTime,
        periodEndTime: periods.endTime
      })
      .from(timetables)
      .innerJoin(classes, eq(timetables.classId, classes.id))
      .innerJoin(subjects, eq(timetables.subjectId, subjects.id))
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .where(and(...conditions));
  }

  async checkClassConflict(academicYearId: string, classId: string, dayOfWeek: string, periodId: string, excludeId?: string) {
    const conditions = [
      eq(timetables.academicYearId, academicYearId),
      eq(timetables.classId, classId),
      eq(timetables.dayOfWeek, dayOfWeek),
      eq(timetables.periodId, periodId)
    ];
    
    const [result] = await db.select().from(timetables).where(and(...conditions)).limit(1);
    if (result && result.id !== excludeId) return result;
    return null;
  }

  async checkStaffConflict(academicYearId: string, staffId: string, dayOfWeek: string, periodId: string, excludeId?: string) {
    const conditions = [
      eq(timetables.academicYearId, academicYearId),
      eq(timetables.staffId, staffId),
      eq(timetables.dayOfWeek, dayOfWeek),
      eq(timetables.periodId, periodId)
    ];
    
    const [result] = await db.select().from(timetables).where(and(...conditions)).limit(1);
    if (result && result.id !== excludeId) return result;
    return null;
  }

  async getTimetableStats(academicYearId?: string, date = new Date()) {
    const kolkataDay = getWeekdayInTimeZone(date);

    const conditions = [eq(timetables.status, 'ACTIVE'), eq(periods.status, 'ACTIVE'), eq(academicYears.status, 'ACTIVE')];
    if (academicYearId) conditions.push(eq(timetables.academicYearId, academicYearId));
    else conditions.push(eq(academicYears.isCurrent, true));

    const [totalRes] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(timetables)
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .innerJoin(academicYears, eq(timetables.academicYearId, academicYears.id))
      .where(conditions.length ? and(...conditions) : undefined);

    const todayConditions = [...conditions, eq(timetables.dayOfWeek, kolkataDay)];

    const [todayRes] = await db
      .select({
        count: sql`count(*)`.mapWith(Number),
        classesCount: sql`count(distinct ${timetables.classId})`.mapWith(Number),
        staffCount: sql`count(distinct ${timetables.staffId})`.mapWith(Number)
      })
      .from(timetables)
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .innerJoin(academicYears, eq(timetables.academicYearId, academicYears.id))
      .where(and(...todayConditions));

    return {
      totalEntries: totalRes?.count || 0,
      todayEntries: todayRes?.count || 0,
      classesScheduledToday: todayRes?.classesCount || 0,
      staffScheduledToday: todayRes?.staffCount || 0,
      dayOfWeek: kolkataDay
    };
  }

  async getTodayTimetable(academicYearId?: string, classId?: string) {
    const kolkataDay = getWeekdayInTimeZone();

    const conditions = [
      eq(timetables.dayOfWeek, kolkataDay),
      eq(timetables.status, 'ACTIVE'),
      eq(periods.status, 'ACTIVE'),
      eq(academicYears.status, 'ACTIVE'),
    ];
    if (academicYearId) conditions.push(eq(timetables.academicYearId, academicYearId));
    else conditions.push(eq(academicYears.isCurrent, true));
    if (classId) conditions.push(eq(timetables.classId, classId));

    return await db
      .select({
        id: timetables.id,
        academicYearId: timetables.academicYearId,
        classId: timetables.classId,
        className: classes.name,
        dayOfWeek: timetables.dayOfWeek,
        periodId: timetables.periodId,
        periodNumber: periods.periodNumber,
        periodName: periods.name,
        periodStartTime: periods.startTime,
        periodEndTime: periods.endTime,
        subjectId: timetables.subjectId,
        subjectCode: subjects.code,
        subjectName: subjects.name,
        subjectType: subjects.subjectType,
        staffId: timetables.staffId,
        staffName: staff.name,
        status: timetables.status
      })
      .from(timetables)
      .innerJoin(academicYears, eq(timetables.academicYearId, academicYears.id))
      .innerJoin(classes, eq(timetables.classId, classes.id))
      .innerJoin(subjects, eq(timetables.subjectId, subjects.id))
      .innerJoin(staff, eq(timetables.staffId, staff.id))
      .innerJoin(periods, eq(timetables.periodId, periods.id))
      .where(and(...conditions))
      .orderBy(periods.periodNumber, classes.name);
  }

  async findById(id: string) {
    const [result] = await db.select().from(timetables).where(eq(timetables.id, id)).limit(1);
    return result || null;
  }

  async create(data: any) {
    const [result] = await db.insert(timetables).values(data).returning();
    return result;
  }

  async update(id: string, data: any) {
    const [result] = await db.update(timetables).set({ ...data, updatedAt: new Date() }).where(eq(timetables.id, id)).returning();
    return result;
  }

  async delete(id: string) {
    await db.delete(timetables).where(eq(timetables.id, id));
  }
}

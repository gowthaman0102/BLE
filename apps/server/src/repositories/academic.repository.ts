import { eq, and, sql, ne } from 'drizzle-orm';
import { db } from '../db';
import {
  departments,
  academicYears,
  batches,
  regulations,
  classes,
} from '../db/schema/academic';
import { subjects, classSubjects } from '../db/schema/subjects';
import { timetables } from '../db/schema/timetable';
import { classCounselors } from '../db/schema/staff';
import { students } from '../db/schema/students';

export class AcademicRepository {
  // Departments
  async getDepartments() {
    return db.select().from(departments).orderBy(departments.name);
  }

  async getDepartmentById(id: string) {
    const result = await db.select().from(departments).where(eq(departments.id, id));
    return result[0];
  }

  async getDepartmentByCode(code: string) {
    const result = await db.select().from(departments).where(eq(departments.code, code));
    return result[0];
  }

  async createDepartment(data: typeof departments.$inferInsert) {
    return db.insert(departments).values(data).returning();
  }

  async updateDepartment(id: string, data: Partial<typeof departments.$inferInsert>) {
    return db.update(departments).set({ ...data, updatedAt: new Date() }).where(eq(departments.id, id)).returning();
  }

  async deleteDepartment(id: string) {
    return db.delete(departments).where(eq(departments.id, id)).returning();
  }

  async getDepartmentReferenceCounts(id: string) {
    const [bCount, cCount] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(batches).where(eq(batches.departmentId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classes).where(eq(classes.departmentId, id)),
    ]);

    return {
      batchesCount: Number(bCount[0]?.count || 0),
      classesCount: Number(cCount[0]?.count || 0),
    };
  }

  // Academic Years
  async getAcademicYears() {
    return db.select().from(academicYears).orderBy(academicYears.startDate);
  }
  
  async getAcademicYearById(id: string) {
    const result = await db.select().from(academicYears).where(eq(academicYears.id, id));
    return result[0];
  }

  async getAcademicYearByName(name: string) {
    const result = await db.select().from(academicYears).where(eq(academicYears.name, name));
    return result[0];
  }

  async getCurrentAcademicYear() {
    const result = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true));
    return result[0];
  }

  async unsetCurrentAcademicYears(exceptId?: string) {
    if (exceptId) {
      await db
        .update(academicYears)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(and(ne(academicYears.id, exceptId), eq(academicYears.isCurrent, true)));
    } else {
      await db
        .update(academicYears)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(eq(academicYears.isCurrent, true));
    }
  }

  async createAcademicYear(data: typeof academicYears.$inferInsert) {
    return db.insert(academicYears).values(data).returning();
  }

  async updateAcademicYear(id: string, data: Partial<typeof academicYears.$inferInsert>) {
    return db.update(academicYears).set({ ...data, updatedAt: new Date() }).where(eq(academicYears.id, id)).returning();
  }

  async deleteAcademicYear(id: string) {
    return db.delete(academicYears).where(eq(academicYears.id, id)).returning();
  }

  async getAcademicYearReferenceCounts(id: string) {
    const [cCount, csCount, tCount, ccCount] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classes).where(eq(classes.academicYearId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classSubjects).where(eq(classSubjects.academicYearId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(timetables).where(eq(timetables.academicYearId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classCounselors).where(eq(classCounselors.academicYearId, id)),
    ]);

    return {
      classesCount: Number(cCount[0]?.count || 0),
      classSubjectsCount: Number(csCount[0]?.count || 0),
      timetablesCount: Number(tCount[0]?.count || 0),
      counselorsCount: Number(ccCount[0]?.count || 0),
    };
  }

  // Batches
  async getBatches() {
    return db
      .select({
        id: batches.id,
        name: batches.name,
        startYear: batches.startYear,
        endYear: batches.endYear,
        status: batches.status,
        departmentId: batches.departmentId,
        department: departments.code
      })
      .from(batches)
      .leftJoin(departments, eq(batches.departmentId, departments.id))
      .orderBy(batches.startYear);
  }

  async getBatchById(id: string) {
    const result = await db.select().from(batches).where(eq(batches.id, id));
    return result[0];
  }

  async getBatchByNameAndDept(name: string, deptId: string) {
    const result = await db.select().from(batches).where(and(eq(batches.name, name), eq(batches.departmentId, deptId)));
    return result[0];
  }

  async createBatch(data: typeof batches.$inferInsert) {
    return db.insert(batches).values(data).returning();
  }

  async updateBatch(id: string, data: Partial<typeof batches.$inferInsert>) {
    return db.update(batches).set({ ...data, updatedAt: new Date() }).where(eq(batches.id, id)).returning();
  }

  async deleteBatch(id: string) {
    return db.delete(batches).where(eq(batches.id, id)).returning();
  }

  async getBatchReferenceCounts(id: string) {
    const [cCount] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classes).where(eq(classes.batchId, id)),
    ]);

    return {
      classesCount: Number(cCount[0]?.count || 0),
    };
  }

  // Regulations
  async getRegulations() {
    return db.select().from(regulations).orderBy(regulations.year);
  }

  async getRegulationById(id: string) {
    const result = await db.select().from(regulations).where(eq(regulations.id, id));
    return result[0];
  }

  async getRegulationByName(name: string) {
    const result = await db.select().from(regulations).where(eq(regulations.name, name));
    return result[0];
  }

  async createRegulation(data: typeof regulations.$inferInsert) {
    return db.insert(regulations).values(data).returning();
  }

  async updateRegulation(id: string, data: Partial<typeof regulations.$inferInsert>) {
    return db.update(regulations).set({ ...data, updatedAt: new Date() }).where(eq(regulations.id, id)).returning();
  }

  async deleteRegulation(id: string) {
    return db.delete(regulations).where(eq(regulations.id, id)).returning();
  }

  async getRegulationReferenceCounts(id: string) {
    const [cCount, sCount] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classes).where(eq(classes.regulationId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(subjects).where(eq(subjects.regulationId, id)),
    ]);

    return {
      classesCount: Number(cCount[0]?.count || 0),
      subjectsCount: Number(sCount[0]?.count || 0),
    };
  }

  // Classes
  async getClasses() {
    return db
      .select({
        id: classes.id,
        name: classes.name,
        yearNumber: classes.yearNumber,
        section: classes.section,
        status: classes.status,
        departmentId: classes.departmentId,
        academicYearId: classes.academicYearId,
        batchId: classes.batchId,
        regulationId: classes.regulationId,
        department: departments.code,
        academicYear: academicYears.name,
        batch: batches.name,
        regulation: regulations.name
      })
      .from(classes)
      .leftJoin(departments, eq(classes.departmentId, departments.id))
      .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
      .leftJoin(batches, eq(classes.batchId, batches.id))
      .leftJoin(regulations, eq(classes.regulationId, regulations.id))
      .orderBy(classes.name);
  }

  async getClassById(id: string) {
    const result = await db.select().from(classes).where(eq(classes.id, id));
    return result[0];
  }

  async getClassByUniqueConstraint(departmentId: string, academicYearId: string, yearNumber: number, section: string) {
    const result = await db.select().from(classes).where(
      and(
        eq(classes.departmentId, departmentId),
        eq(classes.academicYearId, academicYearId),
        eq(classes.yearNumber, yearNumber),
        eq(classes.section, section)
      )
    );
    return result[0];
  }

  async createClass(data: typeof classes.$inferInsert) {
    return db.insert(classes).values(data).returning();
  }

  async updateClass(id: string, data: Partial<typeof classes.$inferInsert>) {
    return db.update(classes).set({ ...data, updatedAt: new Date() }).where(eq(classes.id, id)).returning();
  }

  async deleteClass(id: string) {
    return db.delete(classes).where(eq(classes.id, id)).returning();
  }

  async getClassReferenceCounts(id: string) {
    const [sCount, csCount, tCount, ccCount] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(students).where(eq(students.classId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classSubjects).where(eq(classSubjects.classId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(timetables).where(eq(timetables.classId, id)),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(classCounselors).where(eq(classCounselors.classId, id)),
    ]);

    return {
      studentsCount: Number(sCount[0]?.count || 0),
      classSubjectsCount: Number(csCount[0]?.count || 0),
      timetablesCount: Number(tCount[0]?.count || 0),
      counselorsCount: Number(ccCount[0]?.count || 0),
    };
  }
}

import { AcademicRepository } from '../repositories/academic.repository';
import { departments, academicYears, batches, regulations, classes } from '../db/schema/academic';
import { AuditService } from './audit.service';

export interface AuditActor {
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AcademicService {
  private repo: AcademicRepository;
  private audit: AuditService;

  constructor() {
    this.repo = new AcademicRepository();
    this.audit = new AuditService();
  }

  // --- Departments ---
  async getDepartments() {
    return this.repo.getDepartments();
  }

  async getDepartmentById(id: string) {
    return this.repo.getDepartmentById(id);
  }

  async createDepartment(data: typeof departments.$inferInsert, actor?: AuditActor) {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Department name is required.');
    }

    if (!data.code || data.code.trim() === '') {
      throw new Error('Department code is required.');
    }

    const code = data.code.trim().toUpperCase();
    const existing = await this.repo.getDepartmentByCode(code);
    if (existing) {
      throw new Error('Department with this code already exists.');
    }

    const [created] = await this.repo.createDepartment({
      ...data,
      name: data.name.trim(),
      code,
      status: data.status || 'ACTIVE',
    });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'CREATE_DEPARTMENT',
      entityType: 'DEPARTMENT',
      entityId: created.id,
      description: `Created department "${created.name}" (${created.code})`,
      newValues: created,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return created;
  }

  async updateDepartment(id: string, data: Partial<typeof departments.$inferInsert>, actor?: AuditActor) {
    const existing = await this.repo.getDepartmentById(id);
    if (!existing) {
      throw new Error('Department not found');
    }

    if (data.name !== undefined && data.name.trim() === '') {
      throw new Error('Department name cannot be empty.');
    }

    if (data.code !== undefined) {
      if (data.code.trim() === '') {
        throw new Error('Department code cannot be empty.');
      }
      const code = data.code.trim().toUpperCase();
      const dup = await this.repo.getDepartmentByCode(code);
      if (dup && dup.id !== id) {
        throw new Error('Department with this code already exists.');
      }
      data.code = code;
    }

    if (data.name) {
      data.name = data.name.trim();
    }

    const [updated] = await this.repo.updateDepartment(id, data);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_DEPARTMENT',
      entityType: 'DEPARTMENT',
      entityId: id,
      description: `Updated department "${updated.name}" (${updated.code})`,
      oldValues: existing,
      newValues: updated,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async deleteDepartment(id: string, actor?: AuditActor) {
    const existing = await this.repo.getDepartmentById(id);
    if (!existing) {
      throw new Error('Department not found');
    }

    const refs = await this.repo.getDepartmentReferenceCounts(id);
    const issues: string[] = [];
    if (refs.batchesCount > 0) issues.push(`${refs.batchesCount} batch(es)`);
    if (refs.classesCount > 0) issues.push(`${refs.classesCount} class(es)`);

    if (issues.length > 0) {
      throw new Error(`Cannot delete department: ${issues.join(', ')} are associated with it. Please deactivate the department instead.`);
    }

    const [deleted] = await this.repo.deleteDepartment(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'DELETE_DEPARTMENT',
      entityType: 'DEPARTMENT',
      entityId: id,
      description: `Deleted department "${existing.name}" (${existing.code})`,
      oldValues: existing,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return deleted;
  }

  async getDefaultDepartmentId(departmentId?: string): Promise<string> {
    if (departmentId) return departmentId;
    const itDept = await this.repo.getDepartmentByCode('IT');
    if (itDept) return itDept.id;
    const all = await this.repo.getDepartments();
    if (all.length > 0) return all[0].id;
    throw new Error('No department configured in the system. Please ensure the IT department is created.');
  }

  // --- Academic Years ---
  async getAcademicYears() {
    return this.repo.getAcademicYears();
  }

  async getAcademicYearById(id: string) {
    return this.repo.getAcademicYearById(id);
  }

  async createAcademicYear(data: typeof academicYears.$inferInsert, actor?: AuditActor) {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Academic year name is required.');
    }

    if (!data.startDate || !data.endDate) {
      throw new Error('Start date and end date are required.');
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Valid start date and end date are required.');
    }

    if (startDate >= endDate) {
      throw new Error('Start date must be before end date.');
    }

    const existing = await this.repo.getAcademicYearByName(data.name.trim());
    if (existing) {
      throw new Error('Academic year with this name already exists.');
    }

    if (data.isCurrent) {
      await this.repo.unsetCurrentAcademicYears();
    }

    const [created] = await this.repo.createAcademicYear({
      ...data,
      name: data.name.trim(),
    });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'CREATE_ACADEMIC_YEAR',
      entityType: 'ACADEMIC_YEAR',
      entityId: created.id,
      description: `Created academic year "${created.name}"`,
      newValues: created,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return created;
  }

  async updateAcademicYear(id: string, data: Partial<typeof academicYears.$inferInsert>, actor?: AuditActor) {
    const existing = await this.repo.getAcademicYearById(id);
    if (!existing) {
      throw new Error('Academic year not found');
    }

    if (data.name && data.name.trim() !== '') {
      const dup = await this.repo.getAcademicYearByName(data.name.trim());
      if (dup && dup.id !== id) {
        throw new Error('Academic year with this name already exists.');
      }
      data.name = data.name.trim();
    }

    const startDate = data.startDate ? new Date(data.startDate) : existing.startDate;
    const endDate = data.endDate ? new Date(data.endDate) : existing.endDate;

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Valid start date and end date are required.');
    }

    if (startDate >= endDate) {
      throw new Error('Start date must be before end date.');
    }

    if (data.isCurrent) {
      await this.repo.unsetCurrentAcademicYears(id);
    }

    const [updated] = await this.repo.updateAcademicYear(id, data);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_ACADEMIC_YEAR',
      entityType: 'ACADEMIC_YEAR',
      entityId: id,
      description: `Updated academic year "${updated.name}"`,
      oldValues: existing,
      newValues: updated,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async deleteAcademicYear(id: string, actor?: AuditActor) {
    const existing = await this.repo.getAcademicYearById(id);
    if (!existing) {
      throw new Error('Academic year not found');
    }

    const refs = await this.repo.getAcademicYearReferenceCounts(id);
    const issues: string[] = [];
    if (refs.classesCount > 0) issues.push(`${refs.classesCount} class(es)`);
    if (refs.classSubjectsCount > 0) issues.push(`${refs.classSubjectsCount} subject mapping(s)`);
    if (refs.timetablesCount > 0) issues.push(`${refs.timetablesCount} timetable schedule(s)`);
    if (refs.counselorsCount > 0) issues.push(`${refs.counselorsCount} counselor assignment(s)`);

    if (issues.length > 0) {
      throw new Error(`Cannot delete academic year: ${issues.join(', ')} are associated with it.`);
    }

    const [deleted] = await this.repo.deleteAcademicYear(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'DELETE_ACADEMIC_YEAR',
      entityType: 'ACADEMIC_YEAR',
      entityId: id,
      description: `Deleted academic year "${existing.name}"`,
      oldValues: existing,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return deleted;
  }

  // --- Batches ---
  async getBatches() {
    return this.repo.getBatches();
  }

  async getBatchById(id: string) {
    return this.repo.getBatchById(id);
  }

  async createBatch(data: typeof batches.$inferInsert, actor?: AuditActor) {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Batch name is required.');
    }

    if (!data.startYear || !data.endYear) {
      throw new Error('Start year and end year are required.');
    }

    if (data.startYear >= data.endYear) {
      throw new Error('Start year must be less than end year.');
    }

    const departmentId = await this.getDefaultDepartmentId(data.departmentId);
    const department = await this.repo.getDepartmentById(departmentId);
    if (!department || department.status !== 'ACTIVE') throw new Error('Active department not found.');
    data.departmentId = departmentId;
    data.name = data.name.trim();

    const existing = await this.repo.getBatchByNameAndDept(data.name, departmentId);
    if (existing) {
      throw new Error('Batch with this name already exists in this department.');
    }

    const [created] = await this.repo.createBatch(data);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'CREATE_BATCH',
      entityType: 'BATCH',
      entityId: created.id,
      description: `Created batch "${created.name}"`,
      newValues: created,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return created;
  }

  async updateBatch(id: string, data: Partial<typeof batches.$inferInsert>, actor?: AuditActor) {
    const existingBatch = await this.repo.getBatchById(id);
    if (!existingBatch) throw new Error('Batch not found');

    const name = data.name ? data.name.trim() : existingBatch.name;
    const deptId = data.departmentId || existingBatch.departmentId;

    if (data.name || data.departmentId) {
      const existing = await this.repo.getBatchByNameAndDept(name, deptId);
      if (existing && existing.id !== id) {
        throw new Error('Batch with this name already exists in this department.');
      }
    }

    const startYear = data.startYear ?? existingBatch.startYear;
    const endYear = data.endYear ?? existingBatch.endYear;
    if (startYear >= endYear) {
      throw new Error('Start year must be less than end year.');
    }

    const [updated] = await this.repo.updateBatch(id, {
      ...data,
      name,
    });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_BATCH',
      entityType: 'BATCH',
      entityId: id,
      description: `Updated batch "${updated.name}"`,
      oldValues: existingBatch,
      newValues: updated,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async deleteBatch(id: string, actor?: AuditActor) {
    const existing = await this.repo.getBatchById(id);
    if (!existing) throw new Error('Batch not found');

    const refs = await this.repo.getBatchReferenceCounts(id);
    if (refs.classesCount > 0) {
      throw new Error(`Cannot delete batch: ${refs.classesCount} class(es) are associated with it.`);
    }

    const [deleted] = await this.repo.deleteBatch(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'DELETE_BATCH',
      entityType: 'BATCH',
      entityId: id,
      description: `Deleted batch "${existing.name}"`,
      oldValues: existing,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return deleted;
  }

  // --- Regulations ---
  async getRegulations() {
    return this.repo.getRegulations();
  }
  
  async getRegulationById(id: string) {
    return this.repo.getRegulationById(id);
  }

  async createRegulation(data: typeof regulations.$inferInsert, actor?: AuditActor) {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Regulation name is required.');
    }

    if (!data.year || isNaN(Number(data.year)) || Number(data.year) < 1900 || Number(data.year) > 2100) {
      throw new Error('A valid 4-digit regulation year is required.');
    }

    const name = data.name.trim();
    const existing = await this.repo.getRegulationByName(name);
    if (existing) {
      throw new Error('Regulation with this name already exists.');
    }

    const [created] = await this.repo.createRegulation({
      ...data,
      name,
      year: Number(data.year),
    });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'CREATE_REGULATION',
      entityType: 'REGULATION',
      entityId: created.id,
      description: `Created regulation "${created.name}"`,
      newValues: created,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return created;
  }

  async updateRegulation(id: string, data: Partial<typeof regulations.$inferInsert>, actor?: AuditActor) {
    const existing = await this.repo.getRegulationById(id);
    if (!existing) throw new Error('Regulation not found');

    if (data.name && data.name.trim() !== '') {
      const dup = await this.repo.getRegulationByName(data.name.trim());
      if (dup && dup.id !== id) {
        throw new Error('Regulation with this name already exists.');
      }
      data.name = data.name.trim();
    }

    if (data.year !== undefined) {
      if (isNaN(Number(data.year)) || Number(data.year) < 1900 || Number(data.year) > 2100) {
        throw new Error('A valid 4-digit regulation year is required.');
      }
      data.year = Number(data.year);
    }

    const [updated] = await this.repo.updateRegulation(id, data);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_REGULATION',
      entityType: 'REGULATION',
      entityId: id,
      description: `Updated regulation "${updated.name}"`,
      oldValues: existing,
      newValues: updated,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async deleteRegulation(id: string, actor?: AuditActor) {
    const existing = await this.repo.getRegulationById(id);
    if (!existing) throw new Error('Regulation not found');

    const refs = await this.repo.getRegulationReferenceCounts(id);
    const issues: string[] = [];
    if (refs.classesCount > 0) issues.push(`${refs.classesCount} class(es)`);
    if (refs.subjectsCount > 0) issues.push(`${refs.subjectsCount} subject(s)`);

    if (issues.length > 0) {
      throw new Error(`Cannot delete regulation: ${issues.join(', ')} are associated with it.`);
    }

    const [deleted] = await this.repo.deleteRegulation(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'DELETE_REGULATION',
      entityType: 'REGULATION',
      entityId: id,
      description: `Deleted regulation "${existing.name}"`,
      oldValues: existing,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return deleted;
  }

  // --- Classes ---
  async getClasses() {
    return this.repo.getClasses();
  }

  async getClassById(id: string) {
    return this.repo.getClassById(id);
  }

  async createClass(data: typeof classes.$inferInsert, actor?: AuditActor) {
    if (data.yearNumber === undefined || data.yearNumber < 1 || data.yearNumber > 4) {
      throw new Error('Year number must be between 1 and 4.');
    }

    if (!data.section || data.section.trim() === '') {
      throw new Error('Section cannot be empty.');
    }

    if (!data.academicYearId) {
      throw new Error('Academic year is required.');
    }

    if (!data.batchId) {
      throw new Error('Batch is required.');
    }

    if (!data.regulationId) {
      throw new Error('Regulation is required.');
    }

    const departmentId = await this.getDefaultDepartmentId(data.departmentId);
    await this.validateClassReferences(departmentId, data.academicYearId, data.batchId, data.regulationId);
    const section = data.section.trim().toUpperCase();

    // Auto-generate name if not provided
    let className = data.name ? data.name.trim() : '';
    if (!className) {
      const dept = await this.repo.getDepartmentById(departmentId);
      const roman = ['I', 'II', 'III', 'IV'][data.yearNumber - 1] || `${data.yearNumber}`;
      className = `${roman} ${dept?.code || 'IT'}-${section}`;
    }

    const existing = await this.repo.getClassByUniqueConstraint(
      departmentId,
      data.academicYearId,
      data.yearNumber,
      section
    );

    if (existing) {
      throw new Error('Class with this department, academic year, year number, and section already exists.');
    }

    const [created] = await this.repo.createClass({
      ...data,
      name: className,
      departmentId,
      section,
    });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'CREATE_CLASS',
      entityType: 'CLASS',
      entityId: created.id,
      description: `Created class "${created.name}"`,
      newValues: created,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return created;
  }

  async updateClass(id: string, data: Partial<typeof classes.$inferInsert>, actor?: AuditActor) {
    const existingCls = await this.repo.getClassById(id);
    if (!existingCls) throw new Error('Class not found');

    const yearNumber = data.yearNumber !== undefined ? data.yearNumber : existingCls.yearNumber;
    const section = data.section !== undefined ? data.section.trim().toUpperCase() : existingCls.section;
    const deptId = data.departmentId || existingCls.departmentId;
    const acYearId = data.academicYearId || existingCls.academicYearId;
    const batchId = data.batchId || existingCls.batchId;
    const regulationId = data.regulationId || existingCls.regulationId;

    if (yearNumber < 1 || yearNumber > 4) {
      throw new Error('Year number must be between 1 and 4.');
    }

    if (!section) {
      throw new Error('Section cannot be empty.');
    }
    const isChangingReferences = Boolean(data.departmentId || data.academicYearId || data.batchId || data.regulationId);
    if (isChangingReferences) {
      await this.validateClassReferences(deptId, acYearId, batchId, regulationId);
    }

    if (data.yearNumber !== undefined || data.section !== undefined || data.departmentId || data.academicYearId) {
      const existing = await this.repo.getClassByUniqueConstraint(deptId, acYearId, yearNumber, section);
      if (existing && existing.id !== id) {
        throw new Error('Class with this department, academic year, year number, and section already exists.');
      }
    }

    const [updated] = await this.repo.updateClass(id, {
      ...data,
      section,
      yearNumber,
    });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_CLASS',
      entityType: 'CLASS',
      entityId: id,
      description: `Updated class "${updated.name}"`,
      oldValues: existingCls,
      newValues: updated,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  private async validateClassReferences(
    departmentId: string,
    academicYearId: string,
    batchId: string,
    regulationId: string,
  ) {
    const [department, academicYear, batch, regulation] = await Promise.all([
      this.repo.getDepartmentById(departmentId),
      this.repo.getAcademicYearById(academicYearId),
      this.repo.getBatchById(batchId),
      this.repo.getRegulationById(regulationId),
    ]);
    if (!department || department.status !== 'ACTIVE') throw new Error('Active department not found.');
    if (!academicYear || academicYear.status !== 'ACTIVE') throw new Error('Active academic year not found.');
    if (!batch || batch.status !== 'ACTIVE') throw new Error('Active admission batch not found.');
    if (batch.departmentId !== departmentId) throw new Error('Batch must belong to the selected department.');
    if (!regulation || regulation.status !== 'ACTIVE') throw new Error('Active regulation not found.');
  }

  async deleteClass(id: string, actor?: AuditActor) {
    const existing = await this.repo.getClassById(id);
    if (!existing) throw new Error('Class not found');

    const refs = await this.repo.getClassReferenceCounts(id);
    const issues: string[] = [];
    if (refs.studentsCount > 0) issues.push(`${refs.studentsCount} student(s)`);
    if (refs.classSubjectsCount > 0) issues.push(`${refs.classSubjectsCount} subject assignment(s)`);
    if (refs.timetablesCount > 0) issues.push(`${refs.timetablesCount} timetable schedule(s)`);
    if (refs.counselorsCount > 0) issues.push(`${refs.counselorsCount} counselor assignment(s)`);

    if (issues.length > 0) {
      throw new Error(`Cannot delete class: ${issues.join(', ')} are associated with it.`);
    }

    const [deleted] = await this.repo.deleteClass(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'DELETE_CLASS',
      entityType: 'CLASS',
      entityId: id,
      description: `Deleted class "${existing.name}"`,
      oldValues: existing,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return deleted;
  }
}

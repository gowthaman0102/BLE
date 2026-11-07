import { StudentRepository } from '../repositories/student.repository';
import { students } from '../db/schema/students';
import { Buffer } from 'buffer';
import { AuditService } from './audit.service';
import { parseTabularImport, TabularImportError } from './tabular-import';

export interface AuditActor {
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class StudentService {
  private repo: StudentRepository;
  private audit: AuditService;
  private allowedDomains: string[];

  constructor() {
    this.repo = new StudentRepository();
    this.audit = new AuditService();
    const envDomain = process.env.COLLEGE_EMAIL_DOMAIN || 'sonatech.ac.in';
    this.allowedDomains = envDomain.toLowerCase().split(',').map(d => d.trim().replace(/^@/, ''));
  }

  private validateEmail(email: string): string {
    const clean = email.trim().toLowerCase();
    if (!clean) {
      throw new Error('College email is required.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      throw new Error('Invalid email format.');
    }
    const matchesDomain = this.allowedDomains.some(d => clean.endsWith(`@${d}`));
    if (!matchesDomain) {
      throw new Error(`College email must belong to '@${this.allowedDomains[0]}'.`);
    }
    return clean;
  }

  private validateRegisterNumber(regNo: string): string {
    const clean = regNo.trim().toUpperCase();
    if (!clean) {
      throw new Error('Register number is required.');
    }
    if (!/^[A-Z0-9]{5,20}$/.test(clean)) {
      throw new Error('Register number must be 5 to 20 alphanumeric characters.');
    }
    return clean;
  }

  private validateName(name: string): string {
    const clean = name.trim();
    if (!clean || clean.length < 2) {
      throw new Error('Student name must be at least 2 characters long.');
    }
    return clean;
  }

  async getStudents(filters: any) {
    return this.repo.getStudents(filters);
  }

  async getStudentById(id: string) {
    return this.repo.getStudentById(id);
  }

  async createStudent(data: typeof students.$inferInsert, actor?: AuditActor) {
    const registerNumber = this.validateRegisterNumber(data.registerNumber);
    const collegeEmail = this.validateEmail(data.collegeEmail);
    const name = this.validateName(data.name);

    if (!data.classId) {
      throw new Error('Class assignment is required.');
    }

    const assignedClass = await this.repo.getClassById(data.classId);
    if (!assignedClass || assignedClass.status !== 'ACTIVE') {
      throw new Error('Assigned class is not active or does not exist.');
    }

    const existingReg = await this.repo.getStudentByRegisterNumber(registerNumber);
    if (existingReg) {
      throw new Error('Student with this register number already exists.');
    }

    const existingEmail = await this.repo.getStudentByEmail(collegeEmail);
    if (existingEmail) {
      throw new Error('Student with this college email already exists.');
    }

    const [created] = await this.repo.createStudent({
      ...data,
      registerNumber,
      collegeEmail,
      name,
    });
    
    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'CREATE_STUDENT',
      entityType: 'STUDENT',
      entityId: created.id,
      description: `Created student "${created.name}" (${created.registerNumber}) in class "${assignedClass.name}"`,
      newValues: created,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return created;
  }

  async updateStudent(id: string, data: Partial<typeof students.$inferInsert>, actor?: AuditActor) {
    const old = await this.repo.getStudentById(id);
    if (!old) {
      throw new Error('Student not found');
    }

    const updatePayload: Partial<typeof students.$inferInsert> = { ...data };

    if (data.registerNumber !== undefined) {
      const regNo = this.validateRegisterNumber(data.registerNumber);
      const existing = await this.repo.getStudentByRegisterNumber(regNo);
      if (existing && existing.id !== id) {
        throw new Error('Student with this register number already exists.');
      }
      updatePayload.registerNumber = regNo;
    }

    if (data.collegeEmail !== undefined) {
      const email = this.validateEmail(data.collegeEmail);
      const existing = await this.repo.getStudentByEmail(email);
      if (existing && existing.id !== id) {
        throw new Error('Student with this college email already exists.');
      }
      updatePayload.collegeEmail = email;
    }

    if (data.name !== undefined) {
      updatePayload.name = this.validateName(data.name);
    }

    if (data.classId !== undefined) {
      const cls = await this.repo.getClassById(data.classId);
      if (!cls || cls.status !== 'ACTIVE') throw new Error('Assigned class is not active or does not exist.');
    }

    const [updated] = await this.repo.updateStudent(id, updatePayload);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_STUDENT',
      entityType: 'STUDENT',
      entityId: id,
      description: `Updated student "${updated.name}" (${updated.registerNumber})`,
      oldValues: old,
      newValues: updated,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async updateStudentStatus(id: string, status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED', actor?: AuditActor) {
    const old = await this.repo.getStudentById(id);
    if (!old) {
      throw new Error('Student not found');
    }

    const validStatuses = ['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status '${status}'. Must be one of: ${validStatuses.join(', ')}.`);
    }

    const [updated] = await this.repo.updateStudent(id, { status });

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'UPDATE_STUDENT_STATUS',
      entityType: 'STUDENT',
      entityId: id,
      description: `Changed student "${old.name}" (${old.registerNumber}) status from ${old.status} to ${status}`,
      oldValues: { status: old.status },
      newValues: { status },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return updated;
  }

  async deleteStudent(id: string, actor?: AuditActor) {
    const old = await this.repo.getStudentById(id);
    if (!old) {
      throw new Error('Student not found');
    }

    const refs = await this.repo.getStudentReferenceCounts(id);
    if (refs.attendanceRecordsCount > 0) {
      throw new Error(
        `Cannot delete student: ${refs.attendanceRecordsCount} attendance record(s) are associated with this student. Deactivate student status instead.`
      );
    }

    const [deleted] = await this.repo.deleteStudent(id);

    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'DELETE_STUDENT',
      entityType: 'STUDENT',
      entityId: id,
      description: `Deleted student "${old.name}" (${old.registerNumber})`,
      oldValues: old,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return deleted;
  }

  // --- Bulk Import Logic ---

  private async readImportRows(fileBuffer: Buffer, fileName: string) {
    return parseTabularImport(fileBuffer, fileName, {
      register_number: 'register_number',
      reg_no: 'register_number',
      student_name: 'name',
      name: 'name',
      college_email: 'college_email',
      email: 'college_email',
      class: 'class_ref',
      class_name: 'class_ref',
      class_id: 'class_ref',
    }, ['register_number', 'name', 'college_email', 'class_ref']);
  }

  async validateImportFile(fileBuffer: Buffer, fileName: string, _fileType: string) {
    const rows = await this.readImportRows(fileBuffer, fileName);
    const allClasses = (await this.repo.getAllClasses()).filter((classRow) => classRow.status === 'ACTIVE');
    const classesByName = new Map<string, typeof allClasses>();
    const classesById = new Map(allClasses.map((classRow) => [classRow.id, classRow]));
    for (const classRow of allClasses) {
      const key = classRow.name.trim().toLowerCase();
      classesByName.set(key, [...(classesByName.get(key) || []), classRow]);
    }

    const registerCounts = new Map<string, number>();
    const emailCounts = new Map<string, number>();
    for (const row of rows) {
      const registerNumber = row.register_number.toUpperCase();
      const email = row.college_email.toLowerCase();
      if (registerNumber) registerCounts.set(registerNumber, (registerCounts.get(registerNumber) || 0) + 1);
      if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    }

    const data = await Promise.all(rows.map(async (row, index) => {
      const registerNumber = row.register_number.toUpperCase();
      const name = row.name.trim();
      const collegeEmail = row.college_email.toLowerCase();
      const classRef = row.class_ref.trim();
      const errors: { code: string; message: string }[] = [];
      if (!registerNumber) errors.push({ code: 'MISSING_REGISTER_NUMBER', message: 'Register number is required.' });
      else if (!/^[A-Z0-9]{5,20}$/.test(registerNumber)) errors.push({ code: 'INVALID_REGISTER_NUMBER', message: 'Register number must be 5-20 alphanumeric characters.' });
      if (!name || name.length < 2 || name.length > 255) errors.push({ code: 'INVALID_NAME', message: 'Student name must be 2-255 characters.' });
      if (!collegeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(collegeEmail)) {
        errors.push({ code: 'INVALID_EMAIL', message: 'Enter a valid college email address.' });
      } else if (!this.allowedDomains.some((domain) => collegeEmail.endsWith(`@${domain}`))) {
        errors.push({ code: 'INVALID_DOMAIN', message: `College email must belong to one of: ${this.allowedDomains.join(', ')}.` });
      }
      if (!classRef) errors.push({ code: 'MISSING_CLASS', message: 'Class ID or exact class name is required.' });

      if (registerNumber && (registerCounts.get(registerNumber) || 0) > 1) {
        errors.push({ code: 'DUPLICATE_REGISTER_NUMBER', message: 'Register number is duplicated in the uploaded file.' });
      }
      if (collegeEmail && (emailCounts.get(collegeEmail) || 0) > 1) {
        errors.push({ code: 'DUPLICATE_EMAIL', message: 'Email is duplicated in the uploaded file.' });
      }

      const match = classesById.get(classRef) ||
        (classesByName.get(classRef.toLowerCase())?.length === 1 ? classesByName.get(classRef.toLowerCase())?.[0] : undefined);
      if (classRef && !match) {
        const matches = classesByName.get(classRef.toLowerCase());
        errors.push({
          code: matches?.length ? 'AMBIGUOUS_CLASS' : 'CLASS_NOT_FOUND',
          message: matches?.length ? 'Class name is ambiguous; use the exact class ID.' : 'Class does not exist or is inactive.',
        });
      }

      if (registerNumber) {
        const existing = await this.repo.getStudentByRegisterNumber(registerNumber);
        if (existing) errors.push({ code: 'REGISTER_NUMBER_EXISTS', message: 'Register number already exists in the database.' });
      }
      if (collegeEmail) {
        const existing = await this.repo.getStudentByEmail(collegeEmail);
        if (existing) errors.push({ code: 'EMAIL_EXISTS', message: 'Email already exists in the database.' });
      }

      return {
        rowNumber: index + 2,
        registerNumber,
        name,
        collegeEmail,
        className: match?.name || classRef,
        classId: match?.id || null,
        isValid: errors.length === 0,
        errors,
      };
    }));
    const valid = data.filter((row) => row.isValid).length;
    return { totalRows: data.length, valid, errors: data.length - valid, data };
  }

  async confirmImport(fileBuffer: Buffer, fileName: string, fileType: string, actor?: AuditActor) {
    const preview = await this.validateImportFile(fileBuffer, fileName, fileType);
    const candidates = preview.data.filter((row) => row.isValid && row.classId);
    const createdRows = await this.repo.bulkCreateStudentsWithConflicts(candidates.map((row) => ({
      registerNumber: row.registerNumber,
      name: row.name,
      collegeEmail: row.collegeEmail,
      classId: row.classId!,
      status: 'ACTIVE' as const,
    })));
    const createdIndexes = new Set(createdRows.map((row) => row.index));
    const results = preview.data.map((row) => {
      const candidateIndex = candidates.indexOf(row);
      if (candidateIndex >= 0 && createdIndexes.has(candidateIndex)) {
        return { rowNumber: row.rowNumber, status: 'created' as const, errors: [] };
      }
      const errors = row.errors.length
        ? row.errors
        : [{ code: 'DUPLICATE_CONFLICT', message: 'A record with this register number or email was created concurrently; nothing was overwritten.' }];
      return { rowNumber: row.rowNumber, status: 'skipped' as const, errors };
    });
    const created = createdRows.length;
    const skipped = results.length - created;
    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'BULK_IMPORT_STUDENTS',
      entityType: 'STUDENT',
      description: `Student import finished: ${created} created, ${skipped} skipped.`,
      newValues: { total: results.length, created, skipped },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return { total: results.length, created, skipped, failed: 0, rows: results };
  }

  async confirmImportData(rows: any[], actor?: AuditActor) {
    const hasErrors = rows.some((row) => row.isValid === false || (Array.isArray(row.errors) && row.errors.length > 0));
    if (hasErrors) {
      throw new TabularImportError('Cannot import file with errors. Please fix all errors before confirming.');
    }
    const candidates = rows.filter((r) => r.isValid && r.classId);
    const createdRows = await this.repo.bulkCreateStudentsWithConflicts(candidates.map((row) => ({
      registerNumber: row.registerNumber.toUpperCase(),
      name: row.name.trim(),
      collegeEmail: row.collegeEmail.toLowerCase(),
      classId: row.classId,
      status: 'ACTIVE' as const,
    })));
    const created = createdRows.length;
    const skipped = rows.length - created;
    await this.audit.log({
      actorId: actor?.actorId,
      actorName: actor?.actorName,
      actorRole: actor?.actorRole,
      action: 'BULK_IMPORT_STUDENTS',
      entityType: 'STUDENT',
      description: `Student import finished: ${created} created, ${skipped} skipped.`,
      newValues: { total: rows.length, created, skipped },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return { total: rows.length, created, skipped, failed: 0, rows: createdRows };
  }
}

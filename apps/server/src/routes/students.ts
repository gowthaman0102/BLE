import { Hono } from "hono";
import { StudentService } from "../services/student.service";
import { AttendanceSessionService } from "../services/attendance-session.service";
import { requireHodOrAdmin, requireSharedDashboardRead, requireStudentAuth, requireStaffOrAdmin, requireRole } from "../middlewares/auth.middleware";
import { BleAttendanceService } from "../services/ble-attendance.service";
import { BleTokenService } from "../services/ble-token.service";
import { StudentBleDeviceRepository } from '../repositories/student-ble-device.repository';
import { TimetableService } from "../services/timetable.service";
import { AttendanceRecordService } from "../services/attendance-record.service";
import { FaceVerificationService } from "../services/face-verification.service";
import { AttendanceFallbackService } from "../services/attendance-fallback.service";
import type { students } from '../db/schema/students';
import { TabularImportError } from '../services/tabular-import';
import { ImageValidationError } from '../services/image-validation.service';
import { getDateInTimeZone } from '../utils/date';
import * as xlsx from 'xlsx';

export const studentRoutes = new Hono<{ Variables: { student: any } }>();
const service = new StudentService();
const attendanceService = new AttendanceSessionService();
const bleTokenService = new BleTokenService();
const bleAttendanceService = new BleAttendanceService();
const deviceRepo = new StudentBleDeviceRepository();
const timetableService = new TimetableService();
const recordService = new AttendanceRecordService();
let faceVerificationService = new FaceVerificationService();
export function setFaceVerificationService(service: FaceVerificationService) {
  faceVerificationService = service;
}
const fallbackService = new AttendanceFallbackService();

function handleStudentError(c: any, error: any) {
  const msg = error?.message || 'An unexpected error occurred.';
  if (error instanceof TabularImportError) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
  }
  if (error instanceof ImageValidationError) {
    return c.json({ success: false, error: { code: error.code, message: error.message } }, 400);
  }
  if (msg === 'DEPARTMENT_MISMATCH') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to manage students outside your department.' } }, 403);
  }
  if (msg === 'REFERENCE_PHOTO_NOT_FOUND') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Reference photo not found for this student.' } }, 404);
  }
  if (msg === 'REFERENCE_PHOTO_FILE_MISSING') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Reference photo file is missing on storage.' } }, 404);
  }
  if (msg === 'CHALLENGE_NOT_FOUND') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Liveness challenge not found.' } }, 404);
  }
  if (msg === 'CHALLENGE_STUDENT_MISMATCH') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Liveness challenge does not belong to you.' } }, 403);
  }
  if (msg === 'CHALLENGE_ALREADY_USED') {
    return c.json({ success: false, error: { code: 'CONFLICT', message: 'Liveness challenge has already been consumed. Please request a new challenge.' } }, 409);
  }
  if (msg === 'FALLBACK_REQUEST_ALREADY_PENDING') {
    return c.json({ success: false, error: { code: 'CONFLICT', message: 'A fallback request is already pending for this session.' } }, 409);
  }
  if (msg === 'INVALID_FALLBACK_REASON_CATEGORY') {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid fallback reason category.' } }, 400);
  }
  if (msg === 'EXPLANATION_TOO_LONG') {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Explanation must not exceed 500 characters.' } }, 400);
  }
  if (msg === 'CHALLENGE_EXPIRED') {
    return c.json({ success: false, error: { code: 'GONE', message: 'Liveness challenge has expired. Please request a new challenge.' } }, 410);
  }
  if (msg === 'STUDENT_NOT_FOUND') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found.' } }, 404);
  }
  if (msg === 'FORBIDDEN') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to perform this operation.' } }, 403);
  }
  if (error?.code === '23505') {
    return c.json({ success: false, error: { code: 'CONFLICT', message: 'A student with this register number or email already exists.' } }, 409);
  }
  if (error?.code === '23503') {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'The selected class is no longer available.' } }, 400);
  }
  if (
    msg.includes('already exists') ||
    msg.includes('Cannot delete') ||
    msg.includes('associated with this student')
  ) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: msg } }, 409);
  }
  if (msg.includes('not found') || msg.includes('Not found') || msg === 'SESSION_NOT_FOUND') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
  }
  if (msg === 'STUDENT_WRONG_CLASS') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not enrolled in the class for this session.' } }, 403);
  }
  if (
    msg === 'SESSION_NOT_ACTIVE' ||
    msg === 'SESSION_CANCELLED' ||
    msg === 'STUDENT_NOT_ENROLLED' ||
    msg === 'BLE_ELIGIBILITY_REQUIRED' ||
    msg === 'MAX_ATTEMPTS_EXCEEDED' ||
    msg === 'STUDENT_INACTIVE'
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
  }
  if (
    msg.includes('required') ||
    msg.includes('must belong to') ||
    msg.includes('Invalid') ||
    msg.includes('characters') ||
    msg.includes('Unsupported') ||
    msg.includes('empty') ||
    msg.includes('active or does not exist') ||
    msg.includes('errors') ||
    msg.includes('Cannot import') ||
    msg.includes('No data provided')
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
  }
  return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to complete the student request. Please retry.' } }, 500);
}

function getActor(c: any) {
  const user = c.get('user');
  return {
    actorId: user?.roles?.includes('FACULTY') ? undefined : user?.id,
    actorName: user?.name,
    actorRole: user?.roles?.[0],
    departmentId: user?.departmentId,
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: c.req.header('user-agent'),
  };
}

async function getImportFile(c: any): Promise<{ file: File; buffer: Buffer } | Response> {
  const contentLength = Number(c.req.header('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024 + 64 * 1024) {
    return c.json({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'Import files are limited to 5 MB.' } }, 413);
  }
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Choose a CSV or XLSX file.' } }, 400);
  }
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'Import files are limited to 5 MB.' } }, 413);
  }
  const extension = file.name.toLowerCase().split('.').pop();
  const allowedTypes = extension === 'csv'
    ? ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream', '']
    : extension === 'xlsx'
      ? ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', '']
      : [];
  if (!allowedTypes.includes(file.type.toLowerCase())) {
    return c.json({ success: false, error: { code: 'UNSUPPORTED_FILE', message: 'Upload a valid .csv or .xlsx file.' } }, 400);
  }
  return { file, buffer: Buffer.from(await file.arrayBuffer()) };
}

studentRoutes.get('/import/template', requireSharedDashboardRead, (c) => {
  const format = c.req.query('format')?.toLowerCase();
  if (format === 'xlsx') {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ['register_number', 'name', 'college_email', 'class_id'],
      ['21IT001', 'Sample Student', 'student@sonatech.ac.in', 'II IT-A']
    ]);
    xlsx.utils.book_append_sheet(wb, ws, 'Students Template');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
    return c.body(buf);
  }
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="student-import-template.csv"');
  return c.body('register_number,name,college_email,class_id\r\n21IT001,Sample Student,student@sonatech.ac.in,II IT-A\r\n');
});

studentRoutes.get('/template/xlsx', requireSharedDashboardRead, (c) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet([
    ['register_number', 'name', 'college_email', 'class_id'],
    ['21IT001', 'Sample Student', 'student@sonatech.ac.in', 'II IT-A']
  ]);
  xlsx.utils.book_append_sheet(wb, ws, 'Students Template');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
  return c.body(buf);
});

studentRoutes.get('/template/csv', requireSharedDashboardRead, (c) => {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="student-import-template.csv"');
  return c.body('register_number,name,college_email,class_id\r\n21IT001,Sample Student,student@sonatech.ac.in,II IT-A\r\n');
});

const handleValidateFile = async (c: any) => {
  try {
    const upload = await getImportFile(c);
    if (upload instanceof Response) return upload;
    const data = await service.validateImportFile(upload.buffer, upload.file.name, upload.file.type);
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStudentError(c, error);
  }
};

studentRoutes.post('/import/preview', requireHodOrAdmin, handleValidateFile);
studentRoutes.post('/import/validate', requireHodOrAdmin, handleValidateFile);

studentRoutes.post('/import/confirm', requireHodOrAdmin, async (c) => {
  try {
    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await c.req.json();
      if (Array.isArray(body.importData)) {
        const data = await service.confirmImportData(body.importData, getActor(c));
        return c.json({ success: true, data });
      }
    }
    const upload = await getImportFile(c);
    if (upload instanceof Response) return upload;
    const data = await service.confirmImport(upload.buffer, upload.file.name, upload.file.type, getActor(c));
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStudentError(c, error);
  }
});

studentRoutes.post('/', requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    if (
      typeof body.registerNumber !== 'string' ||
      typeof body.name !== 'string' ||
      typeof body.collegeEmail !== 'string' ||
      typeof body.classId !== 'string'
    ) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Register number, name, college email, and class are required.' } }, 400);
    }
    const student = await service.createStudent({
      registerNumber: body.registerNumber,
      name: body.name,
      collegeEmail: body.collegeEmail,
      classId: body.classId,
      status: 'ACTIVE',
    }, getActor(c));
    return c.json({ success: true, data: student }, 201);
  } catch (error: unknown) {
    return handleStudentError(c, error);
  }
});

const handleStudentUpdate = async (c: any) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const update: Partial<typeof students.$inferInsert> = {};
    for (const field of ['registerNumber', 'name', 'collegeEmail', 'classId'] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string') {
          return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: `${field} must be a string.` } }, 400);
        }
        update[field] = body[field];
      }
    }
    if (!Object.keys(update).length) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Provide at least one permitted field to update.' } }, 400);
    }
    const data = await service.updateStudent(c.req.param('id')!, update, getActor(c));
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStudentError(c, error);
  }
};

studentRoutes.put('/:id', requireHodOrAdmin, handleStudentUpdate);
studentRoutes.patch('/:id', requireHodOrAdmin, handleStudentUpdate);

studentRoutes.patch('/:id/status', requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json() as { status?: string };
    if (!['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED'].includes(body.status || '')) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Choose a supported student status.' } }, 400);
    }
    const data = await service.updateStudentStatus(
      c.req.param('id')!,
      body.status as 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED',
      getActor(c),
    );
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStudentError(c, error);
  }
});

studentRoutes.delete('/:id', requireHodOrAdmin, async (c) => {
  try {
    await service.deleteStudent(c.req.param('id')!, getActor(c));
    return c.json({ success: true, message: 'Student deleted successfully.' });
  } catch (error: unknown) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/", requireStaffOrAdmin, async (c) => {
  try {
    const search = c.req.query("search");
    const classId = c.req.query("classId");
    const departmentId = c.req.query("departmentId");
    const batchId = c.req.query("batchId");
    const status = c.req.query("status");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "20", 10);

    const data = await service.getStudents({ search, classId, departmentId, batchId, status, page, limit });
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/:id", requireStaffOrAdmin, async (c) => {
  try {
    const data = await service.getStudentById(c.req.param("id")!);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Student not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// --- Mobile Student Attendance & Timetable Endpoints ---

studentRoutes.get("/me/timetable", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    let classId = student?.classId;

    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }

    if (!classId) {
      return c.json({ success: true, data: [] });
    }

    const timetable = await timetableService.getTimetableByClass(classId);
    return c.json({ success: true, data: timetable });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/me/attendance/summary", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    let classId = student?.classId;

    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }

    if (!classId || !student?.id) {
      return c.json({
        success: true,
        data: {
          overall: { percentage: null, attendedSessions: 0, totalSessions: 0, hasData: false },
          today: { status: 'NO_SESSION' },
        },
      });
    }

    const summary = await recordService.getStudentSummary(student.id, classId);
    return c.json({ success: true, data: summary });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/me/attendance/history", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    let classId = student?.classId;

    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }

    if (!student?.id) {
      return c.json({ success: true, data: [] });
    }

    const history = await recordService.getStudentHistory(student.id, classId);
    return c.json({ success: true, data: history });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/me/attendance/current", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    
    let classId = student?.classId;
    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }
    if (!classId) {
      return c.json({ success: true, session: null });
    }

    const today = getDateInTimeZone();
    
    const activeSessions = await attendanceService.getSessions({
      classId: classId,
      date: today,
      status: 'ACTIVE'
    });

    if (activeSessions && activeSessions.length > 0) {
      const session = activeSessions[0];
      const record = student?.id ? await recordService.getStudentRecordForSession(session.id, student.id) : null;
      return c.json({
        success: true,
        session,
        record: record ? {
          id: record.id,
          status: record.status,
          markedAt: record.markedAt,
          source: record.source,
        } : null,
      });
    }

    return c.json({ success: true, session: null });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/me/attendance/ble-token", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    
    let classId = student?.classId;
    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }
    if (!classId) {
      return c.json({ success: true, token: null });
    }

    const today = getDateInTimeZone();
    
    const activeSessions = await attendanceService.getSessions({
      classId: classId,
      date: today,
      status: 'ACTIVE'
    });

    if (!activeSessions || activeSessions.length === 0) {
      return c.json({ success: true, token: null });
    }

    const activeSession = activeSessions[0];
    const plainToken = await bleTokenService.upsertTokenForStudent(activeSession.id, student.id);
    
    return c.json({ success: true, token: plainToken });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/me/attendance/status", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    let classId = student?.classId;
    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }
    if (!classId || !student?.id) {
      return c.json({ success: true, active: false, session: null, isMarked: false, record: null });
    }

    const today = getDateInTimeZone();
    const activeSessions = await attendanceService.getSessions({
      classId: classId,
      date: today,
      status: 'ACTIVE'
    });

    if (!activeSessions || activeSessions.length === 0) {
      return c.json({ success: true, active: false, session: null, isMarked: false, record: null });
    }

    const session = activeSessions[0];
    const record = await recordService.getStudentRecordForSession(session.id, student.id);

    return c.json({
      success: true,
      active: true,
      session,
      isMarked: !!record,
      record: record ? {
        id: record.id,
        status: record.status,
        markedAt: record.markedAt,
        source: record.source,
      } : null,
    });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.post("/me/attendance/simulate-detection", requireStudentAuth, async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ success: false, error: { message: "Simulation disabled in production" } }, 403);
  }
  try {
    const student = c.get('student');
    let classId = student?.classId;
    if (!classId && student?.id) {
      const profile = await service.getStudentById(student.id);
      classId = profile?.classId;
    }
    if (!classId || !student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    const today = getDateInTimeZone();
    const activeSessions = await attendanceService.getSessions({
      classId: classId,
      date: today,
      status: 'ACTIVE'
    });

    if (!activeSessions || activeSessions.length === 0) {
      return c.json({ success: false, error: { message: "No active session found to simulate detection" } }, 400);
    }

    const activeSession = activeSessions[0];
    const token = await bleTokenService.upsertTokenForStudent(activeSession.id, student.id);
    const result = await bleAttendanceService.processDetections(activeSession.id, [
      { token, rssi: -55, detectedAt: new Date().toISOString() }
    ]);
    const record = await recordService.getStudentRecordForSession(activeSession.id, student.id);

    return c.json({
      success: true,
      data: {
        result,
        record: record ? {
          id: record.id,
          status: record.status,
          markedAt: record.markedAt,
          source: record.source,
        } : null
      }
    });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// --- Face Verification Endpoints (Milestone F2) ---

studentRoutes.get("/me/attendance/face-verification/status", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    if (!student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    let sessionId = c.req.query('sessionId');
    if (!sessionId) {
      // Resolve active session for student's class
      let classId = student?.classId;
      if (!classId) {
        const profile = await service.getStudentById(student.id);
        classId = profile?.classId;
      }
      if (classId) {
        const today = getDateInTimeZone();
        const activeSessions = await attendanceService.getSessions({
          classId,
          date: today,
          status: 'ACTIVE'
        });
        if (activeSessions && activeSessions.length > 0) {
          sessionId = activeSessions[0].id;
        }
      }
    }

    if (!sessionId) {
      return c.json({
        success: true,
        data: {
          sessionId: '',
          bleDetected: false,
          profileStatus: 'NOT_ENROLLED',
          verificationStatus: 'PENDING',
          attemptCount: 0,
          remainingAttempts: 3,
          isEligibleForVerification: false,
          verifiedAt: null,
        }
      });
    }

    const status = await faceVerificationService.getVerificationStatus(sessionId, student.id);
    return c.json({ success: true, data: status });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.post("/me/attendance/face-verification/verify", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    if (!student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    // Check Content-Length header against max size (5 MB + multipart overhead)
    const contentLength = Number(c.req.header('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024 + 64 * 1024) {
      return c.json({
        success: false,
        error: {
          code: 'IMAGE_TOO_LARGE',
          message: 'Selfie image file exceeds 5 MB limit.',
        },
      }, 413);
    }

    const contentType = c.req.header('content-type') || '';
    let sessionId: string | undefined;
    let selfieBuffer: Buffer | undefined;
    let selfieBase64: string | undefined;
    let clientMetadata: any = undefined;

    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
      const file = body.selfie || body.file || body.photo;
      if (file instanceof File) {
        if (file.size > 5 * 1024 * 1024) {
          return c.json({
            success: false,
            error: {
              code: 'IMAGE_TOO_LARGE',
              message: 'Selfie image file exceeds 5 MB limit.',
            },
          }, 413);
        }
        selfieBuffer = Buffer.from(await file.arrayBuffer());
      }
      if (typeof body.clientMetadata === 'string') {
        try {
          clientMetadata = JSON.parse(body.clientMetadata);
        } catch {
          // ignore parsing error
        }
      }
    } else {
      const body = await c.req.json();
      sessionId = body.sessionId;
      selfieBase64 = body.selfieBase64;
      clientMetadata = body.clientMetadata;
    }

    if (!sessionId) {
      return c.json({ success: false, error: { message: "sessionId is required" } }, 400);
    }

    const result = await faceVerificationService.verifyStudentFace({
      sessionId,
      studentId: student.id,
      selfieBuffer,
      selfieBase64,
      clientMetadata,
      actor: getActor(c),
    });

    return c.json({ success: result.success, data: result });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// --- Milestone F6: Liveness Challenge & Verification Endpoints ---

studentRoutes.post("/me/attendance/face-verification/liveness/challenge", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    if (!student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    let sessionId = c.req.query('sessionId');
    if (!sessionId) {
      try {
        const body = await c.req.json();
        sessionId = body?.sessionId;
      } catch {
        // Body might be empty
      }
    }

    if (!sessionId) {
      return c.json({ success: false, error: { message: "sessionId is required" } }, 400);
    }

    const challenge = await faceVerificationService.getChallengeService().createChallenge(student.id, sessionId);
    return c.json({ success: true, data: challenge });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.post("/me/attendance/face-verification/liveness/verify", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    if (!student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    const contentLength = Number(c.req.header('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024 + 128 * 1024) {
      return c.json({
        success: false,
        error: {
          code: 'IMAGE_TOO_LARGE',
          message: 'Uploaded liveness payload exceeds 10 MB limit.',
        },
      }, 413);
    }

    const contentType = c.req.header('content-type') || '';
    let sessionId: string | undefined;
    let challengeId: string | undefined;
    let baseBuffer: Buffer | undefined;
    let baseBase64: string | undefined;
    let actionBuffer: Buffer | undefined;
    let actionBase64: string | undefined;
    let clientMetadata: any = undefined;

    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
      challengeId = typeof body.challengeId === 'string' ? body.challengeId : undefined;

      const baseFile = body.baseSelfie || body.baseFile || body.basePhoto;
      if (baseFile instanceof File) {
        if (baseFile.size > 5 * 1024 * 1024) {
          return c.json({ success: false, error: { code: 'IMAGE_TOO_LARGE', message: 'Base selfie image exceeds 5 MB limit.' } }, 413);
        }
        baseBuffer = Buffer.from(await baseFile.arrayBuffer());
      } else if (typeof body.baseBase64 === 'string') {
        baseBase64 = body.baseBase64;
      }

      const actionFile = body.actionSelfie || body.actionFile || body.actionPhoto;
      if (actionFile instanceof File) {
        if (actionFile.size > 5 * 1024 * 1024) {
          return c.json({ success: false, error: { code: 'IMAGE_TOO_LARGE', message: 'Action selfie image exceeds 5 MB limit.' } }, 413);
        }
        actionBuffer = Buffer.from(await actionFile.arrayBuffer());
      } else if (typeof body.actionBase64 === 'string') {
        actionBase64 = body.actionBase64;
      }

      if (typeof body.clientMetadata === 'string') {
        try {
          clientMetadata = JSON.parse(body.clientMetadata);
        } catch {}
      }
    } else {
      const body = await c.req.json();
      sessionId = body.sessionId;
      challengeId = body.challengeId;
      baseBase64 = body.baseBase64 || body.baseSelfie;
      actionBase64 = body.actionBase64 || body.actionSelfie;
      clientMetadata = body.clientMetadata;
    }

    if (!sessionId) {
      return c.json({ success: false, error: { message: "sessionId is required" } }, 400);
    }
    if (!challengeId) {
      return c.json({ success: false, error: { message: "challengeId is required" } }, 400);
    }

    const result = await faceVerificationService.verifyStudentLivenessAndIdentity({
      sessionId,
      studentId: student.id,
      challengeId,
      baseBuffer,
      baseBase64,
      actionBuffer,
      actionBase64,
      clientMetadata,
      actor: getActor(c),
    });

    return c.json({ success: result.success, data: result });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// Admin / HOD or Student self-inspection: GET /:id/face-profile
studentRoutes.get("/:id/face-profile", async (c) => {
  try {
    const { id } = c.req.param();
    const user = c.get('user');

    // Access control: only the student themselves, or Admin/HOD staff
    const isSelf = user?.id === id && user?.userType === 'STUDENT';
    const isHodOrAdmin = user?.roles?.some((r: string) => ['ADMIN', 'HOD', 'DEPUTY_HOD'].includes(r));

    if (!isSelf && !isHodOrAdmin) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to view this face profile.' } }, 403);
    }

    const profile = await faceVerificationService.getStudentFaceProfile(id);
    return c.json({ success: true, data: profile });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// Admin / HOD status update: PATCH /:id/face-profile/status
studentRoutes.patch("/:id/face-profile/status", requireHodOrAdmin, async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const validStatuses = ['NOT_ENROLLED', 'PENDING', 'ACTIVE', 'REVOKED'];

    if (!body.status || !validStatuses.includes(body.status)) {
      return c.json({ success: false, error: { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` } }, 400);
    }

    const profile = await faceVerificationService.updateFaceProfileStatus(
      id,
      body.status,
      getActor(c),
      body.reason
    );

    return c.json({ success: true, data: profile });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// HOD / Admin reference photo upload: POST /:id/face-profile/reference-photo
studentRoutes.post("/:id/face-profile/reference-photo", requireHodOrAdmin, async (c) => {
  try {
    const { id } = c.req.param();

    // Check Content-Length header against max size (5 MB + multipart overhead)
    const contentLength = Number(c.req.header('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024 + 64 * 1024) {
      return c.json({
        success: false,
        error: {
          code: 'IMAGE_TOO_LARGE',
          message: 'Reference photo file exceeds 5 MB limit.',
        },
      }, 413);
    }

    const body = await c.req.parseBody();
    const file = body.photo || body.file;

    if (!(file instanceof File)) {
      return c.json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please select an image file (JPEG, PNG, or WebP) to upload.',
        },
      }, 400);
    }

    if (file.size > 5 * 1024 * 1024) {
      return c.json({
        success: false,
        error: {
          code: 'IMAGE_TOO_LARGE',
          message: 'Reference photo file exceeds 5 MB limit.',
        },
      }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const actor = getActor(c);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;

    const profile = await faceVerificationService.enrollReferencePhoto({
      studentId: id,
      buffer,
      originalFilename: file.name,
      actor,
      reason,
    });

    return c.json({
      success: true,
      data: profile,
      message: 'Reference photo enrolled successfully.',
    });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// Stream / retrieve reference photo: GET /:id/face-profile/reference-photo
studentRoutes.get("/:id/face-profile/reference-photo", async (c) => {
  try {
    const { id } = c.req.param();
    const user = c.get('user');

    if (!user) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    }

    const result = await faceVerificationService.getReferencePhoto(id, user);

    c.header('Content-Type', result.mimeType);
    c.header('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Disposition', 'inline; filename="reference-photo"');

    return c.body(new Uint8Array(result.buffer));
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// Revoke reference photo: DELETE /:id/face-profile/reference-photo
studentRoutes.delete("/:id/face-profile/reference-photo", requireHodOrAdmin, async (c) => {
  try {
    const { id } = c.req.param();
    let reason: string | undefined;

    try {
      const body = await c.req.json();
      if (body && typeof body.reason === 'string') {
        reason = body.reason.trim();
      }
    } catch {
      // Body is optional
    }

    const actor = getActor(c);
    const profile = await faceVerificationService.revokeReferencePhoto({
      studentId: id,
      actor,
      reason,
    });

    return c.json({
      success: true,
      data: profile,
      message: 'Reference photo revoked successfully.',
    });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// --- BLE Devices Endpoints ---

studentRoutes.get('/:studentId/ble-devices', requireStudentAuth, async (c) => {
  try {
    const { studentId } = c.req.param();
    if (c.get('user').id !== studentId) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You may only view your own devices.' } }, 403);
    const devices = await deviceRepo.findByStudentId(studentId);
    return c.json({ success: true, data: devices });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.post('/:studentId/ble-devices', requireStudentAuth, async (c) => {
  try {
    const { studentId } = c.req.param();
    if (c.get('user').id !== studentId) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You may only manage your own devices.' } }, 403);
    const body = await c.req.json();
    const device = await deviceRepo.create({
      studentId,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      bleIdentifier: body.bleIdentifier,
    });
    return c.json({ success: true, data: device }, 201);
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.patch('/:studentId/ble-devices/:deviceId', requireStudentAuth, async (c) => {
  try {
    const { studentId, deviceId } = c.req.param();
    if (c.get('user').id !== studentId) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You may only manage your own devices.' } }, 403);
    const body = await c.req.json();
    const device = await deviceRepo.update(deviceId, body);
    return c.json({ success: true, data: device });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.delete('/:studentId/ble-devices/:deviceId', requireStudentAuth, async (c) => {
  try {
    const { studentId, deviceId } = c.req.param();
    if (c.get('user').id !== studentId) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'You may only manage your own devices.' } }, 403);
    await deviceRepo.delete(deviceId);
    return c.json({ success: true, data: null });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

// --- Milestone F7: Audited Fallback Request Endpoints ---

studentRoutes.post("/me/attendance/fallback-request", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    if (!student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    const body = await c.req.json();
    const actor = {
      actorId: student.id,
      actorName: student.name,
      actorRole: 'STUDENT',
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '127.0.0.1',
      userAgent: c.req.header('user-agent'),
    };

    const request = await fallbackService.submitRequest(
      student.id,
      {
        sessionId: body.sessionId,
        reasonCategory: body.reasonCategory,
        explanation: body.explanation,
      },
      actor
    );

    return c.json({ success: true, data: request }, 201);
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

studentRoutes.get("/me/attendance/fallback-request", requireStudentAuth, async (c) => {
  try {
    const student = c.get('student');
    if (!student?.id) {
      return c.json({ success: false, error: { message: "Student profile not found" } }, 404);
    }

    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json({ success: false, error: { message: "Missing sessionId parameter" } }, 400);
    }

    const request = await fallbackService.getStudentRequest(student.id, sessionId);
    return c.json({ success: true, data: request });
  } catch (error: any) {
    return handleStudentError(c, error);
  }
});

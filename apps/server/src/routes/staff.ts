import { Hono } from "hono";
import { StaffService } from "../services/staff.service";
import { TimetableRepository } from "../repositories/timetable.repository";
import { requireHodOrAdmin, requireSharedModuleAccess, requireStaffOrAdmin, requireSharedDashboardRead, requireRole } from "../middlewares/auth.middleware";
import { localAuthService } from "../services/local-auth.service";
import type { AuthPrincipal } from "@smart-attendance/shared";
import { Buffer } from "node:buffer";
import type { staff } from "../db/schema/staff";
import { TabularImportError } from '../services/tabular-import';
import * as xlsx from 'xlsx';

export const staffRoutes = new Hono();
const service = new StaffService();
const timetableRepo = new TimetableRepository();

function handleStaffError(c: any, error: any) {
  const msg = error?.message || 'An unexpected error occurred.';
  if (error instanceof TabularImportError) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
  }
  if (error?.code === '23505') {
    return c.json({ success: false, error: { code: 'CONFLICT', message: 'A staff member with this staff code or email already exists.' } }, 409);
  }
  if (
    msg.includes('already exists') ||
    msg.includes('Cannot delete') ||
    msg.includes('Cannot deactivate') ||
    msg.includes('Cannot remove ADMIN role') ||
    msg.includes('associated with this staff member')
  ) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: msg } }, 409);
  }
  if (
    msg.includes('not found') ||
    msg.includes('Not found') ||
    msg.includes('invalid input syntax for type uuid')
  ) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
  }
  if (
    msg.includes('required') ||
    msg.includes('must belong to') ||
    msg.includes('Invalid') ||
    msg.includes('must be')
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
  }
  return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to complete the faculty request. Please retry.' } }, 500);
}

function getActor(c: any) {
  const user = c.get('user');
  return {
    actorId: user?.roles?.includes('FACULTY') ? undefined : user?.id,
    actorName: user?.name,
    actorRole: user?.roles?.[0] || 'STAFF',
    actorEmail: user?.collegeEmail,
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '127.0.0.1',
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

staffRoutes.get('/import/template', requireSharedDashboardRead, (c) => {
  const format = c.req.query('format')?.toLowerCase();
  if (format === 'xlsx') {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ['staff_code', 'name', 'college_email'],
      ['IT001', 'Sample Teacher', 'faculty@sonatech.ac.in']
    ]);
    xlsx.utils.book_append_sheet(wb, ws, 'Staff Template');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename="faculty-import-template.xlsx"');
    return c.body(buf);
  }
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="faculty-import-template.csv"');
  return c.body('staff_code,name,college_email\r\nIT001,Sample Teacher,faculty@sonatech.ac.in\r\n');
});

staffRoutes.get('/template/xlsx', requireSharedDashboardRead, (c) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet([
    ['staff_code', 'name', 'college_email'],
    ['IT001', 'Sample Teacher', 'faculty@sonatech.ac.in']
  ]);
  xlsx.utils.book_append_sheet(wb, ws, 'Staff Template');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename="faculty-import-template.xlsx"');
  return c.body(buf);
});

staffRoutes.get('/template/csv', requireSharedDashboardRead, (c) => {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="faculty-import-template.csv"');
  return c.body('staff_code,name,college_email\r\nIT001,Sample Teacher,faculty@sonatech.ac.in\r\n');
});

staffRoutes.post('/import/preview', requireRole('ADMIN'), async (c) => {
  try {
    const upload = await getImportFile(c);
    if (upload instanceof Response) return upload;
    const data = await service.validateImportFile(upload.buffer, upload.file.name);
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

staffRoutes.post('/import/confirm', requireRole('ADMIN'), async (c) => {
  try {
    const upload = await getImportFile(c);
    if (upload instanceof Response) return upload;
    const data = await service.confirmImport(upload.buffer, upload.file.name, getActor(c));
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

// --- Pending Staff Approvals (HOD / Admin Oversight) ---
staffRoutes.get('/approvals/pending', requireHodOrAdmin, async (c) => {
  try {
    const list = await localAuthService.getPendingStaffRequests();
    return c.json({ success: true, data: list, count: list.length });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

staffRoutes.get('/approvals/all', requireHodOrAdmin, async (c) => {
  try {
    const list = await localAuthService.getAllStaffRequests();
    return c.json({ success: true, data: list, count: list.length });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

staffRoutes.post('/approvals/:id/approve', requireHodOrAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ success: false, error: { message: 'Missing approval id' } }, 400);
    const result = await localAuthService.approveStaffRequest(id, getActor(c));
    return c.json(result);
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

staffRoutes.post('/approvals/:id/reject', requireHodOrAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ success: false, error: { message: 'Missing approval id' } }, 400);
    const body = await c.req.json().catch(() => ({})) as { reason?: string };
    const result = await localAuthService.rejectStaffRequest(id, body.reason, getActor(c));
    return c.json(result);
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

staffRoutes.post('/', requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    if (
      typeof body.staffCode !== 'string' ||
      typeof body.name !== 'string' ||
      typeof body.collegeEmail !== 'string'
    ) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Staff code, name, and college email are required.' } }, 400);
    }
    const data = await service.createStaff({
      staffCode: body.staffCode,
      name: body.name,
      collegeEmail: body.collegeEmail,
      status: 'ACTIVE',
      roles: ((c.get('user') as AuthPrincipal | undefined)?.roles?.includes('ADMIN') && Array.isArray(body.roles) && body.roles.length > 0) ? (body.roles as string[]) : ['STAFF'],
    }, getActor(c));
    return c.json({ success: true, data }, 201);
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

const handleStaffUpdate = async (c: any) => {
  try {
    const user = c.get('user') as AuthPrincipal | undefined;
    const body = await c.req.json() as Record<string, unknown>;
    const update: Partial<typeof staff.$inferInsert> & { roles?: string[] } = {};
    for (const field of ['staffCode', 'name', 'collegeEmail'] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string') {
          return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: `${field} must be a string.` } }, 400);
        }
        update[field] = body[field];
      }
    }
    if (body.roles !== undefined) {
      if (!user?.roles?.includes('ADMIN')) {
        return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden: Only administrators can update staff roles.' } }, 403);
      }
      if (!Array.isArray(body.roles)) {
        return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'roles must be an array of strings.' } }, 400);
      }
      update.roles = body.roles as string[];
    }
    if (!Object.keys(update).length) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Provide at least one permitted field to update.' } }, 400);
    }
    const data = await service.updateStaff(c.req.param('id')!, update, getActor(c));
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
};

staffRoutes.put('/:id', requireHodOrAdmin, handleStaffUpdate);
staffRoutes.patch('/:id', requireHodOrAdmin, handleStaffUpdate);

staffRoutes.patch('/:id/status', requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json() as { status?: string };
    if (!['ACTIVE', 'INACTIVE'].includes(body.status || '')) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Choose a supported staff status.' } }, 400);
    }
    const data = await service.updateStaffStatus(c.req.param('id')!, body.status as 'ACTIVE' | 'INACTIVE', getActor(c));
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

// Shared application users can view the actual faculty/staff directory.
staffRoutes.delete('/:id', requireRole('ADMIN'), async (c) => {
  try {
    await service.deleteStaff(c.req.param('id')!, getActor(c));
    return c.json({ success: true, message: 'Staff deleted successfully.' });
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

staffRoutes.post('/:id/roles', requireRole('ADMIN'), async (c) => {
  try {
    const body = await c.req.json() as { role?: string };
    if (!body?.role || typeof body.role !== 'string') {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Role is required.' } }, 400);
    }
    const data = await service.assignRole(c.req.param('id')!, body.role, getActor(c));
    return c.json({ success: true, data }, 201);
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

staffRoutes.delete('/:id/roles/:role', requireRole('ADMIN'), async (c) => {
  try {
    const role = c.req.param('role')!;
    const data = await service.removeRole(c.req.param('id')!, role, getActor(c));
    return c.json({ success: true, data });
  } catch (error: unknown) {
    return handleStaffError(c, error);
  }
});

// Shared application users can view the actual faculty/staff directory.
staffRoutes.get("/", requireHodOrAdmin, async (c) => {
  try {
    const search = c.req.query("search");
    const status = c.req.query("status");
    const role = c.req.query("role");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "20", 10);

    const data = await service.getStaff({ search, status, role, page, limit });
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

// Single staff details: Any staff can view own profile; ADMIN/HOD can view any
staffRoutes.get("/:id", requireStaffOrAdmin, async (c) => {
  try {
    const user = c.get("user") as AuthPrincipal;
    const targetId = c.req.param("id")!;

    const isSelf = user.id === targetId;
    const isLeadership = user.roles.some((r: string) => ["ADMIN", "HOD", "DEPUTY_HOD"].includes(r));

    if (!isSelf && !isLeadership) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: "Forbidden: You may only view your own profile." } }, 403);
    }

    const data = await service.getStaffById(targetId);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Staff not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

// View staff roles: Staff member (self) or ADMIN/HOD
staffRoutes.get("/:id/roles", requireStaffOrAdmin, async (c) => {
  try {
    const data = await service.getStaffRoles(c.req.param("id")!);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

// --- Counselor Assignments (Nested) ---
staffRoutes.get("/:id/counselor-assignments", requireStaffOrAdmin, async (c) => {
  try {
    const data = await service.getCounselorAssignments({ staffId: c.req.param("id")! });
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

staffRoutes.get("/:id/timetable", requireStaffOrAdmin, async (c) => {
  try {
    const data = await timetableRepo.findByStaff(c.req.param("id")!);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleStaffError(c, error);
  }
});

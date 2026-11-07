import { Hono } from "hono";
import { AcademicService } from "../services/academic.service";
import { StaffService } from "../services/staff.service";
import { ClassSubjectService } from "../services/class-subject.service";
import { TimetableRepository } from "../repositories/timetable.repository";
import { requireHodOrAdmin, requireSharedDashboardRead, requireRole } from "../middlewares/auth.middleware";

export const academicRoutes = new Hono();
const service = new AcademicService();
const staffService = new StaffService();
const classSubjectService = new ClassSubjectService();
const timetableRepo = new TimetableRepository();

function getActorFromContext(c: any) {
  const user = c.get('user');
  return {
    actorId: user?.roles?.includes('FACULTY') ? undefined : user?.id,
    actorName: user?.name || user?.email || 'System User',
    actorRole: user?.roles?.[0] || 'ADMIN',
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1',
    userAgent: c.req.header('user-agent'),
  };
}

function handleAcademicError(c: any, error: any) {
  const msg = error?.message || 'An unexpected error occurred.';
  if (
    msg.includes('already exists') ||
    msg.includes('Cannot delete') ||
    msg.includes('associated with it') ||
    msg.includes('enrolled in it')
  ) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: msg } }, 409);
  }
  if (msg.includes('not found') || msg.includes('Not found')) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
  }
  if (
    msg.includes('required') ||
    msg.includes('must be') ||
    msg.includes('cannot be empty') ||
    msg.includes('valid')
  ) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
  }
  return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
}

// --- Departments ---
academicRoutes.get("/departments", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getDepartments();
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/departments/:id", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getDepartmentById(c.req.param("id")!);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Department not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.post("/departments", requireRole('ADMIN'), async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.createDepartment(body, getActorFromContext(c));
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.patch("/departments/:id", requireRole('ADMIN'), async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.updateDepartment(c.req.param("id")!, body, getActorFromContext(c));
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.delete("/departments/:id", requireRole('ADMIN'), async (c) => {
  try {
    await service.deleteDepartment(c.req.param("id")!, getActorFromContext(c));
    return c.json({ success: true });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

// --- Academic Years ---
academicRoutes.get("/academic-years", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getAcademicYears();
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/academic-years/:id", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getAcademicYearById(c.req.param("id")!);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Academic year not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.post("/academic-years", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    if (body.startDate) body.startDate = new Date(body.startDate);
    if (body.endDate) body.endDate = new Date(body.endDate);
    const data = await service.createAcademicYear(body, getActorFromContext(c));
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.patch("/academic-years/:id", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    if (body.startDate) body.startDate = new Date(body.startDate);
    if (body.endDate) body.endDate = new Date(body.endDate);
    const data = await service.updateAcademicYear(c.req.param("id")!, body, getActorFromContext(c));
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.delete("/academic-years/:id", requireHodOrAdmin, async (c) => {
  try {
    await service.deleteAcademicYear(c.req.param("id")!, getActorFromContext(c));
    return c.json({ success: true });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

// --- Batches ---
academicRoutes.get("/batches", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getBatches();
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/batches/:id", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getBatchById(c.req.param("id")!);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Batch not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.post("/batches", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.createBatch(body, getActorFromContext(c));
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.patch("/batches/:id", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.updateBatch(c.req.param("id")!, body, getActorFromContext(c));
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.delete("/batches/:id", requireHodOrAdmin, async (c) => {
  try {
    await service.deleteBatch(c.req.param("id")!, getActorFromContext(c));
    return c.json({ success: true });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

// --- Regulations ---
academicRoutes.get("/regulations", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getRegulations();
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/regulations/:id", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getRegulationById(c.req.param("id")!);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Regulation not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.post("/regulations", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.createRegulation(body, getActorFromContext(c));
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.patch("/regulations/:id", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.updateRegulation(c.req.param("id")!, body, getActorFromContext(c));
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.delete("/regulations/:id", requireHodOrAdmin, async (c) => {
  try {
    await service.deleteRegulation(c.req.param("id")!, getActorFromContext(c));
    return c.json({ success: true });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

// --- Classes ---
academicRoutes.get("/classes", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getClasses();
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/classes/:id", requireSharedDashboardRead, async (c) => {
  try {
    const data = await service.getClassById(c.req.param("id")!);
    if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: "Class not found" } }, 404);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.post("/classes", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.createClass(body, getActorFromContext(c));
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.patch("/classes/:id", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const data = await service.updateClass(c.req.param("id")!, body, getActorFromContext(c));
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.delete("/classes/:id", requireHodOrAdmin, async (c) => {
  try {
    await service.deleteClass(c.req.param("id")!, getActorFromContext(c));
    return c.json({ success: true });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/classes/:id/counselor", requireSharedDashboardRead, async (c) => {
  try {
    const data = await staffService.getCounselorAssignments({ classId: c.req.param("id")! });
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/classes/:id/subjects", requireSharedDashboardRead, async (c) => {
  try {
    const data = await classSubjectService.getSubjectsByClass(c.req.param("id")!);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

academicRoutes.get("/classes/:id/timetable", requireSharedDashboardRead, async (c) => {
  try {
    const data = await timetableRepo.findByClass(c.req.param("id")!);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleAcademicError(c, error);
  }
});

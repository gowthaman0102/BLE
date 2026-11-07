import { Hono } from "hono";
import { TimetableService } from "../services/timetable.service";
import { TimetableOverrideService } from "../services/timetable-override.service";
import { requireHodOrAdmin, requireSharedDashboardRead } from "../middlewares/auth.middleware";
import type { AuthPrincipal } from "@smart-attendance/shared";

export const timetableRoutes = new Hono();
const service = new TimetableService();
const overrideService = new TimetableOverrideService();

function getActorFromContext(c: any) {
  const user = c.get("user") as AuthPrincipal | undefined;
  return user ? {
    actorId: user.roles.includes('FACULTY') ? undefined : user.id,
    actorName: user.name,
    actorRole: user.roles?.[0] || 'ADMIN',
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '127.0.0.1',
    userAgent: c.req.header('user-agent'),
  } : undefined;
}

function handleTimetableError(c: any, error: any) {
  const msg = error?.message || 'An unexpected error occurred.';
  if (
    msg.includes('CLASS_TIMETABLE_CONFLICT') ||
    msg.includes('STAFF_TIMETABLE_CONFLICT') ||
    msg.includes('already has') ||
    msg.includes('Cannot delete') ||
    error?.code === '23505'
  ) {
    const conflictMsg = msg.includes('CLASS_TIMETABLE_CONFLICT')
      ? 'Class already has another subject scheduled for this day and period.'
      : msg.includes('STAFF_TIMETABLE_CONFLICT')
        ? 'Staff member is already assigned to another class during this day and period.'
        : msg;
    return c.json({ success: false, error: { code: 'CONFLICT', message: conflictMsg } }, 409);
  }
  if (
    msg.includes('NOT_FOUND') ||
    msg.includes('not found') ||
    msg.includes('Not found')
  ) {
    const notFoundMsg = msg.includes('CLASS_NOT_FOUND')
      ? 'Assigned class was not found.'
      : msg.includes('ACADEMIC_YEAR_NOT_FOUND')
        ? 'Selected academic year was not found.'
        : msg.includes('STAFF_NOT_FOUND')
          ? 'Assigned staff member was not found.'
          : msg.includes('SUBJECT_NOT_FOUND')
            ? 'Selected subject was not found.'
            : msg.includes('PERIOD_NOT_FOUND')
              ? 'Selected period was not found.'
              : msg.includes('TIMETABLE_NOT_FOUND')
                ? 'Timetable entry not found.'
                : msg;
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: notFoundMsg } }, 404);
  }
  if (
    msg.includes('INACTIVE') ||
    msg.includes('ROLE_NOT_PERMITTED') ||
    msg.includes('INVALID') ||
    msg.includes('required') ||
    msg.includes('must be') ||
    msg.includes('Missing required')
  ) {
    const valMsg = msg.includes('CLASS_INACTIVE')
      ? 'Cannot schedule for an inactive class.'
      : msg.includes('ACADEMIC_YEAR_INACTIVE')
        ? 'Cannot schedule in an inactive academic year.'
        : msg.includes('STAFF_INACTIVE')
          ? 'Cannot assign an inactive staff member to teaching schedule.'
          : msg.includes('STAFF_ROLE_NOT_PERMITTED')
            ? 'Assigned staff member must have teaching credentials/roles.'
            : msg.includes('SUBJECT_INACTIVE')
              ? 'Cannot assign an inactive subject.'
              : msg.includes('PERIOD_INACTIVE')
                ? 'Selected period is not active.'
                : msg.includes('PERIOD_INVALID_TIMES')
                  ? 'Period start time must precede end time.'
                  : msg.includes('INVALID_DAY_OF_WEEK')
                    ? 'Day of week must be Monday through Saturday.'
                    : msg;
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: valMsg } }, 400);
  }
  return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
}

// --- Overrides ---
timetableRoutes.get("/overrides", requireSharedDashboardRead, async (c) => {
  try {
    const data = await overrideService.getOverrides();
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.post("/overrides", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    if (body.overrideDate) {
      if (typeof body.overrideDate === 'string') {
        body.overrideDate = body.overrideDate.split('T')[0];
      } else if (body.overrideDate instanceof Date) {
        body.overrideDate = body.overrideDate.toISOString().split('T')[0];
      }
    }
    const actor = getActorFromContext(c);
    const data = await overrideService.createOverride(body, actor);
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.patch("/overrides/:id", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    if (body.overrideDate) {
      if (typeof body.overrideDate === 'string') {
        body.overrideDate = body.overrideDate.split('T')[0];
      } else if (body.overrideDate instanceof Date) {
        body.overrideDate = body.overrideDate.toISOString().split('T')[0];
      }
    }
    const actor = getActorFromContext(c);
    const data = await overrideService.updateOverride(c.req.param("id")!, body, actor);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.delete("/overrides/:id", requireHodOrAdmin, async (c) => {
  try {
    const actor = getActorFromContext(c);
    await overrideService.deleteOverride(c.req.param("id")!, actor);
    return c.json({ success: true });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

// --- Core Timetable ---

timetableRoutes.get("/", requireSharedDashboardRead, async (c) => {
  try {
    const classId = c.req.query("classId");
    const academicYearId = c.req.query("academicYearId");
    const user = c.get("user") as AuthPrincipal | undefined;
    let staffId = c.req.query("staffId");

    // If neither classId nor staffId provided in query, default to authenticated user's staffId
    if (!classId && !staffId) {
      staffId = user?.id;
    }

    if (!classId && !staffId) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Provide either classId or staffId to retrieve timetable entries.' },
      }, 400);
    }
    if (classId && c.req.query("staffId")) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Provide classId or staffId, not both.' },
      }, 400);
    }

    const data = classId
      ? await service.getTimetableByClass(classId, academicYearId)
      : await service.getTimetableByStaff(staffId!, academicYearId);

    return c.json({ success: true, data });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.post("/", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const actor = getActorFromContext(c);
    const data = await service.createTimetableEntry(body, actor);
    return c.json({ success: true, data }, 201);
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.patch("/:id", requireHodOrAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const actor = getActorFromContext(c);
    const data = await service.updateTimetableEntry(c.req.param("id")!, body, actor);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.delete("/:id", requireHodOrAdmin, async (c) => {
  try {
    const actor = getActorFromContext(c);
    await service.deleteTimetableEntry(c.req.param("id")!, actor);
    return c.json({ success: true, message: 'Timetable entry deleted successfully.' });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

// --- Additional Routes ---
timetableRoutes.get("/stats", requireSharedDashboardRead, async (c) => {
  try {
    const academicYearId = c.req.query("academicYearId");
    const data = await service.getTimetableStats(academicYearId);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

timetableRoutes.get("/today", requireSharedDashboardRead, async (c) => {
  try {
    const academicYearId = c.req.query("academicYearId");
    const classId = c.req.query("classId");
    const data = await service.getTodayTimetable(academicYearId, classId);
    return c.json({ success: true, data });
  } catch (error: any) {
    return handleTimetableError(c, error);
  }
});

/**
 * Production Presets Seed Script
 * 
 * Provisions only essential operational presets required for a production environment:
 * 1. Base system roles (ADMIN, HOD, DEPUTY_HOD, CLASS_COUNSELOR, STAFF, STUDENT)
 * 2. Standard 7 academic periods with default operational hours
 * 3. Default system settings (attendance threshold, start early window, max correction days, etc.)
 * 4. IT Department baseline record
 * 
 * SAFETY & IDEMPOTENCY GUARANTEES:
 * - Completely idempotent: safe to run multiple times without duplicating or corrupting data.
 * - Non-destructive: uses ON CONFLICT DO NOTHING so existing customized values are preserved.
 * - STRICT BOUNDARY: Never generates synthetic students, fake staff, or demo attendance records.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { roles } from '../src/db/schema/staff';
import { periods } from '../src/db/schema/timetable';
import { systemSettings } from '../src/db/schema/settings';
import { departments } from '../src/db/schema/academic';
import { sanitizeDbUrl } from '../src/db/sanitize';

export const BASELINE_ROLES = [
  { name: 'ADMIN', description: 'System Administrator with full access' },
  { name: 'HOD', description: 'Head of Department' },
  { name: 'DEPUTY_HOD', description: 'Deputy Head of Department' },
  { name: 'CLASS_COUNSELOR', description: 'Class Counselor with student and attendance oversight' },
  { name: 'STAFF', description: 'Teaching Staff / Faculty' },
  { name: 'STUDENT', description: 'Enrolled Student' },
];

export const BASELINE_PERIODS = [
  { periodNumber: 1, name: 'Period 1', startTime: '09:00:00', endTime: '09:50:00', status: 'ACTIVE' },
  { periodNumber: 2, name: 'Period 2', startTime: '09:50:00', endTime: '10:40:00', status: 'ACTIVE' },
  { periodNumber: 3, name: 'Period 3', startTime: '11:00:00', endTime: '11:50:00', status: 'ACTIVE' },
  { periodNumber: 4, name: 'Period 4', startTime: '11:50:00', endTime: '12:40:00', status: 'ACTIVE' },
  { periodNumber: 5, name: 'Period 5', startTime: '13:30:00', endTime: '14:20:00', status: 'ACTIVE' },
  { periodNumber: 6, name: 'Period 6', startTime: '14:20:00', endTime: '15:10:00', status: 'ACTIVE' },
  { periodNumber: 7, name: 'Period 7', startTime: '15:10:00', endTime: '16:00:00', status: 'ACTIVE' },
];

export const BASELINE_SETTINGS = [
  {
    category: 'general',
    key: 'INSTITUTION_NAME',
    value: 'Smart Attendance System',
    type: 'string',
    description: 'Name of the institution',
  },
  {
    category: 'general',
    key: 'TIMEZONE',
    value: 'Asia/Kolkata',
    type: 'string',
    description: 'System timezone',
  },
  {
    category: 'attendance',
    key: 'ATTENDANCE_THRESHOLD',
    value: '75',
    type: 'number',
    description: 'Minimum attendance percentage required',
  },
  {
    category: 'attendance',
    key: 'ATTENDANCE_START_EARLY_MINUTES',
    value: '10',
    type: 'number',
    description: 'Minutes before period start when attendance can be marked',
  },
  {
    category: 'attendance',
    key: 'MAX_MANUAL_CORRECTION_DAYS',
    value: '7',
    type: 'number',
    description: 'Maximum days allowed for retroactive manual attendance correction',
  },
  {
    category: 'attendance',
    key: 'MANUAL_CORRECTION_ENABLED',
    value: 'true',
    type: 'boolean',
    description: 'Allow staff to manually correct attendance',
  },
  {
    category: 'notifications',
    key: 'ATTENDANCE_SESSION_NOTIFICATIONS',
    value: 'true',
    type: 'boolean',
    description: 'Notify staff when sessions start/end',
  },
  {
    category: 'notifications',
    key: 'LOW_ATTENDANCE_NOTIFICATIONS',
    value: 'false',
    type: 'boolean',
    description: 'Notify students with low attendance',
  },
];

export const BASELINE_DEPARTMENTS = [
  {
    name: 'Information Technology',
    code: 'IT',
    status: 'ACTIVE' as const,
  },
];

export async function seedProductionPresets(options?: { connectionString?: string }) {
  const rawUrl = options?.connectionString || process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error('DATABASE_URL environment variable is required to seed production presets.');
  }

  // Safety guard for test environment
  if (process.env.NODE_ENV === 'test') {
    try {
      const u = new URL(rawUrl);
      const dbName = decodeURIComponent(u.pathname.slice(1));
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) || !dbName.endsWith('_test')) {
        throw new Error('Refusing to run test seeds against a non-loopback database whose name does not end in _test.');
      }
    } catch (e: any) {
      if (e.message.includes('Refusing to run')) throw e;
      throw new Error('Invalid DATABASE_URL configuration.');
    }
  }

  console.log(`[Production Presets Seed] Connecting to target database: ${sanitizeDbUrl(rawUrl)}`);
  const sql = postgres(rawUrl, { max: 1 });
  const db = drizzle(sql);

  try {
    console.log('[Production Presets Seed] Seeding baseline roles...');
    for (const r of BASELINE_ROLES) {
      await db.insert(roles)
        .values({
          name: r.name,
          description: r.description,
        })
        .onConflictDoNothing({ target: roles.name });
    }
    console.log(`[Production Presets Seed] -> Processed ${BASELINE_ROLES.length} baseline roles.`);

    console.log('[Production Presets Seed] Seeding standard operational periods (1 to 7)...');
    for (const p of BASELINE_PERIODS) {
      await db.insert(periods)
        .values({
          periodNumber: p.periodNumber,
          name: p.name,
          startTime: p.startTime,
          endTime: p.endTime,
          status: p.status,
        })
        .onConflictDoNothing({ target: periods.periodNumber });
    }
    console.log(`[Production Presets Seed] -> Processed ${BASELINE_PERIODS.length} standard periods.`);

    console.log('[Production Presets Seed] Seeding default system settings...');
    for (const s of BASELINE_SETTINGS) {
      await db.insert(systemSettings)
        .values({
          category: s.category,
          key: s.key,
          value: s.value,
          type: s.type,
          description: s.description,
        })
        .onConflictDoNothing({ target: systemSettings.key });
    }
    console.log(`[Production Presets Seed] -> Processed ${BASELINE_SETTINGS.length} system settings.`);

    console.log('[Production Presets Seed] Seeding initial academic department...');
    for (const d of BASELINE_DEPARTMENTS) {
      await db.insert(departments)
        .values({
          name: d.name,
          code: d.code,
          status: d.status,
        })
        .onConflictDoNothing({ target: departments.code });
    }
    console.log(`[Production Presets Seed] -> Processed ${BASELINE_DEPARTMENTS.length} department(s).`);

    console.log('\n======================================================');
    console.log('[Production Presets Seed] SUCCESS: All production presets ensured.');
    console.log('[Production Presets Seed] NOTE: Synthetic students, staff, and attendance were NOT generated.');
    console.log('======================================================\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Direct execution guard
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/seed-production-presets.ts');
if (isDirectRun) {
  seedProductionPresets().catch((err: any) => {
    console.error('[Production Presets Seed Fatal Error]', err.message || err);
    process.exit(1);
  });
}

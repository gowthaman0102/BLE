import 'dotenv/config';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import app from '../src/index';
import { db } from '../src/db';
import { auditLogs } from '../src/db/schema/audit';
import { facultyAuthAccounts, staffCredentials } from '../src/db/schema/auth';
import { roles, staff, staffRoles } from '../src/db/schema/staff';
import { LocalAuthService } from '../src/services/local-auth.service';

const TEST_COLLEGE_DOMAIN = 'sonatech.ac.in';
const TEST_PASSWORD = 'Local-HOD-test-password-2026';

describe('Local HOD authentication and management authorization', () => {
  const testStaffCode = `HOD-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const testEmail = `hod.${randomUUID()}@${TEST_COLLEGE_DOMAIN}`;
  const facultyEmail = `faculty.${randomUUID()}@gmail.com`;
  let hodStaffId: string;
  let facultyAccountId: string | undefined;
  const createdStaffIds: string[] = [];
  let hodRoleId: string;
  let staffRoleId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COLLEGE_EMAIL_DOMAIN = TEST_COLLEGE_DOMAIN;
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';

    let hodRole = (await db.select().from(roles).where(eq(roles.name, 'HOD')))[0];
    if (!hodRole) {
      [hodRole] = await db.insert(roles)
        .values({ name: 'HOD', description: 'Head of Department administrator' })
        .returning();
    }
    hodRoleId = hodRole.id;

    let staffRole = (await db.select().from(roles).where(eq(roles.name, 'STAFF')))[0];
    if (!staffRole) {
      [staffRole] = await db.insert(roles)
        .values({ name: 'STAFF', description: 'Faculty and teaching staff' })
        .returning();
    }
    staffRoleId = staffRole.id;

    const [hod] = await db.insert(staff).values({
      staffCode: testStaffCode,
      name: 'Test HOD',
      collegeEmail: testEmail,
      status: 'ACTIVE',
    }).returning();
    hodStaffId = hod.id;
    await db.insert(staffRoles).values([
      { staffId: hodStaffId, roleId: hodRoleId },
      { staffId: hodStaffId, roleId: staffRoleId },
    ]);
    await db.insert(staffCredentials).values({
      staffId: hodStaffId,
      passwordHash: await LocalAuthService.hashPassword(TEST_PASSWORD),
    });
  });

  afterAll(async () => {
    if (hodStaffId) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, hodStaffId));
      await db.delete(staffCredentials).where(eq(staffCredentials.staffId, hodStaffId));
      await db.delete(staffRoles).where(eq(staffRoles.staffId, hodStaffId));
    }
    for (const createdStaffId of createdStaffIds) {
      await db.delete(auditLogs).where(eq(auditLogs.entityId, createdStaffId));
      await db.delete(staffRoles).where(eq(staffRoles.staffId, createdStaffId));
      await db.delete(staff).where(eq(staff.id, createdStaffId));
    }
    if (facultyAccountId) {
      await db.delete(auditLogs).where(eq(auditLogs.entityId, facultyAccountId));
      await db.delete(facultyAuthAccounts).where(eq(facultyAuthAccounts.id, facultyAccountId));
    }
    if (hodStaffId) await db.delete(staff).where(eq(staff.id, hodStaffId));
  });

  async function signIn() {
    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
    });
    const setCookie = response.headers.get('set-cookie');
    return { response, cookie: setCookie?.split(';', 1)[0] };
  }

  it('rejects unauthenticated management access', async () => {
    const response = await app.request('/api/staff');
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('returns the same generic response for invalid credentials', async () => {
    const wrongPassword = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'incorrect-password' }),
    });
    const unknownEmail = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `missing@${TEST_COLLEGE_DOMAIN}`, password: 'incorrect-password' }),
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect((await wrongPassword.json()).error.message).toBe((await unknownEmail.json()).error.message);
  });

  it('creates a normalized faculty account without inventing a staff record and hashes its password', async () => {
    const signup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Faculty',
        email: facultyEmail.toUpperCase(),
        password: TEST_PASSWORD,
        role: 'HOD',
      }),
    });
    expect(signup.status).toBe(201);
    expect(signup.headers.get('set-cookie')).toContain('HttpOnly');
    const signupBody = await signup.json();
    expect(signupBody.user.roles).toEqual(['FACULTY']);
    expect(signupBody.user.collegeEmail).toBe(facultyEmail);
    expect(signupBody.user).not.toHaveProperty('passwordHash');
    expect(signupBody.user).not.toHaveProperty('password');
    facultyAccountId = signupBody.user.id;

    const account = (await db.select().from(facultyAuthAccounts)
      .where(eq(facultyAuthAccounts.id, facultyAccountId!)))[0];
    expect(account.email).toBe(facultyEmail);
    expect(account.passwordHash).not.toBe(TEST_PASSWORD);
    expect(await bcrypt.compare(TEST_PASSWORD, account.passwordHash)).toBe(true);
    expect(account.role).toBe('FACULTY');
    expect(await db.select().from(staff).where(eq(staff.collegeEmail, facultyEmail))).toHaveLength(0);

    const duplicate = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate Faculty', email: facultyEmail, password: TEST_PASSWORD }),
    });
    expect(duplicate.status).toBe(409);

    const cookie = signup.headers.get('set-cookie')?.split(';', 1)[0];
    const session = await app.request('/api/auth/me', { headers: { Cookie: cookie! } });
    expect(session.status).toBe(200);
    expect((await session.json()).user.roles).toEqual(['FACULTY']);

    const dashboard = await app.request('/api/dashboard/stats', { headers: { Cookie: cookie! } });
    expect(dashboard.status).toBe(200);

    const academicYears = await app.request('/api/academic-years', { headers: { Cookie: cookie! } });
    expect(academicYears.status).toBe(200);

    expect((await app.request('/api/students', { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await app.request('/api/staff', { headers: { Cookie: cookie! } })).status).toBe(403);
    expect((await app.request('/api/students/import/template', { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await app.request('/api/staff/import/template', { headers: { Cookie: cookie! } })).status).toBe(200);
    const attendanceWrite = await app.request('/api/attendance/sessions/start', {
      method: 'POST',
      headers: {
        Cookie: cookie!,
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timetableId: randomUUID(), date: '2026-10-20' }),
    });
    expect(attendanceWrite.status).toBe(403);
    expect((await attendanceWrite.json()).error.code).toBe('STAFF_PROFILE_REQUIRED');

    const facultyStaffCreate = await app.request('/api/staff', {
      method: 'POST',
      headers: {
        Cookie: cookie!,
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        staffCode: `TST-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        name: 'Faculty-created Staff',
        collegeEmail: `faculty-created.${randomUUID()}@${TEST_COLLEGE_DOMAIN}`,
      }),
    });
    expect(facultyStaffCreate.status).toBe(403);
    expect((await facultyStaffCreate.json()).error.code).toBe('FORBIDDEN');




    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: facultyEmail, password: TEST_PASSWORD }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).user.roles).toEqual(['FACULTY']);

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie!, Origin: 'http://localhost:5173' },
    });
    expect(logout.status).toBe(200);
    expect((await app.request('/api/auth/me', { headers: { Cookie: cookie! } })).status).toBe(401);
  });

  it('issues an HTTP-only HOD cookie and restores the session', async () => {
    const { response, cookie } = await signIn();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(cookie).toBeTruthy();
    expect((await response.json()).user.roles).toContain('HOD');

    const restored = await app.request('/api/auth/me', { headers: { Cookie: cookie! } });
    expect(restored.status).toBe(200);
    expect((await restored.json()).user.collegeEmail).toBe(testEmail);
  });

  it('allows HOD faculty creation and assigns only the ordinary STAFF role', async () => {
    const { cookie } = await signIn();
    const response = await app.request('/api/staff', {
      method: 'POST',
      headers: {
        Cookie: cookie!,
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        staffCode: `TST-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        name: 'Created Faculty',
        collegeEmail: `faculty.${randomUUID()}@${TEST_COLLEGE_DOMAIN}`,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.roles).toEqual(['STAFF']);
    createdStaffIds.push(body.data.id);
  });

  it('rejects cookie-authenticated mutations with an untrusted origin', async () => {
    const { cookie } = await signIn();
    const response = await app.request('/api/staff', {
      method: 'POST',
      headers: {
        Cookie: cookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ staffCode: 'NO-ORIGIN', name: 'No Origin', collegeEmail: testEmail }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CSRF_REJECTED');
  });

  it('does not mount the Microsoft admin login route', async () => {
    const { cookie } = await signIn();
    const response = await app.request('/api/auth/microsoft', {
      method: 'POST',
      headers: { Cookie: cookie!, Origin: 'http://localhost:5173' },
    });
    expect(response.status).toBe(404);
  });

  it('invalidates the HOD cookie on logout', async () => {
    const { cookie } = await signIn();
    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie!, Origin: 'http://localhost:5173' },
    });
    expect(logout.status).toBe(200);

    const restored = await app.request('/api/auth/me', { headers: { Cookie: cookie! } });
    expect(restored.status).toBe(401);
  });
});

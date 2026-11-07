import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import app from '../src/index';
import { db } from '../src/db';
import { auditLogs } from '../src/db/schema/audit';
import { staffApprovalRequests, facultyAuthAccounts, staffCredentials } from '../src/db/schema/auth';
import { roles, staff, staffRoles } from '../src/db/schema/staff';
import { LocalAuthService } from '../src/services/local-auth.service';

const TEST_COLLEGE_DOMAIN = 'sonatech.ac.in';
const TEST_PASSWORD = 'SecureStaffPassword2026!';

describe('Staff Approval Requests & Login Lifecycle (Migration 0020 Verification)', () => {
  const hodEmail = `hod.audit.${randomUUID()}@${TEST_COLLEGE_DOMAIN}`;
  const staffEmailRejected = `staff.rejected.${randomUUID()}@${TEST_COLLEGE_DOMAIN}`;
  const staffEmailApproved = `staff.approved.${randomUUID()}@${TEST_COLLEGE_DOMAIN}`;
  let hodStaffId: string;
  let hodRoleId: string;
  let staffRoleId: string;
  let hodCookie: string;
  let rejectedRequestId: string;
  let approvedRequestId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COLLEGE_EMAIL_DOMAIN = TEST_COLLEGE_DOMAIN;
    process.env.JWT_SECRET = 'test_secret_for_vitest_runner_min_32_characters_long!';

    // Ensure roles exist
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

    // Create HOD staff record
    const [hod] = await db.insert(staff).values({
      staffCode: `HOD-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      name: 'Dr. Audit HOD',
      collegeEmail: hodEmail,
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

    // Login as HOD to obtain admin_token cookie
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: hodEmail, password: TEST_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    hodCookie = loginRes.headers.get('set-cookie')?.split(';', 1)[0] || '';
  });

  afterAll(async () => {
    // Cleanup created records
    if (rejectedRequestId) {
      await db.delete(staffApprovalRequests).where(eq(staffApprovalRequests.id, rejectedRequestId));
    }
    if (approvedRequestId) {
      await db.delete(staffApprovalRequests).where(eq(staffApprovalRequests.id, approvedRequestId));
    }
    await db.delete(facultyAuthAccounts).where(eq(facultyAuthAccounts.email, staffEmailApproved));
    await db.delete(facultyAuthAccounts).where(eq(facultyAuthAccounts.email, staffEmailRejected));
    await db.delete(auditLogs).where(eq(auditLogs.actorId, hodStaffId));
    await db.delete(staffCredentials).where(eq(staffCredentials.staffId, hodStaffId));
    await db.delete(staffRoles).where(eq(staffRoles.staffId, hodStaffId));
    await db.delete(staff).where(eq(staff.id, hodStaffId));
  });

  it('1. Verifies staff_approval_requests table is accessible and empty of this staff email', async () => {
    const existing = await db
      .select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.email, staffEmailRejected));
    expect(existing).toHaveLength(0);
  });

  it('2. Registers a new staff account via POST /api/auth/staff-register', async () => {
    const registerRes = await app.request('/api/auth/staff-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Prof. Rejected Assistant',
        email: staffEmailRejected,
        staffCode: `STF-${randomUUID().slice(0, 8)}`,
        department: 'Information Technology',
        designation: 'Assistant Professor',
        password: TEST_PASSWORD,
      }),
    });

    expect(registerRes.status).toBe(200);
    const body = await registerRes.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('submitted to the HOD');

    // Verify row was created in staff_approval_requests table
    const [row] = await db
      .select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.email, staffEmailRejected));

    expect(row).toBeDefined();
    expect(row.status).toBe('PENDING');
    expect(row.name).toBe('Prof. Rejected Assistant');
    rejectedRequestId = row.id;
  });

  it('3. Rejects login with PENDING_HOD_APPROVAL (403) while approval is pending', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: staffEmailRejected, password: TEST_PASSWORD }),
    });

    expect(loginRes.status).toBe(403);
    const body = await loginRes.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PENDING_HOD_APPROVAL');
    expect(body.error.message).toContain('pending approval');
  });

  it('4. Allows HOD to view pending staff approval requests', async () => {
    const listRes = await app.request('/api/staff/approvals/pending', {
      headers: { Cookie: hodCookie },
    });

    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.success).toBe(true);
    const found = body.data.find((r: any) => r.email === staffEmailRejected);
    expect(found).toBeDefined();
    expect(found.status).toBe('PENDING');
  });

  it('5. Allows HOD to reject staff approval request with reason', async () => {
    const rejectRes = await app.request(`/api/staff/approvals/${rejectedRequestId}/reject`, {
      method: 'POST',
      headers: {
        Cookie: hodCookie,
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Verification documents incomplete' }),
    });

    expect(rejectRes.status).toBe(200);

    // Verify status is now REJECTED
    const [row] = await db
      .select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.id, rejectedRequestId));
    expect(row).toBeDefined();
    expect(row.status).toBe('REJECTED');
    expect(row.rejectionReason).toBe('Verification documents incomplete');
  });

  it('6. Returns APPROVAL_REJECTED (403) on login after request rejection', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: staffEmailRejected, password: TEST_PASSWORD }),
    });

    expect(loginRes.status).toBe(403);
    const body = await loginRes.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('APPROVAL_REJECTED');
    expect(body.error.message).toContain('Verification documents incomplete');
  });

  it('7. Registers and approves a second staff member via POST /api/staff/approvals/:id/approve', async () => {
    // Register
    const regRes = await app.request('/api/auth/staff-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Prof. Approved Assistant',
        email: staffEmailApproved,
        staffCode: `STF-${randomUUID().slice(0, 8)}`,
        department: 'Information Technology',
        designation: 'Assistant Professor',
        password: TEST_PASSWORD,
      }),
    });
    expect(regRes.status).toBe(200);

    const [pendingRow] = await db
      .select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.email, staffEmailApproved));
    expect(pendingRow).toBeDefined();
    approvedRequestId = pendingRow.id;

    // Approve
    const approveRes = await app.request(`/api/staff/approvals/${approvedRequestId}/approve`, {
      method: 'POST',
      headers: {
        Cookie: hodCookie,
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
    });

    expect(approveRes.status).toBe(200);
    const body = await approveRes.json();
    expect(body.success).toBe(true);

    // Verify row in staff_approval_requests is marked APPROVED
    const [row] = await db
      .select()
      .from(staffApprovalRequests)
      .where(eq(staffApprovalRequests.id, approvedRequestId));
    expect(row.status).toBe('APPROVED');

    // Verify facultyAuthAccounts has the active account
    const [faculty] = await db
      .select()
      .from(facultyAuthAccounts)
      .where(eq(facultyAuthAccounts.email, staffEmailApproved));
    expect(faculty).toBeDefined();
    expect(faculty.status).toBe('ACTIVE');
    expect(faculty.role).toBe('FACULTY');
  });

  it('8. Successfully logs in as approved faculty with HTTP 200 and valid JWT token', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: staffEmailApproved, password: TEST_PASSWORD }),
    });

    expect(loginRes.status).toBe(200);
    const body = await loginRes.json();
    expect(body.success).toBe(true);
    expect(body.user.collegeEmail).toBe(staffEmailApproved);
    expect(body.user.roles).toContain('FACULTY');
    expect(body.token).toBeDefined();
  });
});

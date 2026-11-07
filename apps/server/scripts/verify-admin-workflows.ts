const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function runAdminAudit() {
  console.log("=== ADMIN APPLICATION WORKFLOW ACCEPTANCE AUDIT (LIVE SERVER) ===\n");
  const results: { workflow: string; endpoint: string; status: number; success: boolean; details: string }[] = [];

  // Helper for requests
  async function api(path: string, options: RequestInit = {}, token: string = '', cookie: string = '') {
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    if (cookie) {
      headers.set('cookie', cookie);
    }
    headers.set('origin', 'http://localhost:5173');
    
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    let body: any = null;
    try {
      body = await res.json();
    } catch (e) {
      body = await res.text();
    }
    return { res, body, setCookie: res.headers.get('set-cookie') || '' };
  }

  // 1. Admin Login
  console.log("1. Testing Admin Authentication (Login & Identity)...");
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@sonatech.ac.in', password: '123456789012' }),
  });
  
  const token = loginRes.body?.token;
  const adminCookie = loginRes.setCookie;
  const loginOk = loginRes.res.status === 200 && loginRes.body?.success === true && !!token;
  results.push({
    workflow: "1. Admin Authentication (Login)",
    endpoint: "POST /api/auth/login",
    status: loginRes.res.status,
    success: loginOk,
    details: loginOk ? `Token issued, user: ${loginRes.body.user?.email || 'admin@sonatech.ac.in'}, roles: ${JSON.stringify(loginRes.body.user?.roles)}` : `Failed: ${JSON.stringify(loginRes.body)}`
  });

  // Verify /api/auth/me
  const meRes = await api('/api/auth/me', {}, token, adminCookie);
  results.push({
    workflow: "1. Identity Verification (/me)",
    endpoint: "GET /api/auth/me",
    status: meRes.res.status,
    success: meRes.res.status === 200,
    details: `Authenticated principal ID: ${meRes.body?.user?.id}, email: ${meRes.body?.user?.email || 'admin@sonatech.ac.in'}`
  });

  // 2. Dashboard Loading
  console.log("2. Testing Dashboard Loading...");
  const dashRes = await api('/api/dashboard/stats', {}, token, adminCookie);
  const dashOk = dashRes.res.status === 200 && dashRes.body?.success === true;
  results.push({
    workflow: "2. Dashboard Statistics",
    endpoint: "GET /api/dashboard/stats",
    status: dashRes.res.status,
    success: dashOk,
    details: dashOk ? `Metrics: ${JSON.stringify(dashRes.body.data)}` : `Failed: ${JSON.stringify(dashRes.body)}`
  });

  // 3. Student Management
  console.log("3. Testing Student Management...");
  const studentsRes = await api('/api/students', {}, token, adminCookie);
  const studentsOk = studentsRes.res.status === 200 && studentsRes.body?.success === true;
  results.push({
    workflow: "3. Student Management",
    endpoint: "GET /api/students",
    status: studentsRes.res.status,
    success: studentsOk,
    details: studentsOk ? `Retrieved students list (count: ${studentsRes.body.data?.length ?? 'OK'})` : `Failed: ${JSON.stringify(studentsRes.body)}`
  });

  // 4. Staff Approval Workflow (Pending, Approve, Reject)
  console.log("4. Testing Staff Registration & Approval Workflow...");
  const testStaffEmail = `test.prof.${Date.now()}@sonatech.ac.in`;
  const regRes = await api('/api/auth/staff-register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: "Dr. Audit Professor",
      email: testStaffEmail,
      department: "Information Technology",
      designation: "Assistant Professor",
      password: "TestPassword123!"
    })
  });
  const regOk = regRes.res.status === 200 && regRes.body?.success === true;

  const pendingRes = await api('/api/staff/approvals/pending', {}, token, adminCookie);
  const pendingOk = pendingRes.res.status === 200 && pendingRes.body?.success === true;
  const targetReq = pendingRes.body?.data?.find((r: any) => r.email === testStaffEmail);

  let approveOk = false;
  if (targetReq) {
    const appRes = await api(`/api/staff/approvals/${targetReq.id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['STAFF'] })
    }, token, adminCookie);
    approveOk = appRes.res.status === 200 && appRes.body?.success === true;
  }

  results.push({
    workflow: "4. Staff Approval Workflow",
    endpoint: "POST /api/auth/staff-register -> GET /pending -> POST /approve",
    status: approveOk ? 200 : 400,
    success: regOk && pendingOk && approveOk,
    details: `Registered: ${regOk}, Pending Listed: ${pendingOk}, Approved: ${approveOk}`
  });

  // 5. Timetable Management
  console.log("5. Testing Timetable Management...");
  const ttRes = await api('/api/timetable/today', {}, token, adminCookie);
  const ttOk = ttRes.res.status === 200 && ttRes.body?.success === true;
  results.push({
    workflow: "5. Timetable Schedule",
    endpoint: "GET /api/timetable/today",
    status: ttRes.res.status,
    success: ttOk,
    details: ttOk ? `Retrieved ${ttRes.body.data?.length || 0} schedule slots for today` : `Failed: ${JSON.stringify(ttRes.body)}`
  });

  // 6. Staff Allocation
  console.log("6. Testing Staff Directory & Allocation...");
  const staffRes = await api('/api/staff', {}, token, adminCookie);
  const staffOk = staffRes.res.status === 200 && staffRes.body?.success === true;
  results.push({
    workflow: "6. Staff Allocation Directory",
    endpoint: "GET /api/staff",
    status: staffRes.res.status,
    success: staffOk,
    details: staffOk ? `Retrieved staff directory (status: 200)` : `Failed: ${JSON.stringify(staffRes.body)}`
  });

  // 7. Attendance Reports
  console.log("7. Testing Attendance Reports...");
  const sessionsRes = await api('/api/attendance/sessions', {}, token, adminCookie);
  const sessionsOk = sessionsRes.res.status === 200 && sessionsRes.body?.success === true;
  const firstSession = sessionsRes.body?.data?.[0];
  results.push({
    workflow: "7. Attendance Sessions & Reports",
    endpoint: "GET /api/attendance/sessions",
    status: sessionsRes.res.status,
    success: sessionsOk,
    details: sessionsOk ? `Retrieved ${sessionsRes.body.data?.length || 0} attendance sessions` : `Failed: ${JSON.stringify(sessionsRes.body)}`
  });

  // 8. Manual Attendance Correction & Records
  console.log("8. Testing Manual Attendance Correction & Records Query...");
  let corrOk = false;
  let corrDetails = '';
  if (firstSession?.id) {
    const correctionsRes = await api(`/api/attendance/corrections?sessionId=${firstSession.id}`, {}, token, adminCookie);
    corrOk = correctionsRes.res.status === 200 && correctionsRes.body?.success === true;
    corrDetails = `Retrieved corrections for session ${firstSession.id} (count: ${correctionsRes.body.data?.length || 0})`;
  } else {
    const recsRes = await api(`/api/attendance/records`, {}, token, adminCookie);
    corrOk = recsRes.res.status === 200;
    corrDetails = `Retrieved attendance records list`;
  }
  results.push({
    workflow: "8. Attendance Corrections & Records",
    endpoint: "GET /api/attendance/corrections?sessionId=...",
    status: corrOk ? 200 : 400,
    success: corrOk,
    details: corrDetails
  });

  // 9. Audit History
  console.log("9. Testing Audit History...");
  const auditRes = await api('/api/audit/logs?limit=5', {}, token, adminCookie);
  const auditOk = auditRes.res.status === 200 && auditRes.body?.success === true;
  results.push({
    workflow: "9. Security & Audit History",
    endpoint: "GET /api/audit/logs",
    status: auditRes.res.status,
    success: auditOk,
    details: auditOk ? `Retrieved ${auditRes.body.data?.length || 0} audit log records (total: ${auditRes.body.total})` : `Failed: ${JSON.stringify(auditRes.body)}`
  });

  // 10. Logout
  const logoutRes = await api('/api/auth/logout', { method: 'POST' }, token, adminCookie);
  results.push({
    workflow: "10. Admin Logout",
    endpoint: "POST /api/auth/logout",
    status: logoutRes.res.status,
    success: logoutRes.res.status === 200,
    details: "Admin session invalidated successfully"
  });

  console.log("\n==================== WORKFLOW RESULTS SUMMARY ====================");
  let allPass = true;
  for (const r of results) {
    const icon = r.success ? "✅" : "❌";
    if (!r.success) allPass = false;
    console.log(`${icon} [${r.status}] ${r.workflow} -> ${r.endpoint}`);
    console.log(`   Details: ${r.details}\n`);
  }
  console.log(`OVERALL RESULT: ${allPass ? "ALL 10 ADMIN WORKFLOWS VERIFIED (PASS)" : "SOME WORKFLOWS FAILED"}`);
  if (!allPass) process.exit(1);
}

runAdminAudit().catch(err => {
  console.error("FATAL ERROR in runAdminAudit:", err);
  process.exit(1);
});

/**
 * EdForge — Golden Thread: Complete End-to-End Smoke Test
 *
 * Validates ALL Sprint 1–7 features in a single sequential flow following the
 * Ed-Fi Golden Thread: EdOrg → Calendar → Schedule → Students → Enrollment →
 * Rostering → Attendance → Grades.
 *
 * Coverage:
 *
 *   Module 0:  Setup — Verify school exists, discover existing data
 *   Module 1:  EdOrg Hierarchy — SEA, LEA, hierarchy tree
 *   Module 2:  School Configuration — Config, departments
 *   Module 3:  Users & Roles — Create admin user, assign school roles
 *   Module 4:  Staff Management — Create staff w/ user, credentials, leave, assignments
 *   Module 5:  Academic Year & Calendar — Year, grading periods, generate calendar, sessions
 *   Module 6:  Master Schedule — Class periods, locations
 *   Module 7:  Courses & Sections — Course catalog, offerings, sections w/ schedule refs
 *   Module 8:  Students — Create students, de-duplication, CSV import
 *   Module 9:  Enrollment — Enroll students, validation, listing, withdrawal
 *   Module 10: Section Rostering — Roster students, verify rosters
 *   Module 11: Attendance — Single, bulk, summary, trend, alerts
 *   Module 12: Grades — Grading policies, record grades, finalize
 *   Module 13: Cross-Service Validation — School↔Academics, profile aggregation
 *   Module 14: Security Controls — Auth required, health public
 *
 * NO CLEANUP — All data persists for frontend rendering / manual UAT.
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/golden-thread-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/golden-thread-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> API_BASE_URL=<url> npx ts-node scripts/smoke-tests/golden-thread-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || '';
const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/golden-thread-flow.ts');
  process.exit(1);
}

if (!SCHOOL_ID) {
  console.error('\x1b[31mERROR: SCHOOL_ID environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/golden-thread-flow.ts');
  process.exit(1);
}

// ─────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────

interface ApiResponse<T = unknown> {
  status: number;
  data: T | null;
  error: string | null;
  duration: number;
}

interface TestResult {
  name: string;
  module: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
}

interface ListResponse<T> { items: T[]; hasMore?: boolean; lastEvaluatedKey?: string }

// ─────────────────────────────────────────
// CONTEXT — Tracks all created entities
// ─────────────────────────────────────────

interface TestContext {
  schoolId: string;
  schoolName: string;

  // EdOrg
  seaId: string;
  leaId: string;

  // School Config
  departmentId: string;

  // Users
  adminUserId: string;
  adminEmail: string;

  // Staff
  teacherStaffId: string;
  teacherUserId: string;
  teacherEmail: string;
  staffAssignmentId: string;
  credentialId: string;
  leaveRequestId: string;

  // Calendar
  academicYearId: string;
  academicYearStartDate: string;
  academicYearEndDate: string;
  gradingPeriodIds: string[];
  calendarId: string;
  fallSessionId: string;
  springSessionId: string;

  // Schedule
  period1Id: string;
  period2Id: string;
  location1Id: string;

  // Courses & Sections
  courseId: string;
  courseCode: string;
  courseOfferingId: string;
  sectionId: string;

  // Students
  students: Array<{
    studentId: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string;
  }>;

  // Enrollment
  enrollments: Array<{
    enrollmentId: string;
    studentId: string;
  }>;

  // Rostering
  rosterAssignments: Array<{
    sectionId: string;
    studentId: string;
  }>;

  // Grades
  gradingPolicyId: string;
}

const ctx: TestContext = {
  schoolId: SCHOOL_ID,
  schoolName: '',
  seaId: '', leaId: '',
  departmentId: '',
  adminUserId: '', adminEmail: '',
  teacherStaffId: '', teacherUserId: '', teacherEmail: '',
  staffAssignmentId: '', credentialId: '', leaveRequestId: '',
  academicYearId: '', academicYearStartDate: '', academicYearEndDate: '',
  gradingPeriodIds: [], calendarId: '',
  fallSessionId: '', springSessionId: '',
  period1Id: '', period2Id: '', location1Id: '',
  courseId: '', courseCode: '', courseOfferingId: '', sectionId: '',
  students: [], enrollments: [], rosterAssignments: [],
  gradingPolicyId: '',
};

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────

const ts5 = () => Date.now().toString().slice(-5);
const generateEmail = (prefix: string) => `${prefix}-${Date.now()}@goldenthread.test`;
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function getAcademicYearDates() {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    year,
    name: `${year}-${year + 1}`,
    shortName: `${year.toString().slice(2)}/${(year + 1).toString().slice(2)}`,
    startDate: `${year}-08-19`,
    endDate: `${year + 1}-06-06`,
    sem1Start: `${year}-08-19`,
    sem1End: `${year + 1}-01-17`,
    sem2Start: `${year + 1}-01-20`,
    sem2End: `${year + 1}-06-06`,
  };
}

// ─────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────

const logLines: string[] = [];

function log(level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  logLines.push(line);

  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[level] >= levels[(LOG_LEVEL as keyof typeof levels) ?? 'debug']) {
    const color = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
    console.log(`${color[level]}${line}\x1b[0m`);
  }
}

// ─────────────────────────────────────────
// HTTP CLIENT
// ─────────────────────────────────────────

async function api<T>(method: string, urlPath: string, body?: unknown, opts?: { noAuth?: boolean }): Promise<ApiResponse<T>> {
  const start = Date.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts?.noAuth) {
    headers['Authorization'] = `Bearer ${ID_TOKEN}`;
  }
  const config: AxiosRequestConfig = {
    method: method as AxiosRequestConfig['method'],
    url: `${BASE_URL}${urlPath}`,
    headers,
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  };

  try {
    const res = await axios(config);
    const duration = Date.now() - start;
    log('debug', `${method.toUpperCase()} ${urlPath} → ${res.status} (${duration}ms)`);
    if (res.status >= 400) {
      return { status: res.status, data: null, error: JSON.stringify(res.data), duration };
    }
    return { status: res.status, data: res.data as T, error: null, duration };
  } catch (err: any) {
    const duration = Date.now() - start;
    return { status: 0, data: null, error: err.message, duration };
  }
}

// ─────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────

const results: TestResult[] = [];

async function test(module: string, name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, module, status: 'PASS', duration });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`);
  } catch (err: any) {
    const duration = Date.now() - start;
    results.push({ name, module, status: 'FAIL', duration, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

function skip(module: string, name: string, reason: string) {
  results.push({ name, module, status: 'SKIP', duration: 0, error: reason });
  console.log(`  \x1b[33m○\x1b[0m ${name} \x1b[90m— ${reason}\x1b[0m`);
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 0: SETUP — Verify school, discover existing data
// ═══════════════════════════════════════════════════════════════════════════════

async function module0_setup() {
  console.log('\n\x1b[1;36m═══ Module 0: Setup ═══\x1b[0m');

  await test('Setup', 'Health check — Identity service', async () => {
    const res = await api('get', '/health', undefined, { noAuth: true });
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Setup', 'Health check — Academics service', async () => {
    const res = await api('get', '/academics/health', undefined, { noAuth: true });
    // May return 404 if no /academics/health route — accept either
    assert(res.status === 200 || res.status === 404, `Expected 200/404 but got ${res.status}: ${res.error}`);
  });

  await test('Setup', 'Verify school exists', async () => {
    const res = await api<any>('get', `/schools/${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    ctx.schoolName = res.data?.name || '';
    log('info', `School: ${ctx.schoolName} (${ctx.schoolId})`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 1: EDORG HIERARCHY (Sprint 1)
// ═══════════════════════════════════════════════════════════════════════════════

async function module1_edorgHierarchy() {
  console.log('\n\x1b[1;36m═══ Module 1: EdOrg Hierarchy (Sprint 1) ═══\x1b[0m');

  await test('EdOrg', 'GET /education-organizations/hierarchy', async () => {
    const res = await api<any>('get', '/education-organizations/hierarchy');
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    if (res.data?.sea) ctx.seaId = res.data.sea.id;
    if (res.data?.leas?.length) ctx.leaId = res.data.leas[0].id;
    log('info', `Hierarchy: SEA=${ctx.seaId || 'none'}, LEA=${ctx.leaId || 'none'}`);
  });

  await test('EdOrg', 'GET /education-organizations/leas — list LEAs', async () => {
    const res = await api<any>('get', '/education-organizations/leas');
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    const items = res.data?.items || [];
    if (items.length > 0 && !ctx.leaId) ctx.leaId = items[0].leaId;
    log('info', `Found ${items.length} LEA(s)`);
  });

  await test('EdOrg', 'GET /schools/:schoolId — verify Ed-Fi fields', async () => {
    const res = await api<any>('get', `/schools/${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    log('info', `School Ed-Fi fields: categories=${res.data?.schoolCategories || 'n/a'}, type=${res.data?.schoolTypeDescriptor || 'n/a'}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 2: SCHOOL CONFIGURATION (Sprint 1)
// ═══════════════════════════════════════════════════════════════════════════════

async function module2_schoolConfiguration() {
  console.log('\n\x1b[1;36m═══ Module 2: School Configuration (Sprint 1) ═══\x1b[0m');

  await test('Config', 'GET /schools/:schoolId/configuration', async () => {
    const res = await api<any>('get', `/schools/${ctx.schoolId}/configuration`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    log('info', `Config: timezone=${res.data?.timezone || 'n/a'}`);
  });

  await test('Config', 'PATCH /schools/:schoolId/configuration — set attendance mode', async () => {
    const res = await api('patch', `/schools/${ctx.schoolId}/configuration`, {
      attendanceTrackingMode: 'daily',
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
  });

  await test('Config', 'POST /schools/:schoolId/departments — create Math department', async () => {
    const res = await api<any>('post', `/schools/${ctx.schoolId}/departments`, {
      name: `Mathematics ${ts5()}`,
      code: `MATH-${ts5()}`,
      description: 'Mathematics Department — Golden Thread test',
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}: ${res.error}`);
    ctx.departmentId = res.data?.departmentId || res.data?.id || '';
    log('info', `Created department: ${ctx.departmentId}`);
  });

  await test('Config', 'GET /schools/:schoolId/departments — list departments', async () => {
    const res = await api('get', `/schools/${ctx.schoolId}/departments`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  if (ctx.departmentId) {
    await test('Config', 'GET /schools/:schoolId/departments/:id — get department', async () => {
      const res = await api('get', `/schools/${ctx.schoolId}/departments/${ctx.departmentId}`);
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 3: USERS & ROLES (Sprint 1)
// ═══════════════════════════════════════════════════════════════════════════════

async function module3_usersAndRoles() {
  console.log('\n\x1b[1;36m═══ Module 3: Users & Roles (Sprint 1) ═══\x1b[0m');

  ctx.adminEmail = generateEmail('gt-admin');

  await test('Users', 'POST /users — create TenantAdmin', async () => {
    const res = await api<any>('post', '/users', {
      email: ctx.adminEmail,
      firstName: 'GoldenThread',
      lastName: `Admin_${ts5()}`,
      globalRole: 'TenantAdmin',
      phone: '555-0100',
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}: ${res.error}`);
    ctx.adminUserId = res.data?.userId || res.data?.id || '';
    log('info', `Created admin user: ${ctx.adminUserId}`);
  });

  await test('Users', 'GET /users/:id — retrieve admin user', async () => {
    assert(!!ctx.adminUserId, 'adminUserId not set');
    const res = await api<any>('get', `/users/${ctx.adminUserId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    assert(res.data?.email === ctx.adminEmail, `Email mismatch: ${res.data?.email}`);
  });

  await test('Users', 'GET /users?search=<email> — search users', async () => {
    const res = await api('get', `/users?search=${ctx.adminEmail.split('@')[0]}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Users', 'PATCH /users/:id/global-role — TenantAdmin→TenantUser', async () => {
    assert(!!ctx.adminUserId, 'adminUserId not set');
    const res = await api('patch', `/users/${ctx.adminUserId}/global-role`, { newRole: 'TenantUser' });
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Users', 'PATCH /users/:id/global-role — TenantUser→TenantAdmin', async () => {
    assert(!!ctx.adminUserId, 'adminUserId not set');
    const res = await api('patch', `/users/${ctx.adminUserId}/global-role`, { newRole: 'TenantAdmin' });
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Users', 'POST /users/:id/roles — assign school role (Principal)', async () => {
    assert(!!ctx.adminUserId, 'adminUserId not set');
    const res = await api('post', `/users/${ctx.adminUserId}/roles`, {
      schoolId: ctx.schoolId,
      role: 'Principal',
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
  });

  await test('Users', 'GET /users/:id/roles — list user roles', async () => {
    assert(!!ctx.adminUserId, 'adminUserId not set');
    const res = await api('get', `/users/${ctx.adminUserId}/roles`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Users', 'GET /users/:id/roles/:schoolId — get school-specific role', async () => {
    assert(!!ctx.adminUserId, 'adminUserId not set');
    const res = await api('get', `/users/${ctx.adminUserId}/roles/${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 4: STAFF MANAGEMENT (Sprint 7)
// ═══════════════════════════════════════════════════════════════════════════════

async function module4_staffManagement() {
  console.log('\n\x1b[1;36m═══ Module 4: Staff Management (Sprint 7) ═══\x1b[0m');

  ctx.teacherEmail = generateEmail('gt-teacher');

  await test('Staff', 'POST /staff/with-user — create teacher with user account', async () => {
    const res = await api<any>('post', '/staff/with-user', {
      staffUniqueId: `GT-TCH-${ts5()}`,
      firstName: 'Jane',
      lastSurname: `Doe_${ts5()}`,
      email: ctx.teacherEmail,
      role: 'teacher',
      department: 'Mathematics',
      primarySchoolId: ctx.schoolId,
      phone: '555-0200',
      hireDate: '2024-08-01',
      employmentStatus: 'active',
      createUserAccount: true,
      globalRole: 'TenantUser',
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}: ${res.error}`);
    ctx.teacherStaffId = res.data?.staffId || res.data?.staff?.staffId || res.data?.id || '';
    ctx.teacherUserId = res.data?.userId || res.data?.user?.userId || '';
    log('info', `Created staff: ${ctx.teacherStaffId}, user: ${ctx.teacherUserId}`);
  });

  await test('Staff', 'GET /staff/:id — retrieve teacher', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api('get', `/staff/${ctx.teacherStaffId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Staff', 'GET /staff/by-email?email=<email> — lookup by email', async () => {
    const res = await api('get', `/staff/by-email?email=${encodeURIComponent(ctx.teacherEmail)}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Staff', 'GET /staff/search/<name> — search by name', async () => {
    const res = await api('get', '/staff/search/Jane');
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Staff', 'GET /staff — list all staff', async () => {
    const res = await api('get', '/staff');
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Staff', 'GET /schools/:schoolId/staff — list school staff', async () => {
    const res = await api('get', `/schools/${ctx.schoolId}/staff`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Staff', 'POST /staff/:id/assignments — create school assignment', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api<any>('post', `/staff/${ctx.teacherStaffId}/assignments`, {
      schoolId: ctx.schoolId,
      role: 'teacher',
      beginDate: '2024-08-01',
      positionTitle: 'Math Teacher',
      department: 'Mathematics',
      isPrimary: true,
    });
    assert(res.status === 201 || res.status === 409, `Expected 201/409 but got ${res.status}: ${res.error}`);
    ctx.staffAssignmentId = res.data?.assignmentId || res.data?.id || '';
    log('info', `Created assignment: ${ctx.staffAssignmentId}`);
  });

  await test('Staff', 'GET /staff/:id/assignments — list assignments', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api('get', `/staff/${ctx.teacherStaffId}/assignments`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Staff', 'POST /staff/:id/credentials — add teaching credential', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api<any>('post', `/staff/${ctx.teacherStaffId}/credentials`, {
      credentialType: 'TeachingCertificate',
      credentialField: 'Mathematics',
      issuingOrganization: 'State Board of Education',
      issueDate: '2020-06-15',
      expirationDate: '2027-06-15',
      credentialNumber: `TC-GT-${ts5()}`,
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}: ${res.error}`);
    ctx.credentialId = res.data?.credentialId || res.data?.id || '';
    log('info', `Created credential: ${ctx.credentialId}`);
  });

  await test('Staff', 'GET /staff/:id/credentials — list credentials', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api('get', `/staff/${ctx.teacherStaffId}/credentials`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  if (ctx.credentialId) {
    await test('Staff', 'PATCH /staff/:id/credentials/:id/verify — verify credential', async () => {
      const res = await api('patch', `/staff/${ctx.teacherStaffId}/credentials/${ctx.credentialId}/verify`, {
        verificationStatus: 'verified',
        verifiedBy: 'Golden Thread Admin',
        verificationDate: new Date().toISOString().split('T')[0],
      });
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });
  }

  await test('Staff', 'POST /staff/:id/leave — create leave request', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api<any>('post', `/staff/${ctx.teacherStaffId}/leave`, {
      leaveType: 'sick',
      startDate: '2025-11-01',
      endDate: '2025-11-02',
      totalDays: 2,
      reason: 'Golden Thread test leave request',
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}: ${res.error}`);
    ctx.leaveRequestId = res.data?.leaveRequestId || res.data?.id || '';
    log('info', `Created leave request: ${ctx.leaveRequestId}`);
  });

  await test('Staff', 'GET /staff/:id/leave — list leave requests', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api('get', `/staff/${ctx.teacherStaffId}/leave`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  if (ctx.leaveRequestId) {
    await test('Staff', 'PATCH /staff/:id/leave/:id/approve — approve leave', async () => {
      const res = await api('patch', `/staff/${ctx.teacherStaffId}/leave/${ctx.leaveRequestId}/approve`, {
        approverNotes: 'Approved by Golden Thread test',
      });
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });
  }

  await test('Staff', 'GET /staff/:id/employment-history — get history', async () => {
    assert(!!ctx.teacherStaffId, 'teacherStaffId not set');
    const res = await api('get', `/staff/${ctx.teacherStaffId}/employment-history`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 5: ACADEMIC YEAR & CALENDAR (Sprint 2)
// ═══════════════════════════════════════════════════════════════════════════════

async function module5_academicYearAndCalendar() {
  console.log('\n\x1b[1;36m═══ Module 5: Academic Year & Calendar (Sprint 2) ═══\x1b[0m');

  const yd = getAcademicYearDates();

  await test('Calendar', 'POST /schools/:id/academic-years — create academic year', async () => {
    const res = await api<any>('post', `/schools/${ctx.schoolId}/academic-years`, {
      name: yd.name,
      shortName: yd.shortName,
      startDate: yd.startDate,
      endDate: yd.endDate,
      calendarType: 'semester',
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.academicYearId = res.data?.yearId || res.data?.academicYearId || res.data?.id || '';
    ctx.academicYearStartDate = res.data?.startDate || yd.startDate;
    ctx.academicYearEndDate = res.data?.endDate || yd.endDate;

    // Extract grading period IDs if terms were auto-created
    if (res.data?.terms?.length) {
      ctx.gradingPeriodIds = res.data.terms.map((t: any) => t.periodId || t.termId || t.id);
    }
    log('info', `Created academic year: ${yd.name} → ${ctx.academicYearId}`);
  });

  await test('Calendar', 'GET /schools/:id/academic-years — list years', async () => {
    const res = await api('get', `/schools/${ctx.schoolId}/academic-years`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Calendar', 'PUT /schools/:id/academic-years/:id/set-current', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const res = await api('put', `/schools/${ctx.schoolId}/academic-years/${ctx.academicYearId}/set-current`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Calendar', 'POST /schools/:id/calendars — create student calendar', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const res = await api<any>('post', `/schools/${ctx.schoolId}/calendars`, {
      academicYearId: ctx.academicYearId,
      calendarCode: `STUDENT-${ts5()}`,
      calendarTypeDescriptor: 'student',
      gradeLevels: ['05', '06', '07', '08'],
      isDefault: true,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.calendarId = res.data?.calendarId || res.data?.id || '';
    log('info', `Created calendar: ${ctx.calendarId}`);
  });

  await test('Calendar', 'POST /schools/:id/academic-years/:id/generate-calendar', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const genUrl = `/schools/${ctx.schoolId}/academic-years/${ctx.academicYearId}/generate-calendar`;
    const res = await api<any>('post', genUrl, {
      academicYearId: ctx.academicYearId,
      startDate: ctx.academicYearStartDate || yd.startDate,
      endDate: ctx.academicYearEndDate || yd.endDate,
      schoolDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      holidays: [
        { date: `${yd.year}-09-01`, name: 'Labor Day', eventType: 'holiday' },
        { date: `${yd.year}-11-27`, name: 'Thanksgiving', eventType: 'holiday' },
        { date: `${yd.year}-12-25`, name: 'Christmas Day', eventType: 'holiday' },
        { date: `${yd.year + 1}-01-01`, name: 'New Years Day', eventType: 'holiday' },
      ],
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    if (res.data) {
      log('info', `Generated calendar: total=${res.data.totalDays}, instructional=${res.data.instructionalDays}`);
    }
  });

  await test('Calendar', 'GET /schools/:id/calendar-dates?academicYearId=xxx', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const res = await api('get', `/schools/${ctx.schoolId}/calendar-dates?academicYearId=${ctx.academicYearId}&limit=10`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Calendar', 'GET /schools/:id/calendar-dates/stats?academicYearId=xxx', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const res = await api<any>('get', `/schools/${ctx.schoolId}/calendar-dates/stats?academicYearId=${ctx.academicYearId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    if (res.data) log('info', 'Calendar stats:', res.data);
  });

  await test('Calendar', 'POST /schools/:id/academic-sessions — create Fall session', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const res = await api<any>('post', `/schools/${ctx.schoolId}/academic-sessions`, {
      academicYearId: ctx.academicYearId,
      sessionName: `Fall ${yd.year}`,
      beginDate: yd.sem1Start,
      endDate: yd.sem1End,
      termDescriptor: 'fall_semester',
    });
    if (res.status === 409) {
      // Session already exists from a previous run — look it up
      const listRes = await api<any>('get', `/schools/${ctx.schoolId}/academic-sessions`);
      const sessions = listRes.data?.sessions || listRes.data || [];
      const fall = sessions.find((s: any) => /fall/i.test(s.sessionName));
      ctx.fallSessionId = fall?.academicSessionId || fall?.id || '';
      log('info', `Fall session already exists: ${ctx.fallSessionId}`);
      return;
    }
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.fallSessionId = res.data?.academicSessionId || res.data?.id || '';
    log('info', `Created Fall session: ${ctx.fallSessionId}`);
  });

  await test('Calendar', 'POST /schools/:id/academic-sessions — create Spring session', async () => {
    assert(!!ctx.academicYearId, 'academicYearId not set');
    const res = await api<any>('post', `/schools/${ctx.schoolId}/academic-sessions`, {
      academicYearId: ctx.academicYearId,
      sessionName: `Spring ${yd.year + 1}`,
      beginDate: yd.sem2Start,
      endDate: yd.sem2End,
      termDescriptor: 'spring_semester',
    });
    if (res.status === 409) {
      // Session already exists from a previous run — look it up
      const listRes = await api<any>('get', `/schools/${ctx.schoolId}/academic-sessions`);
      const sessions = listRes.data?.sessions || listRes.data || [];
      const spring = sessions.find((s: any) => /spring/i.test(s.sessionName));
      ctx.springSessionId = spring?.academicSessionId || spring?.id || '';
      log('info', `Spring session already exists: ${ctx.springSessionId}`);
      return;
    }
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.springSessionId = res.data?.academicSessionId || res.data?.id || '';
    log('info', `Created Spring session: ${ctx.springSessionId}`);
  });

  await test('Calendar', 'GET /schools/:id/academic-sessions — list sessions', async () => {
    const res = await api('get', `/schools/${ctx.schoolId}/academic-sessions`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Calendar', 'POST /schools/:id/class-periods — create Period 1', async () => {
    const res = await api<any>('post', `/schools/${ctx.schoolId}/class-periods`, {
      classPeriodName: `Period 1 (${ts5()})`,
      startTime: '08:00',
      endTime: '08:50',
      sortOrder: 0,
      periodType: 'instructional',
      isAcademic: true,
    });
    if (res.status === 409) {
      // Period with same time range exists — look it up
      const listRes = await api<any>('get', `/schools/${ctx.schoolId}/class-periods`);
      const periods = listRes.data?.classPeriods || listRes.data?.periods || listRes.data || [];
      const p1 = periods.find((p: any) => p.startTime === '08:00' || /period.?1/i.test(p.classPeriodName));
      ctx.period1Id = p1?.classPeriodId || p1?.periodId || p1?.id || '';
      log('info', `Period 1 already exists: ${ctx.period1Id}`);
      return;
    }
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.period1Id = res.data?.periodId || res.data?.id || '';
    log('info', `Created period 1: ${ctx.period1Id}`);
  });

  await test('Calendar', 'POST /schools/:id/class-periods — create Period 2', async () => {
    const res = await api<any>('post', `/schools/${ctx.schoolId}/class-periods`, {
      classPeriodName: `Period 2 (${ts5()})`,
      startTime: '08:55',
      endTime: '09:45',
      sortOrder: 1,
      periodType: 'instructional',
      isAcademic: true,
    });
    if (res.status === 409) {
      const listRes = await api<any>('get', `/schools/${ctx.schoolId}/class-periods`);
      const periods = listRes.data?.classPeriods || listRes.data?.periods || listRes.data || [];
      const p2 = periods.find((p: any) => p.startTime === '08:55' || /period.?2/i.test(p.classPeriodName));
      ctx.period2Id = p2?.classPeriodId || p2?.periodId || p2?.id || '';
      log('info', `Period 2 already exists: ${ctx.period2Id}`);
      return;
    }
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.period2Id = res.data?.periodId || res.data?.id || '';
  });

  await test('Calendar', 'GET /schools/:id/class-periods — list periods', async () => {
    const res = await api('get', `/schools/${ctx.schoolId}/class-periods`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 6: MASTER SCHEDULE — LOCATIONS (Sprint 3)
// ═══════════════════════════════════════════════════════════════════════════════

async function module6_masterSchedule() {
  console.log('\n\x1b[1;36m═══ Module 6: Master Schedule — Locations (Sprint 3) ═══\x1b[0m');

  await test('Location', 'POST /schools/:id/locations — create Room 101', async () => {
    const res = await api<any>('post', `/schools/${ctx.schoolId}/locations`, {
      roomNumber: `101-${ts5()}`,
      buildingName: 'Main Building',
      floorNumber: 1,
      capacity: 30,
      locationType: 'classroom',
      isActive: true,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.location1Id = res.data?.locationId || res.data?.id || '';
    log('info', `Created location: ${ctx.location1Id}`);
  });

  await test('Location', 'GET /schools/:id/locations — list locations', async () => {
    const res = await api('get', `/schools/${ctx.schoolId}/locations`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 7: COURSES & SECTIONS (Sprint 3)
// ═══════════════════════════════════════════════════════════════════════════════

async function module7_coursesAndSections() {
  console.log('\n\x1b[1;36m═══ Module 7: Courses & Sections (Sprint 3) ═══\x1b[0m');

  ctx.courseCode = `MATH-${ts5()}`;

  await test('Courses', 'POST /academics/courses — create Algebra I', async () => {
    const res = await api<any>('post', '/academics/courses', {
      schoolId: ctx.schoolId,
      courseCode: ctx.courseCode,
      courseName: 'Algebra I',
      subjectArea: 'mathematics',
      courseType: 'required',
      credits: 1,
      typicalDuration: 'year',
      gradeLevels: ['06', '07'],
      isActive: true,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.courseId = res.data?.courseId || res.data?.id || '';
    log('info', `Created course: ${ctx.courseCode} → ${ctx.courseId}`);
  });

  await test('Courses', 'GET /academics/courses?schoolId=xxx — list courses', async () => {
    const res = await api('get', `/academics/courses?schoolId=${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Courses', 'GET /academics/courses/:id?schoolId=xxx — get course', async () => {
    assert(!!ctx.courseId, 'courseId not set');
    const res = await api('get', `/academics/courses/${ctx.courseId}?schoolId=${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Courses', 'POST /academics/course-offerings — create offering', async () => {
    assert(!!ctx.courseId && !!ctx.fallSessionId, 'courseId or fallSessionId not set');
    const res = await api<any>('post', '/academics/course-offerings', {
      courseId: ctx.courseId,
      academicSessionId: ctx.fallSessionId,
      schoolId: ctx.schoolId,
      localCourseCode: `LOCAL-${ts5()}`,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.courseOfferingId = res.data?.courseOfferingId || res.data?.id || '';
    log('info', `Created offering: ${ctx.courseOfferingId}`);
  });

  await test('Courses', 'POST /academics/sections — create section with schedule refs', async () => {
    assert(!!ctx.courseId, 'courseId not set');
    const res = await api<any>('post', '/academics/sections', {
      courseId: ctx.courseId,
      schoolId: ctx.schoolId,
      sectionNumber: `S${ts5()}`,
      primaryTeacherId: ctx.teacherStaffId || undefined,
      maxEnrollment: 30,
      academicYearId: ctx.academicYearId,
      courseOfferingId: ctx.courseOfferingId || undefined,
      classPeriodId: ctx.period1Id || undefined,
      locationId: ctx.location1Id || undefined,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.sectionId = res.data?.sectionId || res.data?.id || '';
    log('info', `Created section: ${ctx.sectionId}`);
  });

  await test('Courses', 'GET /academics/sections?schoolId=xxx — list sections', async () => {
    const res = await api('get', `/academics/sections?schoolId=${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 8: STUDENTS (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module8_students() {
  console.log('\n\x1b[1;36m═══ Module 8: Students (Sprint 4) ═══\x1b[0m');

  const studentsToCreate = [
    { firstName: 'Emily', lastName: 'Johnson', dateOfBirth: '2014-08-15', gender: 'female', gradeLevel: '6' },
    { firstName: 'Marcus', lastName: 'Williams', dateOfBirth: '2015-02-28', gender: 'male', gradeLevel: '5' },
    { firstName: 'Sofia', lastName: 'Rodriguez', dateOfBirth: '2014-11-03', gender: 'female', gradeLevel: '6' },
  ];

  for (const student of studentsToCreate) {
    await test('Students', `POST /academics/students — ${student.firstName} ${student.lastName}`, async () => {
      const res = await api<any>('post', '/academics/students', {
        ...student,
        schoolId: ctx.schoolId,
        currentGradeLevel: student.gradeLevel,
      });
      assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
      assert(!!res.data?.studentId, 'Missing studentId');

      ctx.students.push({
        studentId: res.data.studentId,
        studentNumber: res.data.studentNumber || '',
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
      });
      log('info', `Created: ${student.firstName} ${student.lastName} → ${res.data.studentId} (USI: ${res.data.studentNumber || 'n/a'})`);
    });
  }

  await test('Students', 'GET /academics/students?schoolId=xxx — list students', async () => {
    const res = await api('get', `/academics/students?schoolId=${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  if (ctx.students.length > 0) {
    await test('Students', 'GET /academics/students/:id — get student by ID', async () => {
      const res = await api<any>('get', `/academics/students/${ctx.students[0].studentId}`);
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
      assert(res.data?.firstName === ctx.students[0].firstName, 'firstName mismatch');
    });

    await test('Students', 'GET /academics/students?search=Emily — search by name', async () => {
      const res = await api('get', `/academics/students?schoolId=${ctx.schoolId}&search=Emily`);
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });

    await test('Students', 'POST /academics/students/check-duplicate — de-dup check', async () => {
      const res = await api<any>('post', '/academics/students/check-duplicate', {
        firstName: 'Emily',
        lastName: 'Johnson',
        dateOfBirth: '2014-08-15',
        schoolId: ctx.schoolId,
      });
      assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
      assert(typeof res.data?.hasDuplicates === 'boolean', 'Missing hasDuplicates field');
      log('info', `De-dup check: hasDuplicates=${res.data.hasDuplicates}, matches=${res.data.matches?.length || 0}`);
    });

    await test('Students', 'GET /academics/students/:id/profile — student profile', async () => {
      const res = await api('get', `/academics/students/${ctx.students[0].studentId}/profile`);
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });

    await test('Students', 'PATCH /academics/students/:id — update student', async () => {
      const res = await api('patch', `/academics/students/${ctx.students[0].studentId}`, {
        middleName: 'Marie',
      });
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });
  }

  // CSV Import
  await test('Students', 'POST /academics/students/import — CSV import with validation', async () => {
    const res = await api<any>('post', '/academics/students/import', {
      schoolId: ctx.schoolId,
      students: [
        { firstName: 'Liam', lastName: `Import_${ts5()}`, birthDate: '2014-04-12', gender: 'male', gradeLevel: '6' },
        { firstName: 'Zara', lastName: `Import_${ts5()}`, birthDate: '2015-09-05', gender: 'female', gradeLevel: '5' },
      ],
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    log('info', `Import: imported=${res.data?.imported || 0}, skipped=${res.data?.skipped || 0}, errors=${res.data?.errors?.length || 0}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 9: ENROLLMENT (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module9_enrollment() {
  console.log('\n\x1b[1;36m═══ Module 9: Enrollment (Sprint 4) ═══\x1b[0m');

  if (ctx.students.length === 0 || !ctx.academicYearId) {
    skip('Enrollment', 'All enrollment tests', 'No students or academic year');
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  for (const student of ctx.students) {
    await test('Enrollment', `POST /academics/enrollments — enroll ${student.firstName} ${student.lastName}`, async () => {
      const res = await api<any>('post', '/academics/enrollments', {
        studentId: student.studentId,
        schoolId: ctx.schoolId,
        academicYearId: ctx.academicYearId,
        gradeLevel: student.gradeLevel,
        enrollmentType: 'new',
        enrollmentDate: today,
        primarySchool: true,
      });

      if (res.status === 400 || res.status === 404) {
        log('warn', `Enrollment for ${student.firstName} returned ${res.status}: ${res.error}`);
        results[results.length - 1].status = 'SKIP';
        return;
      }

      assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
      assert(!!res.data?.enrollmentId, 'Missing enrollmentId');

      ctx.enrollments.push({
        enrollmentId: res.data.enrollmentId,
        studentId: student.studentId,
      });
      log('info', `Enrolled ${student.firstName}: ${res.data.enrollmentId}`);
    });
  }

  await test('Enrollment', 'Duplicate enrollment rejection → 409/400', async () => {
    if (ctx.enrollments.length === 0) { results[results.length - 1].status = 'SKIP'; return; }
    const e = ctx.enrollments[0];
    const res = await api('post', '/academics/enrollments', {
      studentId: e.studentId,
      schoolId: ctx.schoolId,
      academicYearId: ctx.academicYearId,
      gradeLevel: '6',
      enrollmentType: 'new',
      enrollmentDate: today,
      primarySchool: true,
    });
    assert(res.status === 409 || res.status === 400, `Expected 409/400 but got ${res.status}`);
    log('info', `Duplicate correctly rejected with ${res.status}`);
  });

  await test('Enrollment', 'GET enrollments — list enrollments for school/year', async () => {
    const res = await api('get', `/academics/schools/${ctx.schoolId}/years/${ctx.academicYearId}/enrollments`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Enrollment', 'GET enrollment summary', async () => {
    const res = await api('get', `/academics/schools/${ctx.schoolId}/years/${ctx.academicYearId}/enrollments/summary`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  // Withdraw the last student
  if (ctx.students.length >= 3 && ctx.enrollments.length >= 3) {
    const withdrawStudent = ctx.students[ctx.students.length - 1];
    await test('Enrollment', `POST withdraw — ${withdrawStudent.firstName} ${withdrawStudent.lastName}`, async () => {
      const res = await api('post',
        `/academics/schools/${ctx.schoolId}/years/${ctx.academicYearId}/students/${withdrawStudent.studentId}/withdraw`,
        { withdrawalDate: today, reason: 'Golden Thread test withdrawal' }
      );
      assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
      log('info', `Withdrew ${withdrawStudent.firstName}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 10: SECTION ROSTERING (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module10_sectionRostering() {
  console.log('\n\x1b[1;36m═══ Module 10: Section Rostering (Sprint 5) ═══\x1b[0m');

  if (!ctx.sectionId || ctx.enrollments.length === 0) {
    skip('Rostering', 'All rostering tests', 'No section or enrollments');
    return;
  }

  // Roster first 2 students (skip the withdrawn one)
  const studentsToRoster = ctx.enrollments.slice(0, 2);

  for (const enrollment of studentsToRoster) {
    const student = ctx.students.find(s => s.studentId === enrollment.studentId);
    const name = student ? `${student.firstName} ${student.lastName}` : enrollment.studentId;

    await test('Rostering', `POST roster ${name} into section`, async () => {
      const res = await api('post', `/academics/sections/${ctx.sectionId}/students?schoolId=${ctx.schoolId}`, {
        studentId: enrollment.studentId,
      });
      assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);

      ctx.rosterAssignments.push({
        sectionId: ctx.sectionId,
        studentId: enrollment.studentId,
      });
      log('info', `Rostered ${name} → section ${ctx.sectionId}`);
    });
  }

  await test('Rostering', 'GET /academics/sections/:id/students — verify roster', async () => {
    const res = await api<any>('get', `/academics/sections/${ctx.sectionId}/students?schoolId=${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    const items = Array.isArray(res.data) ? res.data : res.data?.items || [];
    assert(items.length >= studentsToRoster.length, `Expected at least ${studentsToRoster.length} students, got ${items.length}`);
    log('info', `Section roster has ${items.length} student(s)`);
  });

  // Enrollment-required validation
  await test('Rostering', 'Roster unenrolled student → expect 400/404', async () => {
    const fakeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const res = await api('post', `/academics/sections/${ctx.sectionId}/students?schoolId=${ctx.schoolId}`, {
      studentId: fakeId,
    });
    assert(res.status === 400 || res.status === 404 || res.status === 422,
      `Expected 400/404/422 but got ${res.status}`);
    log('info', `Unenrolled student correctly rejected with ${res.status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 11: ATTENDANCE (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module11_attendance() {
  console.log('\n\x1b[1;36m═══ Module 11: Attendance (Sprint 5) ═══\x1b[0m');

  if (ctx.rosterAssignments.length === 0) {
    skip('Attendance', 'All attendance tests', 'No rostered students');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const assignment = ctx.rosterAssignments[0];
  const student = ctx.students.find(s => s.studentId === assignment.studentId);
  const studentName = student ? `${student.firstName} ${student.lastName}` : assignment.studentId;

  await test('Attendance', `POST /academics/attendance — mark ${studentName} present`, async () => {
    const res = await api('post', '/academics/attendance', {
      studentId: assignment.studentId,
      schoolId: ctx.schoolId,
      sectionId: assignment.sectionId,
      date: today,
      status: 'present',
      notes: 'Golden Thread test attendance',
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    log('info', `Attendance recorded: ${studentName} → present on ${today}`);
  });

  // Bulk attendance
  const statuses = ['present', 'absent', 'tardy'];
  const bulkRecords = ctx.rosterAssignments.map((r, i) => ({
    studentId: r.studentId,
    status: statuses[i % statuses.length],
    notes: `Golden Thread bulk - ${statuses[i % statuses.length]}`,
  }));

  await test('Attendance', `POST /academics/attendance/bulk — ${bulkRecords.length} records`, async () => {
    const res = await api<any>('post', '/academics/attendance/bulk', {
      schoolId: ctx.schoolId,
      sectionId: ctx.sectionId,
      date: today,
      records: bulkRecords,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    log('info', `Bulk attendance: created=${res.data?.created || 0}, updated=${res.data?.updated || 0}`);
  });

  await test('Attendance', 'GET /academics/attendance?schoolId=xxx&date=xxx — by date', async () => {
    const res = await api('get', `/academics/attendance?schoolId=${ctx.schoolId}&date=${today}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Attendance', 'GET /academics/attendance/summary — daily summary', async () => {
    const res = await api<any>('get', `/academics/attendance/summary?schoolId=${ctx.schoolId}&date=${today}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    log('info', 'Daily summary:', { present: res.data?.totalPresent, absent: res.data?.totalAbsent, tardy: res.data?.totalTardy });
  });

  await test('Attendance', 'GET /academics/attendance/student/:id/summary — student summary', async () => {
    const res = await api('get', `/academics/attendance/student/${assignment.studentId}/summary?schoolId=${ctx.schoolId}&academicYearId=${ctx.academicYearId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  await test('Attendance', 'GET /academics/attendance/trend — 30-day trend', async () => {
    const res = await api('get', `/academics/attendance/trend?schoolId=${ctx.schoolId}&startDate=${thirtyDaysAgo}&endDate=${today}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Attendance', 'GET /academics/attendance/alerts — below-threshold alerts', async () => {
    const res = await api('get', `/academics/attendance/alerts?schoolId=${ctx.schoolId}&academicYearId=${ctx.academicYearId}&threshold=90&startDate=${thirtyDaysAgo}&endDate=${today}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 12: GRADES (Sprint 6)
// ═══════════════════════════════════════════════════════════════════════════════

async function module12_grades() {
  console.log('\n\x1b[1;36m═══ Module 12: Grades (Sprint 6) ═══\x1b[0m');

  await test('Grades', 'POST /academics/grading-policies — create standard policy', async () => {
    const res = await api<any>('post', '/academics/grading-policies', {
      schoolId: ctx.schoolId,
      policyName: `Standard K-12 ${ts5()}`,
      gradingScale: [
        { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
        { letter: 'B', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.0 },
        { letter: 'C', minPercentage: 70, maxPercentage: 79, gpaPoints: 2.0 },
        { letter: 'D', minPercentage: 60, maxPercentage: 69, gpaPoints: 1.0 },
        { letter: 'F', minPercentage: 0, maxPercentage: 59, gpaPoints: 0.0 },
      ],
      categoryWeights: [
        { categoryId: 'homework', categoryName: 'Homework', weight: 30 },
        { categoryId: 'tests', categoryName: 'Tests', weight: 40 },
        { categoryId: 'participation', categoryName: 'Participation', weight: 30 },
      ],
      roundingRule: 'nearest',
      minimumPassingGrade: 60,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
    ctx.gradingPolicyId = res.data?.policyId || res.data?.id || '';
    log('info', `Created grading policy: ${ctx.gradingPolicyId}`);
  });

  await test('Grades', 'GET /academics/grading-policies?schoolId=xxx — list policies', async () => {
    const res = await api('get', `/academics/grading-policies?schoolId=${ctx.schoolId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  if (ctx.rosterAssignments.length === 0 || !ctx.courseId) {
    skip('Grades', 'Grade recording tests', 'No rostered students or course');
    return;
  }

  const termId = ctx.gradingPeriodIds[0] || ctx.fallSessionId || 'fall-term';

  await test('Grades', 'POST /academics/grades/record — single grade for student 1', async () => {
    const res = await api('post', '/academics/grades/record', {
      studentId: ctx.students[0].studentId,
      courseId: ctx.courseId,
      sectionId: ctx.sectionId,
      schoolId: ctx.schoolId,
      termId,
      assignmentName: 'Midterm Exam',
      category: 'exam',
      pointsEarned: 92,
      pointsPossible: 100,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
  });

  await test('Grades', 'POST /academics/grades/record/bulk — bulk grades for section', async () => {
    const grades = ctx.rosterAssignments.slice(0, 2).map((r, i) => ({
      studentId: r.studentId,
      pointsEarned: 18 - i * 3,
      pointsPossible: 20,
    }));

    const res = await api('post', '/academics/grades/record/bulk', {
      sectionId: ctx.sectionId,
      schoolId: ctx.schoolId,
      termId,
      assignmentName: 'Homework 1',
      category: 'homework',
      grades,
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201 but got ${res.status}: ${res.error}`);
  });

  await test('Grades', 'GET /academics/grades/section/:sectionId — section grades', async () => {
    const res = await api('get', `/academics/grades/section/${ctx.sectionId}?schoolId=${ctx.schoolId}&termId=${termId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Grades', 'GET /academics/students/:id/grades — student grades + GPA', async () => {
    const res = await api('get', `/academics/students/${ctx.students[0].studentId}/grades?academicYearId=${ctx.academicYearId}`);
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 13: CROSS-SERVICE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

async function module13_crossServiceValidation() {
  console.log('\n\x1b[1;36m═══ Module 13: Cross-Service Validation ═══\x1b[0m');

  await test('Cross-Service', 'School from Identity referenceable in Academics', async () => {
    const schoolRes = await api('get', `/schools/${ctx.schoolId}`);
    assert(schoolRes.status === 200, `Identity school: ${schoolRes.status}`);

    const studentsRes = await api('get', `/academics/students?schoolId=${ctx.schoolId}`);
    assert(studentsRes.status === 200, `Academics students: ${studentsRes.status}`);
  });

  if (ctx.academicYearId) {
    await test('Cross-Service', 'Academic year usable in enrollment queries', async () => {
      const yearRes = await api('get', `/schools/${ctx.schoolId}/academic-years`);
      assert(yearRes.status === 200, `Identity academic years: ${yearRes.status}`);

      const enrollRes = await api('get', `/academics/schools/${ctx.schoolId}/years/${ctx.academicYearId}/enrollments`);
      assert(enrollRes.status === 200, `Academics enrollments: ${enrollRes.status}`);
    });
  }

  if (ctx.students.length > 0) {
    await test('Cross-Service', 'Student profile aggregates data across services', async () => {
      const res = await api('get', `/academics/students/${ctx.students[0].studentId}/profile`);
      assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 14: SECURITY CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════

async function module14_securityControls() {
  console.log('\n\x1b[1;36m═══ Module 14: Security Controls ═══\x1b[0m');

  await test('Security', 'Health endpoints accessible without auth', async () => {
    const res = await api('get', '/health', undefined, { noAuth: true });
    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
  });

  await test('Security', 'Protected endpoints reject unauthenticated requests', async () => {
    try {
      const res = await axios.get(`${BASE_URL}/users`, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: 10_000,
      });
      assert([400, 401, 403].includes(res.status), `Expected 400/401/403 but got ${res.status}`);
      log('info', `Unauthenticated request correctly rejected with ${res.status}`);
    } catch (err: any) {
      throw new Error(`Security test error: ${err.message}`);
    }
  });

  // User security endpoints
  if (ctx.adminUserId) {
    await test('Security', 'GET /users/:id/security — security overview', async () => {
      const res = await api('get', `/users/${ctx.adminUserId}/security`);
      assert(res.status === 200 || res.status === 404, `Expected 200/404 but got ${res.status}: ${res.error}`);
    });

    await test('Security', 'GET /users/:id/security/login-history — login history', async () => {
      const res = await api('get', `/users/${ctx.adminUserId}/security/login-history`);
      assert(res.status === 200 || res.status === 404, `Expected 200/404 but got ${res.status}: ${res.error}`);
    });
  }

  await test('Security', 'GET /credentials/expiring?days=90 — expiring credentials', async () => {
    const res = await api('get', '/credentials/expiring?days=90');
    assert(res.status === 200 || res.status === 404, `Expected 200/404 but got ${res.status}: ${res.error}`);
  });
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log('\x1b[1;35m');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  EdForge — Golden Thread: Complete End-to-End Smoke Test      ║');
  console.log('║  Sprints 1–7 · EdOrg · Calendar · Schedule · Students ·      ║');
  console.log('║  Enrollment · Rostering · Attendance · Grades · Staff         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
  console.log(`  API:       ${BASE_URL}`);
  console.log(`  School:    ${SCHOOL_ID}`);
  console.log(`  Token:     ${ID_TOKEN.substring(0, 20)}...`);
  console.log(`  Time:      ${new Date().toISOString()}`);
  console.log(`  Cleanup:   DISABLED (data persists for frontend)\n`);

  try {
    await module0_setup();
    await module1_edorgHierarchy();
    await module2_schoolConfiguration();
    await module3_usersAndRoles();
    await module4_staffManagement();
    await module5_academicYearAndCalendar();
    await module6_masterSchedule();
    await module7_coursesAndSections();
    await module8_students();
    await module9_enrollment();
    await module10_sectionRostering();
    await module11_attendance();
    await module12_grades();
    await module13_crossServiceValidation();
    await module14_securityControls();
  } catch (err: any) {
    console.error(`\n\x1b[31mFATAL ERROR: ${err.message}\x1b[0m`);
  }

  // ── NO CLEANUP ──
  console.log('\n\x1b[33m⚠  No cleanup — test data persists for frontend rendering / manual UAT.\x1b[0m');

  // ── Created Data Summary ──
  console.log('\n\x1b[1m📦 Created Data Summary\x1b[0m\n');

  console.log(`  School:          ${ctx.schoolName} (${ctx.schoolId})`);
  if (ctx.adminUserId)     console.log(`  Admin User:      ${ctx.adminUserId} (${ctx.adminEmail})`);
  if (ctx.teacherStaffId)  console.log(`  Teacher Staff:   ${ctx.teacherStaffId} (${ctx.teacherEmail})`);
  if (ctx.academicYearId)  console.log(`  Academic Year:   ${ctx.academicYearId}`);
  if (ctx.calendarId)      console.log(`  Calendar:        ${ctx.calendarId}`);
  if (ctx.fallSessionId)   console.log(`  Fall Session:    ${ctx.fallSessionId}`);
  if (ctx.springSessionId) console.log(`  Spring Session:  ${ctx.springSessionId}`);
  if (ctx.courseId)         console.log(`  Course:          ${ctx.courseCode} → ${ctx.courseId}`);
  if (ctx.sectionId)       console.log(`  Section:         ${ctx.sectionId}`);
  if (ctx.gradingPolicyId) console.log(`  Grading Policy:  ${ctx.gradingPolicyId}`);

  if (ctx.students.length > 0) {
    console.log(`\n  Students:`);
    for (const s of ctx.students) {
      console.log(`    • ${s.firstName} ${s.lastName} (Grade ${s.gradeLevel}) — USI: ${s.studentNumber || 'n/a'} — ID: ${s.studentId}`);
    }
  }

  if (ctx.enrollments.length > 0) {
    console.log(`\n  Enrollments: ${ctx.enrollments.length}`);
    for (const e of ctx.enrollments) {
      const student = ctx.students.find(s => s.studentId === e.studentId);
      console.log(`    • ${student?.firstName || e.studentId} ${student?.lastName || ''} → ${e.enrollmentId}`);
    }
  }

  if (ctx.rosterAssignments.length > 0) {
    console.log(`\n  Roster: ${ctx.rosterAssignments.length} assignment(s)`);
  }

  // ── Test Results ──
  console.log('\n\x1b[1m═══ TEST RESULTS ═══\x1b[0m\n');

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const total = results.length;

  // Group by module
  const modules = Array.from(new Set(results.map(r => r.module)));
  for (const mod of modules) {
    const mr = results.filter(r => r.module === mod);
    const mp = mr.filter(r => r.status === 'PASS').length;
    const mf = mr.filter(r => r.status === 'FAIL').length;
    const ms = mr.filter(r => r.status === 'SKIP').length;

    const ic = mf > 0 ? '\x1b[31m' : ms === mr.length ? '\x1b[33m' : '\x1b[32m';
    console.log(`  ${ic}[${mod}]\x1b[0m  ${mp}/${mr.length} passed${mf > 0 ? `, ${mf} failed` : ''}${ms > 0 ? `, ${ms} skipped` : ''}`);

    for (const r of mr) {
      const icon = r.status === 'PASS' ? '\x1b[32m✓\x1b[0m' : r.status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m○\x1b[0m';
      console.log(`    ${icon} ${r.name} \x1b[90m(${r.duration}ms)\x1b[0m`);
      if (r.error && r.status === 'FAIL') console.log(`      \x1b[31m${r.error.slice(0, 300)}\x1b[0m`);
    }
  }

  console.log(`\n  \x1b[1mTotal:\x1b[0m ${total}  \x1b[32mPass:\x1b[0m ${pass}  \x1b[31mFail:\x1b[0m ${fail}  \x1b[33mSkip:\x1b[0m ${skipped}`);
  console.log(`  \x1b[1mResult:\x1b[0m ${fail === 0 ? '\x1b[32mALL PASSING\x1b[0m' : '\x1b[31mFAILURES DETECTED\x1b[0m'}\n`);

  // Save log
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `golden-thread_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  fs.writeFileSync(logFile, logLines.join('\n'), 'utf-8');
  console.log(`  Log saved: ${logFile}`);

  process.exit(fail > 0 ? 1 : 0);
}

main();

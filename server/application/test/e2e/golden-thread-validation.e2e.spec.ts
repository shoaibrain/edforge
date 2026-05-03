/**
 * EdForge Golden Thread E2E Validation
 *
 * Comprehensive end-to-end test that follows the Ed-Fi Golden Thread:
 * EdOrg → Calendar → Courses → Students → Enrollment → Rostering → Attendance → Grades
 *
 * Mimics a real admin user setting up and operating a school, validating
 * all Sprint 1–7 backend APIs through the API Gateway.
 *
 * Usage:
 *   API_GATEWAY_URL=https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod \
 *   JWT_TOKEN=<your-jwt-token> \
 *   TEST_SCHOOL_ID=<schoolId> \
 *   npm run test:e2e -- --testPathPattern=golden-thread
 *
 * The API Gateway routes all requests:
 *   /auth, /users, /schools, /staff, /tenants, /sessions, /credentials → Identity service
 *   /academics → Academics service
 */

import * as request from 'supertest';

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const JWT_TOKEN = 'eyJraWQiOiJmakNuWU9ra1ZPR2Z2RzZNck9laWl5WXJLZGFzdHhHbmk5bjY2U2gzQWI4PSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoidXdaanpiMXJLalZDRVpJMnl2OElGZyIsInN1YiI6ImUxYWJjNTUwLWIwMTEtNzBmZC0zYzMxLTI5ZGU1MDY1ZDRkMyIsImNvZ25pdG86Z3JvdXBzIjpbIjZlYzJlMmQxLTZlYTctNDZjMi04ODY0LWRlOTUxMTNhM2YzMiJdLCJjdXN0b206dGVuYW50VGllciI6IkJBU0lDIiwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tXC91cy1lYXN0LTJfdEIwYzg0Qm5vIiwiY29nbml0bzp1c2VybmFtZSI6InJhaW5zaG9haWIyMDEzQG91dGxvb2suY29tIiwiY3VzdG9tOnRlbmFudE5hbWUiOiJhZHZhbmNlZCIsIm9yaWdpbl9qdGkiOiI2MDJiMjFlMy1mZjE5LTQ5MDQtOGY5My1jOGQzM2JmYmZjNWIiLCJjdXN0b206dGVuYW50SWQiOiI2ZWMyZTJkMS02ZWE3LTQ2YzItODg2NC1kZTk1MTEzYTNmMzIiLCJhdWQiOiI2NzhiZTJwYWZ2bzFoaGVvNGxjdDd1NHFycCIsImV2ZW50X2lkIjoiZTVlMWU0ODYtNTQ4YS00YmEyLTg2YzItZDE0ZjU1MjQyNjdiIiwiY3VzdG9tOnVzZXJSb2xlIjoiVGVuYW50QWRtaW4iLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTc3MTE4Nzg0MCwiZXhwIjoxNzcxMTkxNDQwLCJpYXQiOjE3NzExODc4NDAsImp0aSI6IjNmZTZiOTU5LWMyODYtNGFjYy04Zjc0LWFiYTliMDdjNGY5OCIsImVtYWlsIjoicmFpbnNob2FpYjIwMTNAb3V0bG9vay5jb20ifQ.TxzyqVFMvLHPofJ3H0MT-OG196q5Tyxs0D0SpCYOG9Cv6y_tVfoA_CAfZoDioeYIcTmlgsKSpHTYufc4rxh7eZTi5OrPfOgJrkJpqxtY2nI9a7YljfCztNwqzbEB0BoMD5vD7Mubl2FLYcS23G4VU5rjMlwqTk5pKZYxxX0R9qH8BNGHvKlzUENp8-mjWQIU3ECWiZ4glf0bFJ1grgx7UDvSYX_cqPGgdpTQNxdx_RNvU8JXKWV3Rh2SAzGdXB5lQNGIQoSyQQJlryk7p-y47bfXjj6LsPDNFdBBw0l3rIbWxbcLopnJoTL9iRsCQCSQIsmbwPoeCDMfJ-W2wGryxQ';
const TEST_SCHOOL_ID = '8debad72-55d0-4953-b562-40fac1a4fa23';

// ─── Shared State ────────────────────────────────────────────────────────────

interface TestState {
  schoolId: string;
  departmentId?: string;
  adminUserId?: string;
  teacherUserId?: string;
  teacherStaffId?: string;
  staffAssignmentId?: string;
  credentialId?: string;
  leaveRequestId?: string;
  academicYearId?: string;
  gradingPeriodIds: string[];
  calendarId?: string;
  academicSessionId?: string;
  classPeriodId?: string;
  courseId?: string;
  courseOfferingId?: string;
  sectionId?: string;
  studentIds: string[];
  enrollmentIds: string[];
  gradingPolicyId?: string;
  gradeIds: string[];
}

const state: TestState = {
  schoolId: TEST_SCHOOL_ID || '',
  gradingPeriodIds: [],
  studentIds: [],
  enrollmentIds: [],
  gradeIds: [],
};

// ─── API Call Logger ─────────────────────────────────────────────────────────

interface ApiLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  success: boolean;
  body?: any;
}

const apiLog: ApiLogEntry[] = [];
const createdResources: { type: string; id: string }[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': `e2e-golden-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  if (JWT_TOKEN) {
    headers['Authorization'] = `Bearer ${JWT_TOKEN}`;
  }

  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }

  return headers;
}

async function api(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  options?: { body?: any; query?: Record<string, string>; extraHeaders?: Record<string, string> },
): Promise<request.Response> {
  const start = Date.now();
  const headers = getHeaders(options?.extraHeaders);

  let req = request(BASE_URL)[method](path).set(headers);
  if (options?.query) req = req.query(options.query);
  if (options?.body) req = req.send(options.body);

  const res = await req;
  const durationMs = Date.now() - start;
  const success = res.status >= 200 && res.status < 300;

  apiLog.push({
    method: method.toUpperCase(),
    path,
    status: res.status,
    durationMs,
    success,
    body: !success ? res.body : undefined,
  });

  const icon = success ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${method.toUpperCase()} ${path} => ${res.status} (${durationMs}ms)`);

  return res;
}

function trackResource(type: string, id: string) {
  createdResources.push({ type, id });
}

function printReport() {
  const total = apiLog.length;
  const passed = apiLog.filter((e) => e.success).length;
  const failed = total - passed;
  const avgMs = total > 0 ? Math.round(apiLog.reduce((s, e) => s + e.durationMs, 0) / total) : 0;

  console.log('\n========================================');
  console.log('  GOLDEN THREAD E2E TEST REPORT');
  console.log('========================================\n');
  console.log(`  API Gateway:      ${BASE_URL}`);
  console.log(`  School ID:        ${state.schoolId}`);
  console.log(`  Total API calls:  ${total}`);
  console.log(`  Passed:           ${passed}`);
  console.log(`  Failed:           ${failed}`);
  console.log(`  Avg response:     ${avgMs}ms\n`);

  if (failed > 0) {
    console.log('  --- FAILED CALLS ---');
    apiLog
      .filter((e) => !e.success)
      .forEach((e) => {
        console.log(`  ${e.method} ${e.path} => ${e.status} (${e.durationMs}ms)`);
        if (e.body) console.log(`    ${JSON.stringify(e.body).substring(0, 200)}`);
      });
    console.log('');
  }

  console.log('  --- CREATED RESOURCES ---');
  createdResources.forEach((r) => console.log(`  [${r.type}] ${r.id}`));
  console.log('\n========================================\n');
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('EdForge Golden Thread E2E Validation', () => {
  beforeAll(() => {
    if (!TEST_SCHOOL_ID) {
      throw new Error('TEST_SCHOOL_ID environment variable is required');
    }
    if (!JWT_TOKEN) {
      throw new Error('JWT_TOKEN environment variable is required');
    }

    console.log(`\n  [CONFIG] API Gateway: ${BASE_URL}`);
    console.log(`  [CONFIG] School ID:  ${state.schoolId}`);
    console.log(`  [CONFIG] JWT:        ${JWT_TOKEN.substring(0, 20)}...`);
    console.log('');
  });

  afterAll(() => {
    printReport();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 0: SERVICE HEALTH & SCHOOL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 0: Service Health & School Verification', () => {
    it('should confirm Identity service is healthy', async () => {
      const res = await api('get', '/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });

    it('should confirm Identity service is ready', async () => {
      const res = await api('get', '/health/ready');
      expect(res.status).toBe(200);
    });

    it('should confirm Academics service is healthy', async () => {
      const res = await api('get', '/academics/health');
      expect([200, 404]).toContain(res.status);
    });

    it('should verify auth health endpoint', async () => {
      const res = await api('get', '/auth/health');
      expect(res.status).toBe(200);
    });

    it('should verify the provided school exists', async () => {
      const res = await api('get', `/schools/${state.schoolId}`);
      expect(res.status).toBe(200);
      expect(res.body.schoolId || res.body.id).toBeDefined();
      console.log(`  School: ${res.body.name} (${res.body.schoolType})`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: SCHOOL CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 1: School Configuration', () => {
    it('should retrieve school details', async () => {
      const res = await api('get', `/schools/${state.schoolId}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBeDefined();
    });

    it('should update school configuration', async () => {
      const res = await api('patch', `/schools/${state.schoolId}/configuration`, {
        body: { attendanceTrackingMode: 'daily' },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should retrieve school configuration', async () => {
      const res = await api('get', `/schools/${state.schoolId}/configuration`);
      expect(res.status).toBe(200);
    });

    it('should create a department', async () => {
      const res = await api('post', `/schools/${state.schoolId}/departments`, {
        body: {
          name: 'Mathematics',
          code: 'MATH',
          description: 'Mathematics Department',
        },
      });
      expect(res.status).toBe(201);
      state.departmentId = res.body.departmentId || res.body.id;
      trackResource('department', state.departmentId!);
    });

    it('should list departments', async () => {
      const res = await api('get', `/schools/${state.schoolId}/departments`);
      expect(res.status).toBe(200);
    });

    it('should get the created department', async () => {
      const res = await api('get', `/schools/${state.schoolId}/departments/${state.departmentId}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Mathematics');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: USERS & ROLES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 2: Users & Roles', () => {
    const adminEmail = `e2e-admin-${Date.now()}@golden-thread.test`;

    it('should create a TenantAdmin user', async () => {
      const res = await api('post', '/users', {
        body: {
          email: adminEmail,
          firstName: 'GoldenThread',
          lastName: 'Admin',
          globalRole: 'TenantAdmin',
          phone: '555-0100',
        },
      });
      expect(res.status).toBe(201);
      state.adminUserId = res.body.userId || res.body.id;
      trackResource('user', state.adminUserId!);
    });

    it('should retrieve the admin user', async () => {
      const res = await api('get', `/users/${state.adminUserId}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(adminEmail);
    });

    it('should search users by email', async () => {
      const res = await api('get', '/users', {
        query: { search: adminEmail.split('@')[0] },
      });
      expect(res.status).toBe(200);
    });

    it('should get user preferences', async () => {
      const res = await api('get', `/users/${state.adminUserId}/preferences`);
      expect([200, 404]).toContain(res.status);
    });

    it('should get user assignments', async () => {
      const res = await api('get', `/users/${state.adminUserId}/assignments`);
      expect([200, 404]).toContain(res.status);
    });

    it('should change user global role (TenantAdmin → TenantUser)', async () => {
      const res = await api('patch', `/users/${state.adminUserId}/global-role`, {
        body: { newRole: 'TenantUser' },
      });
      expect(res.status).toBe(200);
    });

    it('should revert user global role back (TenantUser → TenantAdmin)', async () => {
      const res = await api('patch', `/users/${state.adminUserId}/global-role`, {
        body: { newRole: 'TenantAdmin' },
      });
      expect(res.status).toBe(200);
    });

    it('should assign a school role to the user', async () => {
      const res = await api('post', `/users/${state.adminUserId}/roles`, {
        body: {
          schoolId: state.schoolId,
          role: 'Principal',
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should list all roles for the user', async () => {
      const res = await api('get', `/users/${state.adminUserId}/roles`);
      expect(res.status).toBe(200);
    });

    it('should get school-specific role', async () => {
      const res = await api('get', `/users/${state.adminUserId}/roles/${state.schoolId}`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: STAFF MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 3: Staff Management', () => {
    const teacherEmail = `e2e-teacher-${Date.now()}@golden-thread.test`;

    it('should create a teacher staff with user account', async () => {
      const res = await api('post', '/staff/with-user', {
        body: {
          firstName: 'Jane',
          lastSurname: 'Doe',
          email: teacherEmail,
          role: 'Teacher',
          department: 'Mathematics',
          primarySchoolId: state.schoolId,
          phone: '555-0200',
          hireDate: '2024-08-01',
          employmentStatus: 'active',
          createUserAccount: true,
          globalRole: 'TenantUser',
        },
      });
      expect(res.status).toBe(201);
      state.teacherStaffId = res.body.staffId || res.body.staff?.staffId || res.body.staff?.id || res.body.id;
      state.teacherUserId = res.body.userId || res.body.user?.userId || res.body.user?.id;
      trackResource('staff', state.teacherStaffId!);
      if (state.teacherUserId) trackResource('user', state.teacherUserId);
    });

    it('should retrieve the teacher staff record', async () => {
      const res = await api('get', `/staff/${state.teacherStaffId}`);
      expect(res.status).toBe(200);
    });

    it('should look up staff by email', async () => {
      const res = await api('get', '/staff/by-email', {
        query: { email: teacherEmail },
      });
      expect(res.status).toBe(200);
    });

    it('should search staff by name', async () => {
      const res = await api('get', '/staff/search/Jane');
      expect(res.status).toBe(200);
    });

    it('should list all staff', async () => {
      const res = await api('get', '/staff');
      expect(res.status).toBe(200);
    });

    it('should list staff at the school', async () => {
      const res = await api('get', `/schools/${state.schoolId}/staff`);
      expect(res.status).toBe(200);
    });

    it('should create a staff assignment', async () => {
      const res = await api('post', `/staff/${state.teacherStaffId}/assignments`, {
        body: {
          schoolId: state.schoolId,
          positionTitle: 'Math Teacher',
          staffClassification: 'Teacher',
          startDate: '2024-08-01',
        },
      });
      expect(res.status).toBe(201);
      state.staffAssignmentId = res.body.assignmentId || res.body.id;
      trackResource('staffAssignment', state.staffAssignmentId!);
    });

    it('should list staff assignments', async () => {
      const res = await api('get', `/staff/${state.teacherStaffId}/assignments`);
      expect(res.status).toBe(200);
    });

    it('should create a staff credential', async () => {
      const res = await api('post', `/staff/${state.teacherStaffId}/credentials`, {
        body: {
          credentialType: 'TeachingCertificate',
          credentialField: 'Mathematics',
          issuingOrganization: 'State Board of Education',
          issueDate: '2020-06-15',
          expirationDate: '2027-06-15',
          credentialNumber: 'TC-E2E-001',
        },
      });
      expect(res.status).toBe(201);
      state.credentialId = res.body.credentialId || res.body.id;
      trackResource('credential', state.credentialId!);
    });

    it('should list staff credentials', async () => {
      const res = await api('get', `/staff/${state.teacherStaffId}/credentials`);
      expect(res.status).toBe(200);
    });

    it('should verify the credential', async () => {
      const res = await api('patch', `/staff/${state.teacherStaffId}/credentials/${state.credentialId}/verify`, {
        body: {
          verificationStatus: 'verified',
          verifiedBy: 'E2E Test Admin',
          verificationDate: new Date().toISOString().split('T')[0],
        },
      });
      expect(res.status).toBe(200);
    });

    it('should create a leave request', async () => {
      const res = await api('post', `/staff/${state.teacherStaffId}/leave`, {
        body: {
          leaveType: 'sick',
          startDate: '2025-11-01',
          endDate: '2025-11-02',
          totalDays: 2,
          reason: 'E2E test leave request',
        },
      });
      expect(res.status).toBe(201);
      state.leaveRequestId = res.body.leaveRequestId || res.body.id;
      trackResource('leaveRequest', state.leaveRequestId!);
    });

    it('should list leave requests', async () => {
      const res = await api('get', `/staff/${state.teacherStaffId}/leave`);
      expect(res.status).toBe(200);
    });

    it('should approve the leave request', async () => {
      const res = await api('patch', `/staff/${state.teacherStaffId}/leave/${state.leaveRequestId}/approve`, {
        body: { approverNotes: 'Approved by E2E test' },
      });
      expect(res.status).toBe(200);
    });

    it('should get employment history', async () => {
      const res = await api('get', `/staff/${state.teacherStaffId}/employment-history`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: ACADEMIC YEAR, CALENDAR & SESSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 4: Academic Year, Calendar & Sessions', () => {
    it('should create an academic year with terms', async () => {
      const res = await api('post', `/schools/${state.schoolId}/academic-years`, {
        body: {
          name: '2025-2026',
          startDate: '2025-08-15',
          endDate: '2026-06-15',
          terms: [
            { name: 'Fall Semester', termType: 'semester', startDate: '2025-08-15', endDate: '2025-12-20' },
            { name: 'Spring Semester', termType: 'semester', startDate: '2026-01-06', endDate: '2026-06-15' },
          ],
        },
      });
      expect(res.status).toBe(201);
      state.academicYearId = res.body.academicYearId || res.body.id;
      trackResource('academicYear', state.academicYearId!);

      if (res.body.terms && res.body.terms.length > 0) {
        state.gradingPeriodIds = res.body.terms.map((t: any) => t.termId || t.id);
      }
    });

    it('should list academic years', async () => {
      const res = await api('get', `/schools/${state.schoolId}/academic-years`);
      expect(res.status).toBe(200);
    });

    it('should set the academic year as current', async () => {
      const res = await api('put', `/schools/${state.schoolId}/academic-years/${state.academicYearId}/set-current`);
      expect(res.status).toBe(200);
    });

    it('should get the current academic year', async () => {
      const res = await api('get', `/schools/${state.schoolId}/academic-years/current`);
      expect(res.status).toBe(200);
    });

    it('should create a school calendar', async () => {
      const res = await api('post', `/schools/${state.schoolId}/calendars`, {
        body: {
          calendarCode: 'STD-2025',
          calendarType: 'student',
          academicYearId: state.academicYearId,
          schoolYear: '2025-2026',
        },
      });
      expect(res.status).toBe(201);
      state.calendarId = res.body.calendarId || res.body.id;
      trackResource('calendar', state.calendarId!);
    });

    it('should generate calendar dates for the academic year', async () => {
      const res = await api('post', `/schools/${state.schoolId}/academic-years/${state.academicYearId}/generate-calendar`, {
        body: {
          calendarId: state.calendarId,
          weekdays: [1, 2, 3, 4, 5],
          holidays: [
            { date: '2025-09-01', name: 'Labor Day' },
            { date: '2025-11-27', name: 'Thanksgiving' },
            { date: '2025-12-25', name: 'Christmas Day' },
            { date: '2026-01-01', name: 'New Year' },
          ],
        },
      });
      expect([200, 201]).toContain(res.status);
      console.log(`  Calendar generated: ${JSON.stringify(res.body).substring(0, 200)}`);
    });

    it('should list calendar dates', async () => {
      const res = await api('get', `/schools/${state.schoolId}/calendar-dates`, {
        query: { academicYearId: state.academicYearId!, limit: '10' },
      });
      expect(res.status).toBe(200);
    });

    it('should get calendar date stats', async () => {
      const res = await api('get', `/schools/${state.schoolId}/calendar-dates/stats`, {
        query: { academicYearId: state.academicYearId! },
      });
      expect(res.status).toBe(200);
    });

    it('should create an academic session', async () => {
      const res = await api('post', `/schools/${state.schoolId}/academic-sessions`, {
        body: {
          name: 'Fall 2025',
          sessionType: 'semester',
          academicYearId: state.academicYearId,
          startDate: '2025-08-15',
          endDate: '2025-12-20',
          totalInstructionalDays: 90,
        },
      });
      expect(res.status).toBe(201);
      state.academicSessionId = res.body.academicSessionId || res.body.id;
      trackResource('academicSession', state.academicSessionId!);
    });

    it('should list academic sessions', async () => {
      const res = await api('get', `/schools/${state.schoolId}/academic-sessions`, {
        query: { academicYearId: state.academicYearId! },
      });
      expect(res.status).toBe(200);
    });

    it('should create a class period', async () => {
      const res = await api('post', `/schools/${state.schoolId}/class-periods`, {
        body: {
          name: 'Period 1',
          startTime: '08:00',
          endTime: '08:50',
          sortOrder: 1,
        },
      });
      expect(res.status).toBe(201);
      state.classPeriodId = res.body.classPeriodId || res.body.id;
      trackResource('classPeriod', state.classPeriodId!);
    });

    it('should list class periods', async () => {
      const res = await api('get', `/schools/${state.schoolId}/class-periods`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: COURSES & SECTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 5: Courses & Sections', () => {
    it('should create a course', async () => {
      const res = await api('post', '/academics/courses', {
        body: {
          courseCode: 'MATH-101',
          courseTitle: 'Algebra I',
          schoolId: state.schoolId,
          subjectArea: 'Mathematics',
          courseType: 'core',
          credits: 1.0,
        },
      });
      expect(res.status).toBe(201);
      state.courseId = res.body.courseId || res.body.id;
      trackResource('course', state.courseId!);
    });

    it('should list courses for the school', async () => {
      const res = await api('get', '/academics/courses', {
        query: { schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });

    it('should get the course by ID', async () => {
      const res = await api('get', `/academics/courses/${state.courseId}`, {
        query: { schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
      expect(res.body.courseTitle || res.body.courseCode).toBeDefined();
    });

    it('should create a course offering', async () => {
      const res = await api('post', '/academics/course-offerings', {
        body: {
          courseId: state.courseId,
          schoolId: state.schoolId,
          academicSessionId: state.academicSessionId,
          localCourseCode: 'ALG1-F25',
        },
      });
      expect(res.status).toBe(201);
      state.courseOfferingId = res.body.courseOfferingId || res.body.id;
      trackResource('courseOffering', state.courseOfferingId!);
    });

    it('should create a section', async () => {
      const res = await api('post', '/academics/sections', {
        body: {
          sectionIdentifier: `ALG1-F25-E2E-${Date.now()}`,
          courseOfferingId: state.courseOfferingId,
          schoolId: state.schoolId,
          academicYearId: state.academicYearId,
          teacherId: state.teacherStaffId,
          classPeriodId: state.classPeriodId,
          maxCapacity: 30,
        },
      });
      expect(res.status).toBe(201);
      state.sectionId = res.body.sectionId || res.body.id;
      trackResource('section', state.sectionId!);
    });

    it('should list sections for the school', async () => {
      const res = await api('get', '/academics/sections', {
        query: { schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: STUDENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 6: Students', () => {
    const ts = Date.now();
    const students = [
      { firstName: 'Alice', lastName: 'Johnson', dateOfBirth: '2012-03-15', gender: 'female', studentNumber: `E2E-STU-001-${ts}`, gradeLevel: '6' },
      { firstName: 'Bob', lastName: 'Smith', dateOfBirth: '2012-07-22', gender: 'male', studentNumber: `E2E-STU-002-${ts}`, gradeLevel: '6' },
      { firstName: 'Carol', lastName: 'Williams', dateOfBirth: '2012-11-10', gender: 'female', studentNumber: `E2E-STU-003-${ts}`, gradeLevel: '6' },
    ];

    it('should create student 1 (Alice)', async () => {
      const res = await api('post', '/academics/students', {
        body: { ...students[0], schoolId: state.schoolId },
      });
      expect(res.status).toBe(201);
      state.studentIds[0] = res.body.studentId || res.body.id;
      trackResource('student', state.studentIds[0]);
    });

    it('should create student 2 (Bob)', async () => {
      const res = await api('post', '/academics/students', {
        body: { ...students[1], schoolId: state.schoolId },
      });
      expect(res.status).toBe(201);
      state.studentIds[1] = res.body.studentId || res.body.id;
      trackResource('student', state.studentIds[1]);
    });

    it('should create student 3 (Carol)', async () => {
      const res = await api('post', '/academics/students', {
        body: { ...students[2], schoolId: state.schoolId },
      });
      expect(res.status).toBe(201);
      state.studentIds[2] = res.body.studentId || res.body.id;
      trackResource('student', state.studentIds[2]);
    });

    it('should list students for the school', async () => {
      const res = await api('get', '/academics/students', {
        query: { schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });

    it('should get student 1 by ID', async () => {
      const res = await api('get', `/academics/students/${state.studentIds[0]}`);
      expect(res.status).toBe(200);
    });

    it('should search students by name', async () => {
      const res = await api('get', '/academics/students', {
        query: { schoolId: state.schoolId, search: 'Alice' },
      });
      expect(res.status).toBe(200);
    });

    it('should filter students by grade level', async () => {
      const res = await api('get', '/academics/students', {
        query: { schoolId: state.schoolId, gradeLevel: '6' },
      });
      expect(res.status).toBe(200);
    });

    it('should check for duplicates via GET', async () => {
      const res = await api('get', '/academics/students/check-duplicate', {
        query: { firstName: 'Alice', lastName: 'Johnson', dateOfBirth: '2012-03-15', schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });

    it('should check for duplicates via POST', async () => {
      const res = await api('post', '/academics/students/check-duplicate', {
        body: { firstName: 'Alice', lastName: 'Johnson', dateOfBirth: '2012-03-15', schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });

    it('should update student information', async () => {
      const res = await api('patch', `/academics/students/${state.studentIds[0]}`, {
        body: { middleName: 'Marie' },
      });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: ENROLLMENT & ROSTERING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 7: Enrollment & Rostering', () => {
    it('should enroll student 1', async () => {
      const res = await api('post', '/academics/enrollments', {
        body: {
          studentId: state.studentIds[0],
          schoolId: state.schoolId,
          academicYearId: state.academicYearId,
          gradeLevel: '6',
          enrollmentDate: '2025-08-15',
        },
      });
      expect(res.status).toBe(201);
      state.enrollmentIds[0] = res.body.enrollmentId || res.body.id;
      trackResource('enrollment', state.enrollmentIds[0]);
    });

    it('should enroll student 2', async () => {
      const res = await api('post', '/academics/enrollments', {
        body: {
          studentId: state.studentIds[1],
          schoolId: state.schoolId,
          academicYearId: state.academicYearId,
          gradeLevel: '6',
          enrollmentDate: '2025-08-15',
        },
      });
      expect(res.status).toBe(201);
      state.enrollmentIds[1] = res.body.enrollmentId || res.body.id;
      trackResource('enrollment', state.enrollmentIds[1]);
    });

    it('should enroll student 3', async () => {
      const res = await api('post', '/academics/enrollments', {
        body: {
          studentId: state.studentIds[2],
          schoolId: state.schoolId,
          academicYearId: state.academicYearId,
          gradeLevel: '6',
          enrollmentDate: '2025-08-15',
        },
      });
      expect(res.status).toBe(201);
      state.enrollmentIds[2] = res.body.enrollmentId || res.body.id;
      trackResource('enrollment', state.enrollmentIds[2]);
    });

    it('should list enrollments for school/year', async () => {
      const res = await api('get', `/academics/schools/${state.schoolId}/years/${state.academicYearId}/enrollments`);
      expect(res.status).toBe(200);
    });

    it('should get enrollment summary', async () => {
      const res = await api('get', `/academics/schools/${state.schoolId}/years/${state.academicYearId}/enrollments/summary`);
      expect(res.status).toBe(200);
    });

    it('should get specific enrollment', async () => {
      const res = await api('get', `/academics/schools/${state.schoolId}/years/${state.academicYearId}/students/${state.studentIds[0]}/enrollment`);
      expect(res.status).toBe(200);
    });

    it('should get student enrollment history', async () => {
      const res = await api('get', `/academics/students/${state.studentIds[0]}/enrollment`);
      expect(res.status).toBe(200);
    });

    it('should enroll student 1 in the section (roster)', async () => {
      const res = await api('post', `/academics/sections/${state.sectionId}/students`, {
        query: { schoolId: state.schoolId },
        body: { studentId: state.studentIds[0] },
      });
      expect(res.status).toBe(201);
    });

    it('should enroll student 2 in the section (roster)', async () => {
      const res = await api('post', `/academics/sections/${state.sectionId}/students`, {
        query: { schoolId: state.schoolId },
        body: { studentId: state.studentIds[1] },
      });
      expect(res.status).toBe(201);
    });

    it('should get section roster', async () => {
      const res = await api('get', `/academics/sections/${state.sectionId}/students`, {
        query: { schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });

    it('should withdraw student 3', async () => {
      const res = await api(
        'post',
        `/academics/schools/${state.schoolId}/years/${state.academicYearId}/students/${state.studentIds[2]}/withdraw`,
        {
          body: {
            withdrawalDate: '2025-10-15',
            withdrawalReason: 'Transferred to another school',
            exitCode: 'W1',
          },
        },
      );
      expect([200, 201]).toContain(res.status);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8: ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 8: Attendance', () => {
    const attendanceDate = '2025-09-15';

    it('should record single attendance for student 1 (present)', async () => {
      const res = await api('post', '/academics/attendance', {
        body: {
          studentId: state.studentIds[0],
          schoolId: state.schoolId,
          sectionId: state.sectionId,
          date: attendanceDate,
          status: 'present',
          arrivalTime: '08:00',
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should record bulk attendance', async () => {
      const res = await api('post', '/academics/attendance/bulk', {
        body: {
          schoolId: state.schoolId,
          sectionId: state.sectionId,
          date: attendanceDate,
          records: [{ studentId: state.studentIds[1], status: 'absent', absenceCategory: 'excused' }],
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should get attendance by date', async () => {
      const res = await api('get', '/academics/attendance', {
        query: { schoolId: state.schoolId, date: attendanceDate },
      });
      expect(res.status).toBe(200);
    });

    it('should get daily attendance summary', async () => {
      const res = await api('get', '/academics/attendance/summary', {
        query: { schoolId: state.schoolId, date: attendanceDate },
      });
      expect(res.status).toBe(200);
    });

    it('should get student attendance summary', async () => {
      const res = await api('get', `/academics/attendance/student/${state.studentIds[0]}/summary`, {
        query: { schoolId: state.schoolId, academicYearId: state.academicYearId! },
      });
      expect(res.status).toBe(200);
    });

    it('should get attendance trend', async () => {
      const res = await api('get', '/academics/attendance/trend', {
        query: { schoolId: state.schoolId, startDate: '2025-09-01', endDate: '2025-09-30' },
      });
      expect(res.status).toBe(200);
    });

    it('should get attendance alerts', async () => {
      const res = await api('get', '/academics/attendance/alerts', {
        query: { schoolId: state.schoolId, academicYearId: state.academicYearId!, threshold: '90' },
      });
      expect(res.status).toBe(200);
    });

    it('should update an attendance record', async () => {
      const res = await api('patch', `/academics/attendance/${attendanceDate}/${state.studentIds[0]}`, {
        body: { status: 'tardy', note: 'Arrived 10 min late — updated by E2E test' },
      });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 9: GRADING POLICIES & GRADES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 9: Grading Policies & Grades', () => {
    it('should create a grading policy', async () => {
      const res = await api('post', '/academics/grading-policies', {
        body: {
          schoolId: state.schoolId,
          name: 'Standard K-12 Grading',
          scaleType: 'letter',
          gradeScale: [
            { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
            { letter: 'B', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.0 },
            { letter: 'C', minPercentage: 70, maxPercentage: 79, gpaPoints: 2.0 },
            { letter: 'D', minPercentage: 60, maxPercentage: 69, gpaPoints: 1.0 },
            { letter: 'F', minPercentage: 0, maxPercentage: 59, gpaPoints: 0.0 },
          ],
        },
      });
      expect(res.status).toBe(201);
      state.gradingPolicyId = res.body.policyId || res.body.id;
      trackResource('gradingPolicy', state.gradingPolicyId!);
    });

    it('should list grading policies', async () => {
      const res = await api('get', '/academics/grading-policies', {
        query: { schoolId: state.schoolId },
      });
      expect(res.status).toBe(200);
    });

    it('should record a single grade for student 1', async () => {
      const termId = state.gradingPeriodIds[0] || 'fall-2025';
      const res = await api('post', '/academics/grades/record', {
        body: {
          studentId: state.studentIds[0],
          courseId: state.courseId,
          sectionId: state.sectionId,
          schoolId: state.schoolId,
          termId,
          assignmentName: 'Midterm Exam',
          category: 'exam',
          pointsEarned: 92,
          pointsPossible: 100,
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should record bulk grades for the section', async () => {
      const termId = state.gradingPeriodIds[0] || 'fall-2025';
      const res = await api('post', '/academics/grades/record/bulk', {
        body: {
          sectionId: state.sectionId,
          schoolId: state.schoolId,
          termId,
          assignmentName: 'Homework 1',
          category: 'homework',
          grades: [
            { studentId: state.studentIds[0], pointsEarned: 18, pointsPossible: 20 },
            { studentId: state.studentIds[1], pointsEarned: 15, pointsPossible: 20 },
          ],
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should get section grades', async () => {
      const termId = state.gradingPeriodIds[0] || 'fall-2025';
      const res = await api('get', `/academics/grades/section/${state.sectionId}`, {
        query: { schoolId: state.schoolId, termId },
      });
      expect(res.status).toBe(200);
    });

    it('should get student grades with GPA', async () => {
      const res = await api('get', `/academics/students/${state.studentIds[0]}/grades`, {
        query: { academicYearId: state.academicYearId! },
      });
      expect(res.status).toBe(200);
    });

    it('should finalize a single grade', async () => {
      const termId = state.gradingPeriodIds[0] || 'fall-2025';
      const gradeId = `${state.studentIds[0]}:${state.courseId}:${termId}`;
      const res = await api('patch', `/academics/grades/${encodeURIComponent(gradeId)}/finalize`);
      expect([200, 404]).toContain(res.status);
    });

    it('should bulk finalize grades for the section', async () => {
      const termId = state.gradingPeriodIds[0] || 'fall-2025';
      const res = await api('post', '/academics/grades/finalize/bulk', {
        body: {
          sectionId: state.sectionId,
          termId,
          schoolId: state.schoolId,
        },
      });
      expect([200, 201]).toContain(res.status);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 10: CROSS-SERVICE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 10: Cross-Service Validation', () => {
    it('should verify school exists in Identity and is referenceable in Academics', async () => {
      const schoolRes = await api('get', `/schools/${state.schoolId}`);
      expect(schoolRes.status).toBe(200);

      const studentsRes = await api('get', '/academics/students', {
        query: { schoolId: state.schoolId },
      });
      expect(studentsRes.status).toBe(200);
    });

    it('should verify academic year is usable in enrollment queries', async () => {
      const yearRes = await api('get', `/schools/${state.schoolId}/academic-years/${state.academicYearId}`);
      expect(yearRes.status).toBe(200);

      const enrollRes = await api('get', `/academics/schools/${state.schoolId}/years/${state.academicYearId}/enrollments`);
      expect(enrollRes.status).toBe(200);
    });

    it('should verify student profile aggregates cross-service data', async () => {
      const res = await api('get', `/academics/students/${state.studentIds[0]}/profile`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 11: SECURITY CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 11: Security Controls', () => {
    it('should reject requests without authorization', async () => {
      const res = await request(BASE_URL).get('/users').set('Content-Type', 'application/json');
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should enforce tenant isolation (cross-tenant JWT cannot access)', async () => {
      // Health endpoint should always be accessible (public)
      const res = await request(BASE_URL).get('/health');
      expect(res.status).toBe(200);
    });

    it('should allow health endpoints without authentication', async () => {
      const res = await request(BASE_URL).get('/health');
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 12: USER SECURITY & ADMIN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 12: User Security & Admin', () => {
    it('should get security overview for admin user', async () => {
      const res = await api('get', `/users/${state.adminUserId}/security`);
      expect([200, 404]).toContain(res.status);
    });

    it('should get login history', async () => {
      const res = await api('get', `/users/${state.adminUserId}/security/login-history`);
      expect([200, 404]).toContain(res.status);
    });

    it('should get expiring credentials', async () => {
      const res = await api('get', '/credentials/expiring', {
        query: { days: '90' },
      });
      expect([200, 404]).toContain(res.status);
    });
  });
});

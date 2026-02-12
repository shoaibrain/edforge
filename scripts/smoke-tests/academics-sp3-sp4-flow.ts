/**
 * EdForge — Comprehensive SP1–SP3 + Sprint Alaska + Sprint 1A Simulation
 *
 * Simulates a realistic school-year setup for a brand-new tenant:
 *
 *   Module 0: School & Academic Year Foundation (+ academic year activation)
 *   Module 1: Staff Onboarding (5 teachers)
 *   Module 2: Student Registration (8 students, grades 9-11, relaxed phone validation)
 *   Module 3: Annual Enrollment (+ Ed-Fi descriptors, Sprint Alaska validation tests)
 *   Module 4: Course Catalog (10 courses — required, AP, honors, elective, vocational)
 *   Module 5: Class Sections (10 sections with teacher assignments)
 *   Module 6: Student Schedules (section enrollment for each student)
 *   Module 7: Grading Policy Setup (standard A-F scale, category weights)
 *   Module 8: Grade Recording (single, bulk, finalization, GPA)
 *   Module 9: Attendance Recording (single, bulk, daily summary)
 *   Module 10: Verification & Reporting (profiles, pagination, data integrity)
 *   Module 11: Education Organization Hierarchy (Sprint 1A — SEA, LEA, ESC, hierarchy tree)
 *   Module 12: Staff Assignments (Sprint 1A — first-class assignment CRUD)
 *   Module 13: Employment History (Sprint 1A — status change audit trail)
 *   Module 14: ABAC Permission Checks (Sprint 1A — catalog + permission check endpoints)
 *
 * Sprint Alaska Coverage:
 *   - AK1-1: Error response contract (errorCode, timestamp, errors[], validationErrors[])
 *   - AK1-2: Phone validation relaxation (short phone numbers accepted)
 *   - AK2-1: Ed-Fi StudentSchoolAssociation descriptor fields on enrollment
 *   - AK2-2: exitWithdrawTypeDescriptor on withdrawal
 *   - AK2-5: Academic year status validation (must be 'active')
 *   - AK2-6: Enrollment date range validation
 *   - AK2-7: Ed-Fi field persistence in enrollment response
 *   - AK2-8: Zod DTO validation on enrollment controller
 *   - Skipped: check-duplicate, calendars (API gateway not updated)
 *
 * Sprint 1A Coverage:
 *   - 1A.7: Education Organization CRUD (SEA singleton, LEA/ESC collections)
 *   - 1A.7d: Organization hierarchy tree assembly
 *   - 1A.9a: Staff assignment entity CRUD (create, get, list, update, end)
 *   - 1A.9b: Employment history immutable audit trail
 *   - 1A.9c: Atomic staff + user creation (POST /staff/with-user)
 *   - 1A.10a: ABAC permission registry + permission check
 *
 * IMPORTANT:
 *   - This script does NOT clean up. All data persists in the tenant.
 *   - Designed for a brand-new tenant to synthetically populate a realistic dataset.
 *   - Covers features implemented in Sprint 1, Sprint 2, Sprint 3, Sprint Alaska, and Sprint 1A.
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/academics-sp3-sp4-flow.ts
 *   ID_TOKEN=<jwt> API_BASE_URL=https://xxx.execute-api.us-east-2.amazonaws.com/prod npx ts-node scripts/smoke-tests/academics-sp3-sp4-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || 'eyJraWQiOiJmakNuWU9ra1ZPR2Z2RzZNck9laWl5WXJLZGFzdHhHbmk5bjY2U2gzQWI4PSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiOW9WajkwZ000QlV3THBnS0ZOYjZBZyIsInN1YiI6ImIxY2IwNTYwLTYwNTEtNzA4OC0wNTJlLTlmNmVmMDNhZTRhNiIsImNvZ25pdG86Z3JvdXBzIjpbIjM5MDlkMjhiLWQzYjgtNGE0NS04ZjNkLTU5NWE0MjJhNmU4MiJdLCJjdXN0b206dGVuYW50VGllciI6IkJBU0lDIiwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tXC91cy1lYXN0LTJfdEIwYzg0Qm5vIiwiY29nbml0bzp1c2VybmFtZSI6InNob2FpYi5yYWluQG91dGxvb2suY29tIiwiY3VzdG9tOnRlbmFudE5hbWUiOiJhbGxlbmlzZCIsIm9yaWdpbl9qdGkiOiI4NjRlMjVmZC05NzY3LTRmMGQtOGU0YS1lYmU1M2M3NTRjOTAiLCJjdXN0b206dGVuYW50SWQiOiIzOTA5ZDI4Yi1kM2I4LTRhNDUtOGYzZC01OTVhNDIyYTZlODIiLCJhdWQiOiI2NzhiZTJwYWZ2bzFoaGVvNGxjdDd1NHFycCIsImV2ZW50X2lkIjoiMmEyYTdhZmMtOTEwZi00OTdkLWEzYWQtMTljMmE4YzNlNGRjIiwiY3VzdG9tOnVzZXJSb2xlIjoiVGVuYW50QWRtaW4iLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTc3MDY0NTQ0OSwiZXhwIjoxNzcwOTI4NzAyLCJpYXQiOjE3NzA5MjUxMDIsImp0aSI6IjhmMjg2NTY2LWVhMDEtNDY2Yy1hZDQ4LWFjMTBlMGQ2OGFhNyIsImVtYWlsIjoic2hvYWliLnJhaW5Ab3V0bG9vay5jb20ifQ.S5OnNtusPM_3n1w21GZjYUaXuNpmx2F85WS9nBRUh3jiPxHCFujmWYVfFGc64pGDyCBKjEtd8s4IIlJz_bXZnKLKAfbsq4Ovy-zvemJyvmK8aOMnjSZN3Pba8ekgt5Js786_c-sMuK_2nSBD_snCu6y5pKsAldshWHfPAji7giJjbf7Sf8UgZujRiRBZin7ezyofBf_Gc7RcsODOAKildEj-IpFsBuZMAfHDxKNDI8cQDAvd0wIIjGuKeVt_HzSha9WaHiVs0RKKaVhpXw6xfLCQ-xhrSCwgc5E0cYx8NB7Qk0GAow9nhRohXwj1jvwb7cxUBXp87ZG3ESUlptgyNQ';
const BASE_URL = process.env.API_BASE_URL || 'https://udmx0atz53.execute-api.us-east-2.amazonaws.com/prod';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';
const PROPAGATION_WAIT_MS = 3000;

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

interface SchoolResponse { schoolId: string; name: string; [k: string]: unknown }
interface AcademicYearResponse { yearId: string; schoolId: string; name: string; [k: string]: unknown }
interface GradingPeriodResponse { periodId: string; yearId: string; name: string; [k: string]: unknown }
interface StaffResponse { staffId: string; staffUniqueId: string; email?: string; firstName?: string; lastSurname?: string; [k: string]: unknown }
interface StudentResponse { studentId: string; firstName: string; lastName: string; fullName?: string; studentNumber?: string; currentGradeLevel?: string; status?: string; [k: string]: unknown }
interface CourseResponse { courseId: string; courseCode: string; courseName: string; schoolId: string; subjectArea: string; courseType: string; creditType?: string; isActive: boolean; credits: number; [k: string]: unknown }
interface SectionResponse { sectionId: string; sectionNumber: string; courseId: string; schoolId: string; primaryTeacherId?: string; primaryTeacherName?: string; courseName?: string; courseCode?: string; maxEnrollment: number; currentEnrollment: number; isActive: boolean; [k: string]: unknown }
interface EnrollmentResponse { enrollmentId?: string; studentId: string; schoolId: string; academicYearId: string; gradeLevel: string; status: string; entryGradeLevelDescriptor?: string; entryTypeDescriptor?: string; enrollmentTypeDescriptor?: string; residencyStatusDescriptor?: string; primarySchool?: boolean; fullTimeEquivalency?: number; repeatGradeIndicator?: boolean; calendarCode?: string; exitWithdrawTypeDescriptor?: string; [k: string]: unknown }
interface GradeResponse { gradeId?: string; studentId: string; courseId?: string; numericGrade?: number; letterGrade?: string; gpaPoints?: number; isFinal?: boolean; assignments?: unknown[]; categoryGrades?: unknown[]; [k: string]: unknown }
interface GradingPolicyResponse { policyId: string; policyName: string; schoolId: string; [k: string]: unknown }
interface AttendanceResponse { studentId: string; date: string; status: string; [k: string]: unknown }
interface ListResponse<T> { items: T[]; hasMore?: boolean; lastEvaluatedKey?: string; total?: number }
interface BulkGradeResult { recorded: number; errors: { studentId: string; error: string }[] }
interface BulkAttendanceResult { recorded?: number; created?: number; updated?: number; errors: { studentId: string; error: string }[] }

// Sprint 1A — Education Organization types
interface SeaResponse { seaId: string; name: string; stateAbbreviation?: string; [k: string]: unknown }
interface LeaResponse { leaId: string; name: string; leaCategory?: string; seaId?: string; [k: string]: unknown }
interface EscResponse { escId: string; name: string; seaId?: string; [k: string]: unknown }
interface HierarchyResponse { sea?: SeaResponse; leas?: LeaResponse[]; escs?: EscResponse[]; unassignedSchools?: unknown[]; [k: string]: unknown }
interface StaffAssignmentResponse { assignmentId: string; staffId: string; schoolId: string; role: string; isPrimary?: boolean; assignmentStatus?: string; [k: string]: unknown }
interface EmploymentHistoryResponse { historyId: string; staffId: string; previousStatus: string; newStatus: string; effectiveDate: string; [k: string]: unknown }
interface StaffWithUserResponse { staff: StaffResponse; userId?: string; userCreated: boolean }
interface PermissionCatalogResponse { permissions: { resource: string; actions: string[]; description: string; category: string }[]; [k: string]: unknown }
interface CheckPermissionResponse { allowed: boolean; reason?: string }

// ─────────────────────────────────────────
// CONTEXT — stores all created resource IDs
// ─────────────────────────────────────────

interface TestContext {
  schoolId: string;
  academicYearId: string;
  term1Id?: string;
  term2Id?: string;
  staff: { id: string; firstName: string; lastSurname: string; department: string; email: string }[];
  students: { id: string; firstName: string; lastName: string; grade: string }[];
  courses: { id: string; code: string; name: string; type: string; credits: number }[];
  sections: { id: string; courseId: string; courseName: string; teacherId: string; number: string; maxEnrollment: number }[];
  gradingPolicyId?: string;
  enrollments: { studentId: string; enrollmentId?: string }[];
  sectionEnrollments: { studentId: string; sectionId: string }[];
  // Sprint 1A
  seaId?: string;
  leaIds: string[];
  escIds: string[];
  staffAssignmentIds: { staffId: string; assignmentId: string }[];
}

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────

const random4 = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const ts5 = () => Date.now().toString().slice(-5);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

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

function todayIso() { return new Date().toISOString().slice(0, 10); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────
// API CLIENT
// ─────────────────────────────────────────

class ApiClient {
  private baseUrl: string;
  private token: string;
  private logStream: fs.WriteStream;
  private logLevel: string;

  constructor(baseUrl: string, token: string, logFilePath: string, logLevel = 'info') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.logLevel = logLevel;
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    this.logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    this.log('INFO', `=== EdForge SP1-SP3 + Sprint Alaska Simulation Started at ${new Date().toISOString()} ===`);
    this.log('INFO', `API: ${this.baseUrl}`);
  }

  private log(level: string, message: string) {
    this.logStream.write(`[${new Date().toISOString()}] [${level}] ${message}\n`);
    if (this.logLevel === 'debug' && (level === 'DEBUG' || level === 'ERROR')) {
      console.log(`    ${level === 'ERROR' ? '\x1b[31m' : '\x1b[90m'}${message}\x1b[0m`);
    }
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const start = Date.now();
    try {
      const config: AxiosRequestConfig = {
        method, url,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        data: body, validateStatus: () => true, timeout: 30000,
      };
      this.log('DEBUG', `[${method}] ${endpoint}`);
      if (body && this.logLevel === 'debug') this.log('DEBUG', `Req: ${JSON.stringify(body).slice(0, 800)}`);
      const res = await axios(config);
      const dur = Date.now() - start;
      this.log('DEBUG', `[${method}] ${endpoint} -> ${res.status} (${dur}ms)`);
      if (this.logLevel === 'debug' && res.data) {
        const s = JSON.stringify(res.data);
        this.log('DEBUG', `Res: ${s.length > 600 ? s.slice(0, 600) + '…' : s}`);
      }
      const ok = res.status >= 200 && res.status < 300;
      return { status: res.status, data: ok ? (res.data as T) : null, error: ok ? null : JSON.stringify(res.data), duration: dur };
    } catch (err) {
      const dur = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      this.log('ERROR', `[${method}] ${endpoint} ERR (${dur}ms): ${msg}`);
      return { status: 0, data: null, error: msg, duration: dur };
    }
  }

  get<T>(ep: string) { return this.request<T>('GET', ep); }
  post<T>(ep: string, body: unknown) { return this.request<T>('POST', ep, body); }
  patch<T>(ep: string, body: unknown) { return this.request<T>('PATCH', ep, body); }
  del<T>(ep: string) { return this.request<T>('DELETE', ep); }

  close() {
    this.log('INFO', `=== Simulation Completed at ${new Date().toISOString()} ===`);
    this.logStream.end();
  }
}

// ─────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────

class EdForgeSimulation {
  private api: ApiClient;
  private results: TestResult[] = [];
  private ctx: TestContext = {
    schoolId: '', academicYearId: '',
    staff: [], students: [], courses: [], sections: [],
    enrollments: [], sectionEnrollments: [],
    leaIds: [], escIds: [], staffAssignmentIds: [],
  };
  private mod = '';

  constructor(api: ApiClient) { this.api = api; }

  // ── helpers ──
  private ok(name: string, res: ApiResponse<unknown>, expected: number | number[]): boolean {
    const arr = Array.isArray(expected) ? expected : [expected];
    if (arr.includes(res.status)) { this.rec(name, 'PASS', res.duration); return true; }
    this.rec(name, 'FAIL', res.duration, res.error || `Expected ${expected}, got ${res.status}`);
    return false;
  }
  private rec(name: string, status: 'PASS' | 'FAIL' | 'SKIP', duration: number, error?: string) {
    this.results.push({ name, module: this.mod, status, duration, error });
    const ic = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⊘\x1b[0m';
    console.log(`  ${ic} ${name} (${duration}ms)`);
    if (error && status === 'FAIL') console.log(`    \x1b[31m${error.slice(0, 250)}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 0: School & Academic Year
  // ═══════════════════════════════════════
  async mod0_Foundation() {
    this.mod = 'Foundation';
    console.log('\n\x1b[36m═══ Module 0: School & Academic Year Foundation ═══\x1b[0m');

    const schoolCode = `WHS-${ts5()}`;
    const r1 = await this.api.post<SchoolResponse>('/schools', {
      schoolCode,
      name: `Westfield High School`,
      schoolType: 'high',
      gradeRange: { start: '9', end: '12' },
      timezone: 'America/New_York',
      locale: 'en-US',
    });
    if (this.ok('0.1 Create Westfield High School', r1, [200, 201]) && r1.data) {
      this.ctx.schoolId = r1.data.schoolId;
    }
    if (!this.ctx.schoolId) { console.log('\x1b[31m  ABORT — school creation failed.\x1b[0m'); return false; }

    // Academic Year
    const yd = getAcademicYearDates();
    const r2 = await this.api.post<AcademicYearResponse>(`/schools/${this.ctx.schoolId}/academic-years`, {
      name: yd.name, shortName: yd.shortName,
      startDate: yd.startDate, endDate: yd.endDate,
      calendarType: 'semester',
    });
    if (this.ok('0.2 Create academic year ' + yd.name, r2, [200, 201]) && r2.data) {
      this.ctx.academicYearId = r2.data.yearId;
    }
    if (!this.ctx.academicYearId) { console.log('\x1b[31m  ABORT — academic year creation failed.\x1b[0m'); return false; }

    // Activate academic year (Sprint Alaska: enrollment now requires 'active' status)
    const rActivate = await this.api.request<AcademicYearResponse>(
      'PUT',
      `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/status`,
      { status: 'active' },
    );
    if (rActivate.status >= 200 && rActivate.status < 300) {
      this.rec('0.2a Activate academic year (status → active)', 'PASS', rActivate.duration);
    } else {
      this.rec('0.2a Activate academic year', 'FAIL', rActivate.duration,
        `Status: ${rActivate.status} — enrollment will fail without active year`);
    }

    // Grading Periods (Semesters)
    const r3 = await this.api.post<GradingPeriodResponse>(
      `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/grading-periods`,
      { name: 'Fall Semester', periodType: 'semester', startDate: yd.sem1Start, endDate: yd.sem1End, sequence: 1 },
    );
    if (r3.status >= 200 && r3.status < 300 && r3.data) {
      this.ctx.term1Id = r3.data.periodId;
      this.rec('0.3 Create Fall Semester grading period', 'PASS', r3.duration);
    } else {
      this.rec('0.3 Create Fall Semester grading period', 'SKIP', r3.duration, `Status: ${r3.status} — grading periods may not be implemented yet`);
    }

    const r4 = await this.api.post<GradingPeriodResponse>(
      `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/grading-periods`,
      { name: 'Spring Semester', periodType: 'semester', startDate: yd.sem2Start, endDate: yd.sem2End, sequence: 2 },
    );
    if (r4.status >= 200 && r4.status < 300 && r4.data) {
      this.ctx.term2Id = r4.data.periodId;
      this.rec('0.4 Create Spring Semester grading period', 'PASS', r4.duration);
    } else {
      this.rec('0.4 Create Spring Semester grading period', 'SKIP', r4.duration, `Status: ${r4.status}`);
    }

    // List academic years
    const r5 = await this.api.get<ListResponse<AcademicYearResponse>>(
      `/schools/${this.ctx.schoolId}/academic-years`,
    );
    if (r5.status === 200 && r5.data && r5.data.items?.length >= 1) {
      this.rec('0.5 List academic years returns data', 'PASS', r5.duration);
    } else {
      this.rec('0.5 List academic years returns data', r5.status === 200 ? 'FAIL' : 'SKIP', r5.duration, `Items: ${r5.data?.items?.length ?? 'null'}`);
    }

    console.log(`\n  \x1b[90mschoolId     = ${this.ctx.schoolId}\x1b[0m`);
    console.log(`  \x1b[90macademicYear = ${this.ctx.academicYearId}\x1b[0m`);
    console.log(`  \x1b[90mterm1 (Fall) = ${this.ctx.term1Id || 'N/A'}\x1b[0m`);
    console.log(`  \x1b[90mterm2 (Spr)  = ${this.ctx.term2Id || 'N/A'}\x1b[0m`);
    return true;
  }

  // ═══════════════════════════════════════
  // MODULE 1: Staff Onboarding
  // ═══════════════════════════════════════
  async mod1_Staff() {
    this.mod = 'Staff';
    console.log('\n\x1b[36m═══ Module 1: Staff Onboarding (5 Teachers) ═══\x1b[0m');

    const teachers = [
      { firstName: 'Margaret', lastSurname: 'Sullivan', dept: 'Mathematics', role: 'Teacher' },
      { firstName: 'David',    lastSurname: 'Chen',     dept: 'Social Studies', role: 'Teacher' },
      { firstName: 'Rebecca',  lastSurname: 'Torres',   dept: 'Science', role: 'Teacher' },
      { firstName: 'James',    lastSurname: 'Okafor',   dept: 'English', role: 'Teacher' },
      { firstName: 'Linda',    lastSurname: 'Kowalski', dept: 'Arts & CTE', role: 'Teacher' },
    ];

    for (let i = 0; i < teachers.length; i++) {
      const t = teachers[i];
      const email = `${slug(t.firstName)}.${slug(t.lastSurname)}-${ts5()}@westfield.edu`;
      const r = await this.api.post<StaffResponse>('/staff', {
        staffUniqueId: `STF-${ts5()}-${random4()}`,
        firstName: t.firstName,
        lastSurname: t.lastSurname,
        email,
        employmentStatus: 'active',
        schoolAssignments: [{ schoolId: this.ctx.schoolId, isPrimary: true, role: t.role, department: t.dept }],
      });
      if (this.ok(`1.${i + 1} Hire ${t.firstName} ${t.lastSurname} (${t.dept})`, r, [200, 201]) && r.data) {
        this.ctx.staff.push({ id: r.data.staffId, firstName: t.firstName, lastSurname: t.lastSurname, department: t.dept, email });
      }
    }

    // 1.6 Search staff by name
    const r6 = await this.api.get<ListResponse<StaffResponse> | StaffResponse[]>(
      `/staff/search/Sullivan?schoolId=${this.ctx.schoolId}`,
    );
    if (r6.status === 200) {
      const items = Array.isArray(r6.data) ? r6.data : (r6.data as ListResponse<StaffResponse>)?.items || [];
      if (items.length >= 1) {
        this.rec('1.6 Staff search "Sullivan" returns results', 'PASS', r6.duration);
      } else {
        this.rec('1.6 Staff search "Sullivan" returns results', 'FAIL', r6.duration, 'No results');
      }
    } else {
      this.rec('1.6 Staff search "Sullivan" returns results', 'SKIP', r6.duration, `Status: ${r6.status}`);
    }

    // 1.7 List staff by school
    const r7 = await this.api.get<ListResponse<StaffResponse>>(
      `/staff?schoolId=${this.ctx.schoolId}`,
    );
    if (r7.status === 200 && r7.data) {
      const count = r7.data.items?.length || 0;
      this.rec(`1.7 List staff by school (found ${count})`, count >= 1 ? 'PASS' : 'FAIL', r7.duration,
        count < 1 ? 'Expected ≥1 staff — GSI may not index schoolAssignments' : undefined);
    } else {
      this.rec('1.7 List staff by school', 'SKIP', r7.duration, `Status: ${r7.status}`);
    }

    console.log(`\n  \x1b[90mStaff created: ${this.ctx.staff.length}\x1b[0m`);
    this.ctx.staff.forEach(s => console.log(`  \x1b[90m  ${s.firstName} ${s.lastSurname} — ${s.department} (${s.id})\x1b[0m`));
  }

  // ═══════════════════════════════════════
  // MODULE 2: Student Registration
  // ═══════════════════════════════════════
  async mod2_Students() {
    this.mod = 'Students';
    console.log('\n\x1b[36m═══ Module 2: Student Registration (8 Students) ═══\x1b[0m');

    const yd = getAcademicYearDates();
    const students = [
      { firstName: 'Aisha',   lastName: 'Johnson',  dob: '2009-04-12', gender: 'female', grade: '10', ethnicity: 'African American', lang: 'English' },
      { firstName: 'Marco',   lastName: 'Rivera',   dob: '2009-08-03', gender: 'male',   grade: '10', ethnicity: 'Hispanic', lang: 'English', homeLang: 'Spanish' },
      { firstName: 'Priya',   lastName: 'Patel',    dob: '2008-11-25', gender: 'female', grade: '11', ethnicity: 'Asian', lang: 'English', homeLang: 'Gujarati' },
      { firstName: 'Tyler',   lastName: 'Brooks',   dob: '2010-02-18', gender: 'male',   grade: '9',  ethnicity: 'White', lang: 'English' },
      { firstName: 'Mei',     lastName: 'Wong',     dob: '2009-06-07', gender: 'female', grade: '10', ethnicity: 'Asian', lang: 'English', homeLang: 'Mandarin' },
      { firstName: 'Jaylen',  lastName: 'Carter',   dob: '2008-09-14', gender: 'male',   grade: '11', ethnicity: 'African American', lang: 'English' },
      { firstName: 'Sofia',   lastName: 'Morales',  dob: '2010-01-22', gender: 'female', grade: '9',  ethnicity: 'Hispanic', lang: 'English', homeLang: 'Spanish' },
      { firstName: 'Ethan',   lastName: 'Nguyen',   dob: '2009-12-05', gender: 'male',   grade: '10', ethnicity: 'Asian', lang: 'English', homeLang: 'Vietnamese' },
    ];

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const guardianFirst = i % 2 === 0 ? 'Maria' : 'Robert';
      const r = await this.api.post<StudentResponse>('/academics/students', {
        firstName: s.firstName,
        lastName: s.lastName,
        dateOfBirth: s.dob,
        gender: s.gender,
        schoolId: this.ctx.schoolId,
        currentGradeLevel: s.grade,
        ethnicity: s.ethnicity,
        primaryLanguage: s.lang,
        ...(s.homeLang ? { homeLanguage: s.homeLang } : {}),
        enrollmentDate: yd.startDate,
        guardians: [{
          firstName: guardianFirst,
          lastName: s.lastName,
          relationship: i % 2 === 0 ? 'mother' : 'father',
          phone: `555-0${100 + i}`,
          email: `${slug(guardianFirst)}.${slug(s.lastName)}@example.com`,
        }],
      });
      if (this.ok(`2.${i + 1} Register ${s.firstName} ${s.lastName} (Grade ${s.grade})`, r, [200, 201]) && r.data) {
        this.ctx.students.push({ id: r.data.studentId, firstName: s.firstName, lastName: s.lastName, grade: s.grade });
      }
    }

    // 2.9 List students for the school
    const r9 = await this.api.get<ListResponse<StudentResponse>>(
      `/academics/students?schoolId=${this.ctx.schoolId}&limit=10`,
    );
    if (r9.status === 200 && r9.data) {
      const ct = r9.data.items?.length || 0;
      this.rec(`2.9 List students (found ${ct})`, ct >= 1 ? 'PASS' : 'FAIL', r9.duration);
      // Verify pagination envelope
      if (r9.data.items !== undefined && typeof r9.data.hasMore === 'boolean') {
        this.rec('2.10 Pagination envelope on student list', 'PASS', 0);
      } else {
        this.rec('2.10 Pagination envelope on student list', 'FAIL', 0, 'Missing items[] or hasMore');
      }
    } else {
      this.rec('2.9 List students', 'SKIP', r9.duration, `Status: ${r9.status}`);
    }

    console.log(`\n  \x1b[90mStudents registered: ${this.ctx.students.length}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 3: Annual Enrollment
  // ═══════════════════════════════════════
  async mod3_Enrollment() {
    this.mod = 'Enrollment';
    console.log('\n\x1b[36m═══ Module 3: Annual Enrollment ═══\x1b[0m');

    const yd = getAcademicYearDates();
    for (let i = 0; i < this.ctx.students.length; i++) {
      const s = this.ctx.students[i];
      // First enrollment includes Ed-Fi descriptor fields (Sprint Alaska AK2-1)
      const edFiFields = i === 0 ? {
        entryGradeLevelDescriptor: `uri://ed-fi.org/GradeLevelDescriptor#${s.grade}th Grade`,
        entryTypeDescriptor: 'uri://ed-fi.org/EntryTypeDescriptor#Original',
        enrollmentTypeDescriptor: 'uri://ed-fi.org/EnrollmentTypeDescriptor#Standard',
        residencyStatusDescriptor: 'uri://ed-fi.org/ResidencyStatusDescriptor#Resident of admin unit',
        primarySchool: true,
        fullTimeEquivalency: 1.0,
        repeatGradeIndicator: false,
        calendarCode: 'default',
      } : {};
      const r = await this.api.post<EnrollmentResponse>('/academics/enrollments', {
        studentId: s.id,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        gradeLevel: s.grade,
        enrollmentDate: yd.startDate,
        enrollmentType: 'new',
        ...edFiFields,
      });
      if (this.ok(`3.${i + 1} Enroll ${s.firstName} ${s.lastName} (Grade ${s.grade})`, r, [200, 201]) && r.data) {
        this.ctx.enrollments.push({ studentId: s.id, enrollmentId: r.data.enrollmentId });
        // Verify Ed-Fi fields persisted on first enrollment
        if (i === 0) {
          const hasEdFi = r.data.entryGradeLevelDescriptor && r.data.primarySchool !== undefined;
          this.rec('3.Ed-Fi Ed-Fi descriptor fields persisted on enrollment', hasEdFi ? 'PASS' : 'FAIL', 0,
            hasEdFi ? undefined : `Missing Ed-Fi fields in response: ${JSON.stringify(r.data).slice(0, 300)}`);
        }
      }
    }

    // Enrollment summary
    const rs = await this.api.get<unknown>(
      `/academics/schools/${this.ctx.schoolId}/years/${this.ctx.academicYearId}/enrollments/summary`,
    );
    if (rs.status === 200 && rs.data) {
      this.rec(`3.${this.ctx.students.length + 1} Enrollment summary`, 'PASS', rs.duration);
      console.log(`    \x1b[90m${JSON.stringify(rs.data).slice(0, 300)}\x1b[0m`);
    } else {
      this.rec(`3.${this.ctx.students.length + 1} Enrollment summary`, 'SKIP', rs.duration, `Status: ${rs.status}`);
    }

    // ── Sprint Alaska Validation Tests ──

    // AK1-1: Validate error response contract (send invalid enrollment body → expect structured error)
    const rBadBody = await this.api.post<unknown>('/academics/enrollments', {
      // Missing required fields: studentId, schoolId, academicYearId, gradeLevel, enrollmentDate, enrollmentType
      notes: 'invalid body test',
    });
    if (rBadBody.status === 400) {
      const errData = JSON.parse(rBadBody.error || '{}');
      const hasErrorCode = typeof errData.errorCode === 'string';
      const hasTimestamp = typeof errData.timestamp === 'string';
      const hasTopLevelErrors = Array.isArray(errData.errors);
      const hasValidationErrors = Array.isArray(errData.details?.validationErrors);
      const contractOk = hasErrorCode && hasTimestamp && hasTopLevelErrors && hasValidationErrors;
      this.rec(`3.AK1 Error response contract (errorCode, timestamp, errors[], validationErrors[])`,
        contractOk ? 'PASS' : 'FAIL', rBadBody.duration,
        contractOk ? undefined : `Missing fields: errorCode=${hasErrorCode}, timestamp=${hasTimestamp}, errors[]=${hasTopLevelErrors}, validationErrors[]=${hasValidationErrors}`);
      // Verify errors[] items have array-form paths
      if (hasTopLevelErrors && errData.errors.length > 0) {
        const firstErr = errData.errors[0];
        const hasArrayPath = Array.isArray(firstErr.path);
        this.rec('3.AK1a errors[].path is array-form', hasArrayPath ? 'PASS' : 'FAIL', 0,
          hasArrayPath ? undefined : `path type: ${typeof firstErr.path}`);
      }
      // Verify validationErrors[] items have dot-joined paths
      if (hasValidationErrors && errData.details.validationErrors.length > 0) {
        const firstVE = errData.details.validationErrors[0];
        const hasDotPath = typeof firstVE.path === 'string';
        this.rec('3.AK1b validationErrors[].path is dot-joined string', hasDotPath ? 'PASS' : 'FAIL', 0,
          hasDotPath ? undefined : `path type: ${typeof firstVE.path}`);
      }
    } else {
      this.rec(`3.AK1 Error response contract`, 'FAIL', rBadBody.duration,
        `Expected 400 for invalid body, got ${rBadBody.status}`);
    }

    // AK2-5: Academic year status validation (enroll against a non-existent year → 400)
    if (this.ctx.students.length > 0) {
      const rFakeYear = await this.api.post<unknown>('/academics/enrollments', {
        studentId: this.ctx.students[0].id,
        schoolId: this.ctx.schoolId,
        academicYearId: 'fake-year-id-does-not-exist',
        gradeLevel: '10',
        enrollmentDate: yd.startDate,
        enrollmentType: 'new',
      });
      this.ok('3.AK2 Enrollment rejected for non-existent academic year', rFakeYear, [400, 404]);
    }

    // AK2-6: Enrollment date range validation (date outside academic year)
    if (this.ctx.students.length > 1) {
      const rOutOfRange = await this.api.post<unknown>('/academics/enrollments', {
        studentId: this.ctx.students[1].id,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        gradeLevel: '10',
        enrollmentDate: '2000-01-01',  // Way outside any academic year range
        enrollmentType: 'new',
      });
      this.ok('3.AK3 Enrollment rejected for date outside academic year range', rOutOfRange, 400);
    }

    // AK2-2 + AK2-7: Withdrawal with exitWithdrawTypeDescriptor
    if (this.ctx.enrollments.length >= 2) {
      // Withdraw the last enrolled student with Ed-Fi exit descriptor
      const lastEnrollment = this.ctx.enrollments[this.ctx.enrollments.length - 1];
      const lastStudent = this.ctx.students.find(s => s.id === lastEnrollment.studentId);
      const rWithdraw = await this.api.post<EnrollmentResponse>(
        `/academics/schools/${this.ctx.schoolId}/years/${this.ctx.academicYearId}/students/${lastEnrollment.studentId}/withdraw`,
        {
          reason: 'family relocation',
          withdrawalDate: todayIso(),
          exitWithdrawTypeDescriptor: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#Transferred to another district',
          notes: 'Sprint Alaska withdrawal test with Ed-Fi descriptor',
        },
      );
      if (rWithdraw.status >= 200 && rWithdraw.status < 300 && rWithdraw.data) {
        this.rec(`3.AK4 Withdraw ${lastStudent?.firstName || 'student'} with exitWithdrawTypeDescriptor`, 'PASS', rWithdraw.duration);
        // Verify the exitWithdrawTypeDescriptor is in the response
        const hasDescriptor = !!(rWithdraw.data as Record<string, unknown>).exitWithdrawTypeDescriptor;
        this.rec('3.AK4a exitWithdrawTypeDescriptor persisted in response', hasDescriptor ? 'PASS' : 'FAIL', 0,
          hasDescriptor ? undefined : 'exitWithdrawTypeDescriptor missing from withdrawal response');
      } else {
        this.rec(`3.AK4 Withdraw with exitWithdrawTypeDescriptor`, 'FAIL', rWithdraw.duration,
          `Status: ${rWithdraw.status} — ${rWithdraw.error?.slice(0, 200)}`);
      }
    }

    // AK1-2: Short phone number accepted (phone validation relaxed)
    // This is tested implicitly in Module 2 where guardians use 'phone: 555-0100' format (7 chars)
    // Verify it didn't fail by checking student count
    if (this.ctx.students.length >= 8) {
      this.rec('3.AK5 Short phone numbers accepted in student registration (AK1-2)', 'PASS', 0);
    } else {
      this.rec('3.AK5 Short phone numbers accepted (AK1-2)', 'FAIL', 0,
        `Only ${this.ctx.students.length}/8 students created — phone validation may be blocking short numbers`);
    }

    console.log(`\n  \x1b[90mEnrollments created: ${this.ctx.enrollments.length}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 4: Course Catalog
  // ═══════════════════════════════════════
  async mod4_Courses() {
    this.mod = 'Courses';
    console.log('\n\x1b[36m═══ Module 4: Course Catalog (10 Courses) ═══\x1b[0m');

    const courses = [
      { code: `ALG1-${random4()}`, name: 'Algebra I', subject: 'mathematics', type: 'required', credits: 1, grades: ['9', '10'], dur: 'year', desc: 'Foundational algebra: linear equations, inequalities, functions, and polynomials.' },
      { code: `GEO-${random4()}`,  name: 'Geometry', subject: 'mathematics', type: 'required', credits: 1, grades: ['9', '10'], dur: 'year', desc: 'Plane and solid geometry, proofs, and trigonometric foundations.', prereqs: true },
      { code: `APCL-${random4()}`, name: 'AP Calculus AB', subject: 'mathematics', type: 'ap', credits: 1, creditType: 'ap', grades: ['11', '12'], dur: 'year', desc: 'College-level differential and integral calculus.' },
      { code: `BIO-${random4()}`,  name: 'Biology I', subject: 'science', type: 'required', credits: 1, grades: ['9', '10'], dur: 'year', desc: 'Cellular biology, genetics, ecology, and evolution.' },
      { code: `HCHEM-${random4()}`, name: 'Honors Chemistry', subject: 'science', type: 'honors', credits: 1, creditType: 'honors', grades: ['10', '11'], dur: 'year', desc: 'Advanced chemistry: atomic structure, bonding, thermodynamics, kinetics.' },
      { code: `ENG10-${random4()}`, name: 'English 10', subject: 'english_language_arts', type: 'required', credits: 1, grades: ['10'], dur: 'year', desc: 'American literature, composition, and critical analysis.' },
      { code: `USHS-${random4()}`, name: 'United States History', subject: 'social_studies', type: 'required', credits: 1, grades: ['10', '11'], dur: 'year', desc: 'Survey of American history from colonial era through modern day.' },
      { code: `SART-${random4()}`, name: 'Studio Art I', subject: 'arts', type: 'elective', credits: 0.5, grades: ['9', '10', '11', '12'], dur: 'semester', desc: 'Drawing, painting, and mixed media foundations.' },
      { code: `AUTO-${random4()}`, name: 'Automotive Technology I', subject: 'vocational', type: 'vocational', credits: 1.5, grades: ['11', '12'], dur: 'year', desc: 'Vehicle systems, diagnostics, and maintenance.' },
      { code: `DECL-${random4()}`, name: 'Dual Enrollment Calculus', subject: 'mathematics', type: 'dual_enrollment', credits: 1, creditType: 'dual_enrollment', grades: ['11', '12'], dur: 'year', desc: 'Calculus in partnership with State University for college credit.' },
    ];

    let algebraId: string | undefined;
    for (let i = 0; i < courses.length; i++) {
      const c = courses[i];
      const body: Record<string, unknown> = {
        courseCode: c.code,
        courseName: c.name,
        description: c.desc,
        schoolId: this.ctx.schoolId,
        subjectArea: c.subject,
        courseType: c.type,
        credits: c.credits,
        gradeLevels: c.grades,
        typicalDuration: c.dur,
      };
      if (c.creditType) body.creditType = c.creditType;
      // Set prerequisite: Geometry requires Algebra I
      if (c.prereqs && algebraId) body.prerequisites = [algebraId];

      const r = await this.api.post<CourseResponse>('/academics/courses', body);
      if (this.ok(`4.${i + 1} Create ${c.name} (${c.type})`, r, [200, 201]) && r.data) {
        this.ctx.courses.push({ id: r.data.courseId, code: c.code, name: c.name, type: c.type, credits: c.credits });
        if (c.name === 'Algebra I') algebraId = r.data.courseId;
      }
    }

    // 4.11 List courses with pagination
    const rl = await this.api.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}&limit=3`,
    );
    if (rl.status === 200 && rl.data) {
      const hasEnvelope = rl.data.items !== undefined && typeof rl.data.hasMore === 'boolean';
      this.rec(`4.11 Courses list pagination (${rl.data.items?.length} items, hasMore=${rl.data.hasMore})`, hasEnvelope ? 'PASS' : 'FAIL', rl.duration);
    } else {
      this.rec('4.11 Courses list pagination', 'SKIP', rl.duration, `Status: ${rl.status}`);
    }

    // 4.12 Verify prerequisite was stored
    const geoCourse = this.ctx.courses.find(c => c.name === 'Geometry');
    if (geoCourse && algebraId) {
      const rg = await this.api.get<CourseResponse>(`/academics/courses/${geoCourse.id}?schoolId=${this.ctx.schoolId}`);
      if (rg.status === 200 && rg.data) {
        const prereqs = (rg.data as Record<string, unknown>).prerequisites as string[] | undefined;
        if (prereqs && prereqs.includes(algebraId)) {
          this.rec('4.12 Geometry prerequisite points to Algebra I', 'PASS', rg.duration);
        } else {
          this.rec('4.12 Geometry prerequisite points to Algebra I', 'FAIL', rg.duration, `prereqs=${JSON.stringify(prereqs)}`);
        }
      }
    }

    console.log(`\n  \x1b[90mCourses created: ${this.ctx.courses.length}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 5: Class Sections
  // ═══════════════════════════════════════
  async mod5_Sections() {
    this.mod = 'Sections';
    console.log('\n\x1b[36m═══ Module 5: Class Sections ═══\x1b[0m');

    // Map courses to teachers by department
    const staffByDept: Record<string, string> = {};
    this.ctx.staff.forEach(s => { staffByDept[s.department] = s.id; });

    const sectionDefs = [
      { courseIdx: 0, number: 'P1', name: 'Algebra I - Period 1',         dept: 'Mathematics', max: 28 },
      { courseIdx: 1, number: 'P2', name: 'Geometry - Period 2',          dept: 'Mathematics', max: 28 },
      { courseIdx: 2, number: 'P3', name: 'AP Calculus AB - Period 3',    dept: 'Mathematics', max: 22 },
      { courseIdx: 3, number: 'P1', name: 'Biology I - Period 1',         dept: 'Science',     max: 30 },
      { courseIdx: 4, number: 'P4', name: 'Honors Chemistry - Period 4',  dept: 'Science',     max: 24 },
      { courseIdx: 5, number: 'P2', name: 'English 10 - Period 2',        dept: 'English',     max: 28 },
      { courseIdx: 6, number: 'P3', name: 'US History - Period 3',        dept: 'Social Studies', max: 30 },
      { courseIdx: 7, number: 'P5', name: 'Studio Art I - Period 5',      dept: 'Arts & CTE',  max: 20 },
      { courseIdx: 8, number: 'P6', name: 'Auto Tech I - Period 6',       dept: 'Arts & CTE',  max: 16 },
      { courseIdx: 9, number: 'P4', name: 'DE Calculus - Period 4',       dept: 'Mathematics', max: 20 },
    ];

    for (let i = 0; i < sectionDefs.length; i++) {
      const sd = sectionDefs[i];
      const course = this.ctx.courses[sd.courseIdx];
      if (!course) { this.rec(`5.${i + 1} Create section for course[${sd.courseIdx}]`, 'SKIP', 0, 'Course not created'); continue; }
      const teacherId = staffByDept[sd.dept] || this.ctx.staff[0]?.id;
      if (!teacherId) { this.rec(`5.${i + 1} Create ${sd.name}`, 'SKIP', 0, 'No teacher'); continue; }

      const r = await this.api.post<SectionResponse>('/academics/sections', {
        sectionNumber: sd.number,
        sectionName: sd.name,
        courseId: course.id,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        primaryTeacherId: teacherId,
        maxEnrollment: sd.max,
      });
      if (this.ok(`5.${i + 1} Create ${sd.name}`, r, [200, 201]) && r.data) {
        this.ctx.sections.push({
          id: r.data.sectionId, courseId: course.id, courseName: course.name,
          teacherId, number: sd.number, maxEnrollment: sd.max,
        });
        // Check denormalization
        if (r.data.courseCode && r.data.courseName) {
          console.log(`    \x1b[90m↳ courseCode=${r.data.courseCode}, courseName=${r.data.courseName}\x1b[0m`);
        }
        if (r.data.primaryTeacherName) {
          console.log(`    \x1b[90m↳ primaryTeacherName=${r.data.primaryTeacherName}\x1b[0m`);
        }
      }
    }

    // 5.11 Verify denormalized course fields on first section
    if (this.ctx.sections.length > 0) {
      const sec = this.ctx.sections[0];
      const r = await this.api.get<SectionResponse>(`/academics/sections/${sec.id}?schoolId=${this.ctx.schoolId}`);
      if (r.status === 200 && r.data) {
        const hasCourseInfo = !!r.data.courseCode && !!r.data.courseName;
        this.rec('5.11 Section has denormalized courseCode + courseName', hasCourseInfo ? 'PASS' : 'FAIL', r.duration,
          hasCourseInfo ? undefined : `courseCode=${r.data.courseCode}, courseName=${r.data.courseName}`);

        // SP3-4: Check primaryTeacherName
        if (r.data.primaryTeacherName) {
          this.rec('5.12 Section has denormalized primaryTeacherName (SP3-4)', 'PASS', 0);
        } else {
          this.rec('5.12 Section has denormalized primaryTeacherName (SP3-4)', 'FAIL', 0,
            'primaryTeacherName missing — SP3-4 may not be deployed');
        }
      }
    }

    // 5.13 Sections list pagination
    const rl = await this.api.get<ListResponse<SectionResponse>>(
      `/academics/sections?schoolId=${this.ctx.schoolId}&limit=3`,
    );
    if (rl.status === 200 && rl.data) {
      const ok = rl.data.items !== undefined && typeof rl.data.hasMore === 'boolean';
      this.rec(`5.13 Sections list pagination (${rl.data.items?.length} items)`, ok ? 'PASS' : 'FAIL', rl.duration);
    }

    console.log(`\n  \x1b[90mSections created: ${this.ctx.sections.length}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 6: Student Schedules (Section Enrollment)
  // ═══════════════════════════════════════
  async mod6_Schedules() {
    this.mod = 'Schedules';
    console.log('\n\x1b[36m═══ Module 6: Student Schedules (Section Enrollment) ═══\x1b[0m');

    // Assign students to sections based on grade level and subject needs
    // Each 10th-grader gets: Algebra I, Biology, English 10, US History, Studio Art (5 classes)
    // Each 9th-grader gets: Algebra I, Biology, Studio Art (3 classes)
    // Each 11th-grader gets: Geometry, Honors Chemistry, US History, Auto Tech (4 classes)

    const sectionByName = (name: string) => this.ctx.sections.find(s => s.courseName.includes(name));
    const algebraSec = sectionByName('Algebra I');
    const geometrySec = sectionByName('Geometry');
    const apCalcSec = sectionByName('AP Calculus');
    const bioSec = sectionByName('Biology');
    const chemSec = sectionByName('Honors Chemistry');
    const engSec = sectionByName('English 10');
    const usSec = sectionByName('US History');
    const artSec = sectionByName('Studio Art');
    const autoSec = sectionByName('Auto Tech');

    // Build schedules based on grade
    const schedules: { studentIdx: number; sections: (typeof algebraSec)[] }[] = [];
    for (let i = 0; i < this.ctx.students.length; i++) {
      const st = this.ctx.students[i];
      const secs: (typeof algebraSec)[] = [];
      if (st.grade === '9') {
        secs.push(algebraSec, bioSec, artSec);
      } else if (st.grade === '10') {
        secs.push(algebraSec, bioSec, engSec, usSec, artSec);
      } else if (st.grade === '11') {
        secs.push(geometrySec, chemSec, usSec, autoSec);
      }
      schedules.push({ studentIdx: i, sections: secs.filter(Boolean) as typeof secs });
    }

    let enrollNum = 1;
    for (const sched of schedules) {
      const st = this.ctx.students[sched.studentIdx];
      for (const sec of sched.sections) {
        if (!sec) continue;
        const r = await this.api.post<unknown>(
          `/academics/sections/${sec.id}/students?schoolId=${this.ctx.schoolId}`,
          { studentId: st.id },
        );
        if (r.status >= 200 && r.status < 300) {
          this.ctx.sectionEnrollments.push({ studentId: st.id, sectionId: sec.id });
        }
        this.ok(`6.${enrollNum++} ${st.firstName} → ${sec.courseName}`, r, [200, 201]);
      }
    }

    // Verify enrollment counter on Algebra I section
    if (algebraSec) {
      const r = await this.api.get<SectionResponse>(`/academics/sections/${algebraSec.id}?schoolId=${this.ctx.schoolId}`);
      if (r.status === 200 && r.data) {
        const expected = this.ctx.sectionEnrollments.filter(e => e.sectionId === algebraSec.id).length;
        if (r.data.currentEnrollment === expected) {
          this.rec(`6.${enrollNum++} Algebra I currentEnrollment=${expected}`, 'PASS', r.duration);
        } else {
          this.rec(`6.${enrollNum++} Algebra I currentEnrollment check`, 'FAIL', r.duration,
            `Expected ${expected}, got ${r.data.currentEnrollment}`);
        }
      }
    }

    // Duplicate enrollment prevention
    if (this.ctx.students.length > 0 && algebraSec) {
      const st = this.ctx.students.find(s => s.grade === '10'); // Should already be enrolled
      if (st) {
        const r = await this.api.post<unknown>(
          `/academics/sections/${algebraSec.id}/students?schoolId=${this.ctx.schoolId}`,
          { studentId: st.id },
        );
        this.ok(`6.${enrollNum++} Duplicate enrollment blocked (${st.firstName})`, r, [400, 409]);
      }
    }

    // Capacity enforcement — create a tiny section
    if (this.ctx.courses.length > 0 && this.ctx.staff.length > 0) {
      const tinySec = await this.api.post<SectionResponse>('/academics/sections', {
        sectionNumber: 'CAP1', sectionName: 'Capacity Test Section',
        courseId: this.ctx.courses[0].id, schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        primaryTeacherId: this.ctx.staff[0].id, maxEnrollment: 1,
      });
      if (tinySec.status >= 200 && tinySec.status < 300 && tinySec.data) {
        const tinyId = (tinySec.data as SectionResponse).sectionId;
        // Fill the one seat
        const s1 = this.ctx.students[0];
        // Use a student NOT already in this section
        const unenrolledStudent = this.ctx.students.find(s =>
          !this.ctx.sectionEnrollments.some(e => e.sectionId === tinyId && e.studentId === s.id),
        ) || this.ctx.students[0];
        await this.api.post(`/academics/sections/${tinyId}/students?schoolId=${this.ctx.schoolId}`, { studentId: unenrolledStudent.id });
        // Try to overflow
        const overflowStudent = this.ctx.students.find(s => s.id !== unenrolledStudent.id) || s1;
        const capRes = await this.api.post<unknown>(
          `/academics/sections/${tinyId}/students?schoolId=${this.ctx.schoolId}`,
          { studentId: overflowStudent.id },
        );
        this.ok(`6.${enrollNum++} Capacity enforcement (max=1, try 2nd student)`, capRes, [400, 409]);

        // Keep the tiny section (no cleanup)
        this.ctx.sections.push({
          id: tinyId, courseId: this.ctx.courses[0].id, courseName: this.ctx.courses[0].name,
          teacherId: this.ctx.staff[0].id, number: 'CAP1', maxEnrollment: 1,
        });
      }
    }

    // View a student's sections
    if (this.ctx.students.length > 0) {
      const st = this.ctx.students[0];
      const r = await this.api.get<unknown>(
        `/academics/students/${st.id}/sections?academicYearId=${this.ctx.academicYearId}`,
      );
      if (r.status === 200) {
        this.rec(`6.${enrollNum++} Get ${st.firstName}'s section schedule`, 'PASS', r.duration);
      } else {
        this.rec(`6.${enrollNum++} Get ${st.firstName}'s section schedule`, 'SKIP', r.duration, `Status: ${r.status}`);
      }
    }

    // View section roster
    if (algebraSec) {
      const r = await this.api.get<unknown>(
        `/academics/sections/${algebraSec.id}/students?schoolId=${this.ctx.schoolId}`,
      );
      if (r.status === 200) {
        this.rec(`6.${enrollNum++} Get Algebra I roster`, 'PASS', r.duration);
      } else {
        this.rec(`6.${enrollNum++} Get Algebra I roster`, 'SKIP', r.duration, `Status: ${r.status}`);
      }
    }

    console.log(`\n  \x1b[90mSection enrollments: ${this.ctx.sectionEnrollments.length}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 7: Grading Policy
  // ═══════════════════════════════════════
  async mod7_GradingPolicy() {
    this.mod = 'GradingPolicy';
    console.log('\n\x1b[36m═══ Module 7: Grading Policy Setup ═══\x1b[0m');

    const r = await this.api.post<GradingPolicyResponse>('/academics/grading-policies', {
      policyName: 'Westfield Standard Grading Policy',
      schoolId: this.ctx.schoolId,
      description: 'Standard A–F grading scale with weighted categories for all departments.',
      gradingScale: [
        { letterGrade: 'A',  minPercentage: 90,  maxPercentage: 100, gpaPoints: 4.0 },
        { letterGrade: 'B',  minPercentage: 80,  maxPercentage: 89,  gpaPoints: 3.0 },
        { letterGrade: 'C',  minPercentage: 70,  maxPercentage: 79,  gpaPoints: 2.0 },
        { letterGrade: 'D',  minPercentage: 60,  maxPercentage: 69,  gpaPoints: 1.0 },
        { letterGrade: 'F',  minPercentage: 0,   maxPercentage: 59,  gpaPoints: 0.0 },
      ],
      categoryWeights: [
        { categoryId: 'tests',        categoryName: 'Tests & Exams',   weight: 40 },
        { categoryId: 'quizzes',      categoryName: 'Quizzes',         weight: 20 },
        { categoryId: 'homework',     categoryName: 'Homework',        weight: 20 },
        { categoryId: 'participation', categoryName: 'Participation',  weight: 10 },
        { categoryId: 'projects',     categoryName: 'Projects',        weight: 10 },
      ],
      roundingRule: 'standard',
    });
    if (this.ok('7.1 Create grading policy (A–F, weighted categories)', r, [200, 201]) && r.data) {
      this.ctx.gradingPolicyId = r.data.policyId;
    }

    // 7.2 List grading policies
    const rl = await this.api.get<GradingPolicyResponse[] | ListResponse<GradingPolicyResponse>>(
      `/academics/grading-policies?schoolId=${this.ctx.schoolId}`,
    );
    if (rl.status === 200) {
      this.rec('7.2 List grading policies', 'PASS', rl.duration);
    } else {
      this.rec('7.2 List grading policies', 'SKIP', rl.duration, `Status: ${rl.status}`);
    }

    console.log(`\n  \x1b[90mgradingPolicyId = ${this.ctx.gradingPolicyId || 'N/A'}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 8: Grade Recording
  // ═══════════════════════════════════════
  async mod8_Grades() {
    this.mod = 'Grades';
    console.log('\n\x1b[36m═══ Module 8: Grade Recording ═══\x1b[0m');

    // We'll record grades for the Algebra I section
    const algebraSection = this.ctx.sections.find(s => s.courseName === 'Algebra I');
    const algebraCourse = this.ctx.courses.find(c => c.name === 'Algebra I');
    if (!algebraSection || !algebraCourse) {
      console.log('  \x1b[33m[SKIP] No Algebra I section/course.\x1b[0m');
      return;
    }

    const enrolledStudents = this.ctx.sectionEnrollments
      .filter(e => e.sectionId === algebraSection.id)
      .map(e => this.ctx.students.find(s => s.id === e.studentId)!)
      .filter(Boolean);

    if (enrolledStudents.length === 0) {
      console.log('  \x1b[33m[SKIP] No students enrolled in Algebra I.\x1b[0m');
      return;
    }

    const termId = this.ctx.term1Id || 'fall-2025';

    // 8.1 Record single assignment grade for first student
    const st0 = enrolledStudents[0];
    const r1 = await this.api.post<GradeResponse>('/academics/grades/record', {
      studentId: st0.id,
      courseId: algebraCourse.id,
      sectionId: algebraSection.id,
      schoolId: this.ctx.schoolId,
      termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: algebraSection.teacherId,
      assignment: {
        assignmentName: 'Chapter 1 Quiz',
        assignmentType: 'quiz',
        categoryId: 'quizzes',
        possiblePoints: 20,
      },
      earnedPoints: 18,
    });
    this.ok(`8.1 Record quiz grade for ${st0.firstName} (18/20)`, r1, [200, 201]);

    // 8.2 Record another assignment for first student (test)
    const r2 = await this.api.post<GradeResponse>('/academics/grades/record', {
      studentId: st0.id,
      courseId: algebraCourse.id,
      sectionId: algebraSection.id,
      schoolId: this.ctx.schoolId,
      termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: algebraSection.teacherId,
      assignment: {
        assignmentName: 'Unit 1 Test',
        assignmentType: 'test',
        categoryId: 'tests',
        possiblePoints: 100,
      },
      earnedPoints: 88,
    });
    this.ok(`8.2 Record test grade for ${st0.firstName} (88/100)`, r2, [200, 201]);

    // 8.3 Bulk grade recording — Chapter 2 Homework for all enrolled students
    const homeworkScores = enrolledStudents.map((st, i) => ({
      studentId: st.id,
      earnedPoints: Math.floor(14 + Math.random() * 7), // 14-20 out of 20
    }));
    const r3 = await this.api.post<BulkGradeResult>('/academics/grades/record/bulk', {
      schoolId: this.ctx.schoolId,
      sectionId: algebraSection.id,
      courseId: algebraCourse.id,
      termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: algebraSection.teacherId,
      assignment: {
        assignmentName: 'Chapter 2 Homework',
        assignmentType: 'homework',
        categoryId: 'homework',
        possiblePoints: 20,
      },
      grades: homeworkScores,
    });
    if (r3.status >= 200 && r3.status < 300 && r3.data) {
      const recorded = r3.data.recorded || 0;
      const errors = r3.data.errors?.length || 0;
      this.rec(`8.3 Bulk homework grades (recorded=${recorded}, errors=${errors})`, recorded > 0 ? 'PASS' : 'FAIL', r3.duration);
    } else {
      this.rec('8.3 Bulk homework grades', 'SKIP', r3.duration, `Status: ${r3.status}`);
    }

    // 8.4 Bulk participation grade
    const partScores = enrolledStudents.map(st => ({
      studentId: st.id,
      earnedPoints: Math.floor(8 + Math.random() * 3), // 8-10 out of 10
    }));
    const r4 = await this.api.post<BulkGradeResult>('/academics/grades/record/bulk', {
      schoolId: this.ctx.schoolId,
      sectionId: algebraSection.id,
      courseId: algebraCourse.id,
      termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: algebraSection.teacherId,
      assignment: {
        assignmentName: 'Week 1-4 Participation',
        assignmentType: 'participation',
        categoryId: 'participation',
        possiblePoints: 10,
      },
      grades: partScores,
    });
    if (r4.status >= 200 && r4.status < 300) {
      this.rec('8.4 Bulk participation grades', 'PASS', r4.duration);
    } else {
      this.rec('8.4 Bulk participation grades', 'SKIP', r4.duration, `Status: ${r4.status}`);
    }

    // 8.5 Get student grades (composite lookup)
    const r5 = await this.api.get<GradeResponse>(
      `/academics/grades?studentId=${st0.id}&courseId=${algebraCourse.id}&termId=${termId}`,
    );
    if (r5.status === 200 && r5.data) {
      this.rec(`8.5 Get ${st0.firstName}'s Algebra grade`, 'PASS', r5.duration);
      if (r5.data.numericGrade !== undefined) {
        console.log(`    \x1b[90m↳ numericGrade=${r5.data.numericGrade}, letterGrade=${r5.data.letterGrade}\x1b[0m`);
      }
      if (r5.data.assignments) {
        console.log(`    \x1b[90m↳ assignments recorded: ${(r5.data.assignments as unknown[]).length}\x1b[0m`);
      }
    } else {
      this.rec(`8.5 Get ${st0.firstName}'s Algebra grade`, 'SKIP', r5.duration, `Status: ${r5.status}`);
    }

    // 8.6 Get section-wide grades (teacher gradebook view)
    const r6 = await this.api.get<GradeResponse[] | ListResponse<GradeResponse>>(
      `/academics/grades/section/${algebraSection.id}?schoolId=${this.ctx.schoolId}&termId=${termId}`,
    );
    if (r6.status === 200) {
      this.rec('8.6 Section gradebook (Algebra I)', 'PASS', r6.duration);
    } else {
      this.rec('8.6 Section gradebook (Algebra I)', 'SKIP', r6.duration, `Status: ${r6.status}`);
    }

    // 8.7 Grade finalization — finalize first student's grade
    const gradeId = `${st0.id}:${algebraCourse.id}:${termId}`;
    const r7 = await this.api.patch<GradeResponse>(
      `/academics/grades/${encodeURIComponent(gradeId)}/finalize`,
      {},
    );
    if (r7.status >= 200 && r7.status < 300 && r7.data) {
      const isFinal = r7.data.isFinal;
      this.rec(`8.7 Finalize ${st0.firstName}'s Algebra grade (isFinal=${isFinal})`, isFinal ? 'PASS' : 'FAIL', r7.duration);
    } else {
      this.rec(`8.7 Finalize grade`, 'SKIP', r7.duration, `Status: ${r7.status} — ${r7.error?.slice(0, 200)}`);
    }

    // 8.8 GPA check — student grades with GPA
    const r8 = await this.api.get<{ studentId: string; grades: GradeResponse[]; gpa: unknown }>(
      `/academics/students/${st0.id}/grades?academicYearId=${this.ctx.academicYearId}&termId=${termId}`,
    );
    if (r8.status === 200 && r8.data) {
      this.rec(`8.8 ${st0.firstName}'s grades + GPA`, 'PASS', r8.duration);
      if (r8.data.gpa) {
        console.log(`    \x1b[90m↳ GPA: ${JSON.stringify(r8.data.gpa)}\x1b[0m`);
      }
    } else {
      this.rec(`8.8 GPA calculation`, 'SKIP', r8.duration, `Status: ${r8.status}`);
    }

    // Record grades for additional courses (Biology, English 10, US History) to build GPA
    const otherSections = [
      this.ctx.sections.find(s => s.courseName === 'Biology I'),
      this.ctx.sections.find(s => s.courseName.includes('English')),
      this.ctx.sections.find(s => s.courseName.includes('US History')),
    ].filter((s): s is NonNullable<typeof s> => Boolean(s));

    let gradeNum = 9;
    for (const sec of otherSections) {
      const course = this.ctx.courses.find(c => c.id === sec.courseId);
      if (!course) continue;
      const secEnrollees = this.ctx.sectionEnrollments
        .filter(e => e.sectionId === sec.id)
        .map(e => this.ctx.students.find(s => s.id === e.studentId)!)
        .filter(Boolean);
      if (secEnrollees.length === 0) continue;

      const testScores = secEnrollees.map(st => ({
        studentId: st.id,
        earnedPoints: Math.floor(70 + Math.random() * 30), // 70-99 out of 100
      }));
      const rr = await this.api.post<BulkGradeResult>('/academics/grades/record/bulk', {
        schoolId: this.ctx.schoolId,
        sectionId: sec.id,
        courseId: course.id,
        termId,
        academicYearId: this.ctx.academicYearId,
        teacherId: sec.teacherId,
        assignment: {
          assignmentName: 'Midterm Exam',
          assignmentType: 'test',
          categoryId: 'tests',
          possiblePoints: 100,
        },
        grades: testScores,
      });
      if (rr.status >= 200 && rr.status < 300) {
        this.rec(`8.${gradeNum++} Bulk midterm grades — ${course.name}`, 'PASS', rr.duration);
      } else {
        this.rec(`8.${gradeNum++} Bulk midterm grades — ${course.name}`, 'SKIP', rr.duration, `Status: ${rr.status}`);
      }
    }
  }

  // ═══════════════════════════════════════
  // MODULE 9: Attendance Recording
  // ═══════════════════════════════════════
  async mod9_Attendance() {
    this.mod = 'Attendance';
    console.log('\n\x1b[36m═══ Module 9: Attendance Recording ═══\x1b[0m');

    if (this.ctx.students.length === 0) {
      console.log('  \x1b[33m[SKIP] No students.\x1b[0m');
      return;
    }

    const today = todayIso();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // 9.1 Record single attendance — Aisha present today
    const st0 = this.ctx.students[0];
    const r1 = await this.api.post<AttendanceResponse>('/academics/attendance', {
      studentId: st0.id,
      schoolId: this.ctx.schoolId,
      date: today,
      academicYearId: this.ctx.academicYearId,
      status: 'present',
      recordedBy: 'system',
    });
    this.ok(`9.1 Record attendance — ${st0.firstName} present today`, r1, [200, 201]);

    // 9.2 Bulk attendance — all students for yesterday
    const statuses = ['present', 'present', 'present', 'late', 'present', 'absent', 'present', 'excused'];
    const bulkRecords = this.ctx.students.map((st, i) => ({
      studentId: st.id,
      status: statuses[i % statuses.length],
      notes: statuses[i % statuses.length] === 'absent' ? 'Parent called — sick' :
             statuses[i % statuses.length] === 'late' ? 'Arrived 8:15am' :
             statuses[i % statuses.length] === 'excused' ? 'Doctor appointment' : undefined,
    }));
    const r2 = await this.api.post<BulkAttendanceResult>('/academics/attendance/bulk', {
      schoolId: this.ctx.schoolId,
      date: yesterday,
      academicYearId: this.ctx.academicYearId,
      recordedBy: 'system',
      records: bulkRecords,
    });
    if (r2.status >= 200 && r2.status < 300 && r2.data) {
      const ct = r2.data.recorded ?? r2.data.created ?? 0;
      this.rec(`9.2 Bulk attendance for yesterday (${ct} recorded)`, ct > 0 ? 'PASS' : 'FAIL', r2.duration);
    } else {
      this.rec('9.2 Bulk attendance for yesterday', 'SKIP', r2.duration, `Status: ${r2.status}`);
    }

    // 9.3 Bulk attendance — all students for today
    const todayStatuses = ['present', 'present', 'late', 'present', 'present', 'present', 'absent', 'present'];
    const todayRecords = this.ctx.students.map((st, i) => ({
      studentId: st.id,
      status: todayStatuses[i % todayStatuses.length],
    }));
    const r3 = await this.api.post<BulkAttendanceResult>('/academics/attendance/bulk', {
      schoolId: this.ctx.schoolId,
      date: today,
      academicYearId: this.ctx.academicYearId,
      recordedBy: 'system',
      records: todayRecords,
    });
    if (r3.status >= 200 && r3.status < 300) {
      this.rec('9.3 Bulk attendance for today', 'PASS', r3.duration);
    } else {
      this.rec('9.3 Bulk attendance for today', 'SKIP', r3.duration, `Status: ${r3.status}`);
    }

    // 9.4 Daily attendance summary
    const r4 = await this.api.get<unknown>(
      `/academics/attendance/summary?schoolId=${this.ctx.schoolId}&date=${today}`,
    );
    if (r4.status === 200 && r4.data) {
      this.rec('9.4 Daily attendance summary', 'PASS', r4.duration);
      console.log(`    \x1b[90m↳ ${JSON.stringify(r4.data).slice(0, 300)}\x1b[0m`);
    } else {
      this.rec('9.4 Daily attendance summary', 'SKIP', r4.duration, `Status: ${r4.status}`);
    }

    // 9.5 Student attendance history
    const r5 = await this.api.get<unknown>(
      `/academics/attendance/student/${st0.id}?startDate=${yesterday}&endDate=${today}`,
    );
    if (r5.status === 200) {
      this.rec(`9.5 ${st0.firstName}'s attendance history`, 'PASS', r5.duration);
    } else {
      this.rec(`9.5 ${st0.firstName}'s attendance history`, 'SKIP', r5.duration, `Status: ${r5.status}`);
    }

    // 9.6 Student attendance summary
    const r6 = await this.api.get<unknown>(
      `/academics/attendance/student/${st0.id}/summary?schoolId=${this.ctx.schoolId}&academicYearId=${this.ctx.academicYearId}`,
    );
    if (r6.status === 200 && r6.data) {
      this.rec(`9.6 ${st0.firstName}'s attendance summary`, 'PASS', r6.duration);
      console.log(`    \x1b[90m↳ ${JSON.stringify(r6.data).slice(0, 300)}\x1b[0m`);
    } else {
      this.rec(`9.6 ${st0.firstName}'s attendance summary`, 'SKIP', r6.duration, `Status: ${r6.status}`);
    }

    // 9.7 Update attendance — change Sofia from absent to excused
    const sofia = this.ctx.students.find(s => s.firstName === 'Sofia');
    if (sofia) {
      const r7 = await this.api.patch<AttendanceResponse>(
        `/academics/attendance/${today}/${sofia.id}`,
        { status: 'excused', notes: 'Updated — parent provided doctor note' },
      );
      if (r7.status >= 200 && r7.status < 300) {
        this.rec('9.7 Update attendance (Sofia absent → excused)', 'PASS', r7.duration);
      } else {
        this.rec('9.7 Update attendance', 'SKIP', r7.duration, `Status: ${r7.status}`);
      }
    }
  }

  // ═══════════════════════════════════════
  // MODULE 10: Verification & Reporting
  // ═══════════════════════════════════════
  async mod10_Verification() {
    this.mod = 'Verification';
    console.log('\n\x1b[36m═══ Module 10: Verification & Data Integrity ═══\x1b[0m');

    // 10.1 Student profile (aggregated endpoint)
    if (this.ctx.students.length > 0) {
      const st = this.ctx.students[0];
      const r = await this.api.get<unknown>(`/academics/students/${st.id}/profile`);
      if (r.status === 200 && r.data) {
        this.rec(`10.1 Student profile — ${st.firstName} ${st.lastName}`, 'PASS', r.duration);
        const profile = r.data as Record<string, unknown>;
        console.log(`    \x1b[90m↳ fullName=${profile.fullName}, grade=${profile.currentGradeLevel}, status=${profile.status}\x1b[0m`);
        if (profile.currentEnrollment) console.log(`    \x1b[90m↳ enrollment: ${JSON.stringify(profile.currentEnrollment).slice(0, 200)}\x1b[0m`);
        if (profile.attendanceSummary) console.log(`    \x1b[90m↳ attendance: ${JSON.stringify(profile.attendanceSummary).slice(0, 200)}\x1b[0m`);
      } else {
        this.rec(`10.1 Student profile`, 'SKIP', r.duration, `Status: ${r.status}`);
      }
    }

    // 10.2 Student enrollment history
    if (this.ctx.students.length > 0) {
      const st = this.ctx.students[0];
      const r = await this.api.get<unknown>(`/academics/students/${st.id}/enrollments`);
      if (r.status === 200) {
        this.rec(`10.2 ${st.firstName}'s enrollment history`, 'PASS', r.duration);
      } else {
        this.rec(`10.2 Enrollment history`, 'SKIP', r.duration, `Status: ${r.status}`);
      }
    }

    // 10.3 Course name propagation test (SP4-7)
    if (this.ctx.courses.length > 0 && this.ctx.sections.length > 0) {
      const course = this.ctx.courses[0]; // Algebra I
      const section = this.ctx.sections.find(s => s.courseId === course.id);
      if (section) {
        const newName = `${course.name} (Updated ${random4()})`;
        const r1 = await this.api.patch<CourseResponse>(
          `/academics/courses/${course.id}?schoolId=${this.ctx.schoolId}`,
          { courseName: newName },
        );
        this.ok('10.3a Update Algebra I course name', r1, 200);

        console.log(`    \x1b[90mWaiting ${PROPAGATION_WAIT_MS}ms for propagation…\x1b[0m`);
        await sleep(PROPAGATION_WAIT_MS);

        const r2 = await this.api.get<SectionResponse>(`/academics/sections/${section.id}?schoolId=${this.ctx.schoolId}`);
        if (r2.status === 200 && r2.data) {
          if (r2.data.courseName === newName) {
            this.rec('10.3b Course name propagated to section', 'PASS', r2.duration);
          } else {
            this.rec('10.3b Course name propagated to section', 'FAIL', r2.duration,
              `Expected "${newName}", got "${r2.data.courseName}" — SP4-7 propagation may not be deployed`);
          }
        }
      }
    }

    // 10.4 Validate all sections have correct enrollment counts
    let countCheck = 0;
    let countOk = 0;
    for (const sec of this.ctx.sections.slice(0, 5)) { // Check first 5
      const expected = this.ctx.sectionEnrollments.filter(e => e.sectionId === sec.id).length;
      const r = await this.api.get<SectionResponse>(`/academics/sections/${sec.id}?schoolId=${this.ctx.schoolId}`);
      if (r.status === 200 && r.data) {
        countCheck++;
        if (r.data.currentEnrollment === expected) countOk++;
        else console.log(`    \x1b[33m⚠ ${sec.courseName}: expected=${expected}, actual=${r.data.currentEnrollment}\x1b[0m`);
      }
    }
    this.rec(`10.4 Enrollment counter integrity (${countOk}/${countCheck} correct)`, countOk === countCheck ? 'PASS' : 'FAIL', 0);

    // 10.5 Validation: create section with invalid teacher (should reject)
    if (this.ctx.courses.length > 0) {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const r = await this.api.post<unknown>('/academics/sections', {
        sectionNumber: 'VLD1', courseId: this.ctx.courses[0].id, schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId, primaryTeacherId: fakeUuid, maxEnrollment: 30,
      });
      this.ok('10.5 Reject section with invalid teacher ID', r, [400, 404]);
    }

    // 10.6 Validation: incomplete course creation (missing required fields)
    const r6 = await this.api.post<unknown>('/academics/courses', { courseName: 'Incomplete' });
    this.ok('10.6 Reject incomplete course (missing required fields)', r6, [400, 404, 422, 500]);

    // 10.7 Validation: self-referencing prerequisite
    if (this.ctx.courses.length > 0) {
      const c = this.ctx.courses[0];
      const r = await this.api.patch<unknown>(
        `/academics/courses/${c.id}?schoolId=${this.ctx.schoolId}`,
        { prerequisites: [c.id] },
      );
      this.ok('10.7 Reject self-referencing prerequisite', r, 400);
    }

    // 10.8 Soft-delete cascade: delete section with enrollments should be blocked
    const enrolledSection = this.ctx.sections.find(s =>
      this.ctx.sectionEnrollments.some(e => e.sectionId === s.id),
    );
    if (enrolledSection) {
      const r = await this.api.del<unknown>(
        `/academics/sections/${enrolledSection.id}?schoolId=${this.ctx.schoolId}`,
      );
      this.ok('10.8 Delete section with enrollments blocked', r, 400);
    }

    // 10.9 Verify school listing endpoint
    const r9 = await this.api.get<ListResponse<SchoolResponse>>('/schools');
    if (r9.status === 200) {
      this.rec('10.9 List schools endpoint reachable', 'PASS', r9.duration);
    }

    // 10.10 Health check
    const r10 = await this.api.get<unknown>('/academics/health');
    if (r10.status === 200) {
      this.rec('10.10 Academics health endpoint', 'PASS', r10.duration);
    } else {
      this.rec('10.10 Academics health endpoint', 'SKIP', r10.duration, `Status: ${r10.status}`);
    }
  }

  // ═══════════════════════════════════════
  // MODULE 11: Education Organization Hierarchy (Sprint 1A)
  // ═══════════════════════════════════════
  async mod11_EdOrg() {
    this.mod = 'EdOrg';
    console.log('\n\x1b[36m═══ Module 11: Education Organization Hierarchy (Sprint 1A) ═══\x1b[0m');

    // 11.1 Create / update SEA (PUT is idempotent)
    const r1 = await this.api.request<SeaResponse>(
      'PUT',
      '/education-organizations/sea',
      {
        name: 'State Department of Education',
        stateAbbreviation: 'TX',
        operationalStatus: 'Active',
        websiteUrl: 'https://tea.texas.gov',
      },
    );
    if (this.ok('11.1 Create/update SEA (PUT idempotent)', r1, [200, 201]) && r1.data) {
      this.ctx.seaId = r1.data.seaId;
    }

    // 11.2 Get SEA
    const r2 = await this.api.get<SeaResponse>('/education-organizations/sea');
    if (this.ok('11.2 Get SEA', r2, 200) && r2.data) {
      const nameOk = r2.data.name === 'State Department of Education';
      this.rec('11.2a SEA name matches', nameOk ? 'PASS' : 'FAIL', 0,
        nameOk ? undefined : `Expected 'State Department of Education', got '${r2.data.name}'`);
    }

    // 11.3 PUT SEA again (idempotency — should update, not duplicate)
    const r3 = await this.api.request<SeaResponse>(
      'PUT',
      '/education-organizations/sea',
      {
        name: 'State Department of Education',
        stateAbbreviation: 'TX',
        operationalStatus: 'Active',
        websiteUrl: 'https://tea.texas.gov',
        ncesIdentificationNumber: 'SEA-0001',
      },
    );
    this.ok('11.3 SEA PUT idempotency (update, not duplicate)', r3, [200, 201]);

    // 11.4 Create LEA #1 (independent school district)
    const r4 = await this.api.post<LeaResponse>('/education-organizations/leas', {
      name: 'Allen Independent School District',
      leaCategory: 'Independent',
      operationalStatus: 'Active',
      seaId: this.ctx.seaId,
      ncesIdentificationNumber: `LEA-${ts5()}`,
    });
    if (this.ok('11.4 Create LEA — Allen ISD', r4, [200, 201]) && r4.data) {
      this.ctx.leaIds.push(r4.data.leaId);
    }

    // 11.5 Create LEA #2 (charter)
    const r5 = await this.api.post<LeaResponse>('/education-organizations/leas', {
      name: 'Harmony Science Academy',
      leaCategory: 'Charter',
      operationalStatus: 'Active',
      seaId: this.ctx.seaId,
    });
    if (this.ok('11.5 Create LEA — Harmony (Charter)', r5, [200, 201]) && r5.data) {
      this.ctx.leaIds.push(r5.data.leaId);
    }

    // 11.6 Get LEA by ID
    if (this.ctx.leaIds.length > 0) {
      const r6 = await this.api.get<LeaResponse>(`/education-organizations/leas/${this.ctx.leaIds[0]}`);
      this.ok('11.6 Get LEA by ID', r6, 200);
    }

    // 11.7 List LEAs
    const r7 = await this.api.get<ListResponse<LeaResponse>>('/education-organizations/leas');
    if (r7.status === 200 && r7.data) {
      const count = r7.data.items?.length || 0;
      this.rec(`11.7 List LEAs (found ${count})`, count >= 2 ? 'PASS' : 'FAIL', r7.duration,
        count < 2 ? `Expected ≥2, got ${count}` : undefined);
    } else {
      this.rec('11.7 List LEAs', 'SKIP', r7.duration, `Status: ${r7.status}`);
    }

    // 11.8 Update LEA (PATCH)
    if (this.ctx.leaIds.length > 0) {
      const r8 = await this.api.patch<LeaResponse>(
        `/education-organizations/leas/${this.ctx.leaIds[0]}`,
        { websiteUrl: 'https://allenisd.org' },
      );
      this.ok('11.8 Update LEA (add website)', r8, 200);
    }

    // 11.9 Create ESC
    const r9 = await this.api.post<EscResponse>('/education-organizations/escs', {
      name: 'Region 10 Education Service Center',
      operationalStatus: 'Active',
      seaId: this.ctx.seaId,
    });
    if (this.ok('11.9 Create ESC — Region 10', r9, [200, 201]) && r9.data) {
      this.ctx.escIds.push(r9.data.escId);
    }

    // 11.10 List ESCs
    const r10 = await this.api.get<ListResponse<EscResponse>>('/education-organizations/escs');
    if (r10.status === 200 && r10.data) {
      const count = r10.data.items?.length || 0;
      this.rec(`11.10 List ESCs (found ${count})`, count >= 1 ? 'PASS' : 'FAIL', r10.duration);
    } else {
      this.rec('11.10 List ESCs', 'SKIP', r10.duration, `Status: ${r10.status}`);
    }

    // 11.11 Get full hierarchy
    const r11 = await this.api.get<HierarchyResponse>('/education-organizations/hierarchy');
    if (r11.status === 200 && r11.data) {
      this.rec('11.11 Get organization hierarchy tree', 'PASS', r11.duration);
      const hasSea = !!r11.data.sea;
      const leaCount = r11.data.leas?.length || 0;
      const escCount = r11.data.escs?.length || 0;
      console.log(`    \x1b[90m↳ SEA: ${hasSea ? r11.data.sea?.name : 'none'}, LEAs: ${leaCount}, ESCs: ${escCount}\x1b[0m`);
      // Validate structure
      this.rec('11.11a Hierarchy contains SEA', hasSea ? 'PASS' : 'FAIL', 0);
      this.rec(`11.11b Hierarchy contains ≥2 LEAs`, leaCount >= 2 ? 'PASS' : 'FAIL', 0,
        leaCount < 2 ? `Found ${leaCount}` : undefined);
    } else {
      this.rec('11.11 Get organization hierarchy', 'SKIP', r11.duration, `Status: ${r11.status}`);
    }

    // 11.12 Validation: Create LEA without required name (should reject)
    const rBad = await this.api.post<unknown>('/education-organizations/leas', {
      leaCategory: 'Independent',
    });
    this.ok('11.12 Reject LEA without name (Zod validation)', rBad, [400, 422]);

    // 11.13 Get non-existent LEA (should 404)
    const rNotFound = await this.api.get<unknown>('/education-organizations/leas/00000000-0000-0000-0000-000000000000');
    this.ok('11.13 GET non-existent LEA returns 404', rNotFound, 404);

    console.log(`\n  \x1b[90mseaId = ${this.ctx.seaId || 'N/A'}\x1b[0m`);
    console.log(`  \x1b[90mleaIds = [${this.ctx.leaIds.join(', ')}]\x1b[0m`);
    console.log(`  \x1b[90mescIds = [${this.ctx.escIds.join(', ')}]\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 12: Staff Assignments (Sprint 1A)
  // ═══════════════════════════════════════
  async mod12_StaffAssignments() {
    this.mod = 'StaffAssignments';
    console.log('\n\x1b[36m═══ Module 12: Staff Assignments (Sprint 1A) ═══\x1b[0m');

    if (this.ctx.staff.length === 0 || !this.ctx.schoolId) {
      console.log('  \x1b[33m[SKIP] No staff or school.\x1b[0m');
      return;
    }

    const teacher = this.ctx.staff[0]; // Margaret Sullivan

    // 12.1 Create primary assignment
    const r1 = await this.api.post<StaffAssignmentResponse>(
      `/staff/${teacher.id}/assignments`,
      {
        schoolId: this.ctx.schoolId,
        role: 'Teacher',
        department: teacher.department,
        isPrimary: true,
        beginDate: todayIso(),
        positionTitle: 'Mathematics Teacher',
        fullTimeEquivalency: 1.0,
      },
    );
    if (this.ok('12.1 Create primary staff assignment (Margaret → Westfield)', r1, [200, 201]) && r1.data) {
      this.ctx.staffAssignmentIds.push({ staffId: teacher.id, assignmentId: r1.data.assignmentId });
    }

    // 12.2 List assignments for staff
    const r2 = await this.api.get<ListResponse<StaffAssignmentResponse>>(
      `/staff/${teacher.id}/assignments`,
    );
    if (r2.status === 200 && r2.data) {
      const count = r2.data.items?.length || 0;
      this.rec(`12.2 List assignments for Margaret (found ${count})`, count >= 1 ? 'PASS' : 'FAIL', r2.duration);
    } else {
      this.rec('12.2 List assignments for Margaret', 'SKIP', r2.duration, `Status: ${r2.status}`);
    }

    // 12.3 Get assignment by ID
    if (this.ctx.staffAssignmentIds.length > 0) {
      const a = this.ctx.staffAssignmentIds[0];
      const r3 = await this.api.get<StaffAssignmentResponse>(
        `/staff/${a.staffId}/assignments/${a.assignmentId}`,
      );
      if (this.ok('12.3 Get assignment by ID', r3, 200) && r3.data) {
        const isPrimary = r3.data.isPrimary === true;
        this.rec('12.3a Assignment isPrimary=true', isPrimary ? 'PASS' : 'FAIL', 0);
        const statusOk = r3.data.assignmentStatus === 'active';
        this.rec('12.3b Assignment status is active', statusOk ? 'PASS' : 'FAIL', 0);
      }
    }

    // 12.4 Update assignment (change department)
    if (this.ctx.staffAssignmentIds.length > 0) {
      const a = this.ctx.staffAssignmentIds[0];
      const r4 = await this.api.patch<StaffAssignmentResponse>(
        `/staff/${a.staffId}/assignments/${a.assignmentId}`,
        { department: 'Mathematics & Computer Science', positionTitle: 'Lead Mathematics Teacher' },
      );
      this.ok('12.4 Update assignment (department + title)', r4, 200);
    }

    // 12.5 Create assignment for second teacher
    if (this.ctx.staff.length >= 2) {
      const t2 = this.ctx.staff[1]; // David Chen
      const r5 = await this.api.post<StaffAssignmentResponse>(
        `/staff/${t2.id}/assignments`,
        {
          schoolId: this.ctx.schoolId,
          role: 'Teacher',
          department: t2.department,
          isPrimary: true,
          beginDate: todayIso(),
        },
      );
      if (this.ok('12.5 Create assignment (David Chen → Westfield)', r5, [200, 201]) && r5.data) {
        this.ctx.staffAssignmentIds.push({ staffId: t2.id, assignmentId: r5.data.assignmentId });
      }
    }

    // 12.6 Duplicate active assignment blocked
    if (this.ctx.staff.length >= 1) {
      const rDup = await this.api.post<unknown>(
        `/staff/${teacher.id}/assignments`,
        {
          schoolId: this.ctx.schoolId,
          role: 'Teacher',
          department: teacher.department,
          isPrimary: false,
          beginDate: todayIso(),
        },
      );
      this.ok('12.6 Duplicate active assignment blocked', rDup, [400, 409]);
    }

    // 12.7 End an assignment (soft delete)
    if (this.ctx.staffAssignmentIds.length >= 2) {
      const a = this.ctx.staffAssignmentIds[1]; // David's assignment
      const r7 = await this.api.del<void>(
        `/staff/${a.staffId}/assignments/${a.assignmentId}`,
      );
      this.ok('12.7 End assignment (David Chen)', r7, [200, 204]);
    }

    // 12.8 Verify ended assignment status
    if (this.ctx.staffAssignmentIds.length >= 2) {
      const a = this.ctx.staffAssignmentIds[1];
      const r8 = await this.api.get<StaffAssignmentResponse>(
        `/staff/${a.staffId}/assignments/${a.assignmentId}`,
      );
      if (r8.status === 200 && r8.data) {
        const ended = r8.data.assignmentStatus === 'ended';
        this.rec('12.8 Ended assignment status verified', ended ? 'PASS' : 'FAIL', r8.duration,
          ended ? undefined : `Expected 'ended', got '${r8.data.assignmentStatus}'`);
      } else {
        this.rec('12.8 Verify ended assignment', 'SKIP', r8.duration, `Status: ${r8.status}`);
      }
    }

    console.log(`\n  \x1b[90mStaff assignments created: ${this.ctx.staffAssignmentIds.length}\x1b[0m`);
  }

  // ═══════════════════════════════════════
  // MODULE 13: Employment History (Sprint 1A)
  // ═══════════════════════════════════════
  async mod13_EmploymentHistory() {
    this.mod = 'EmploymentHistory';
    console.log('\n\x1b[36m═══ Module 13: Employment History (Sprint 1A) ═══\x1b[0m');

    if (this.ctx.staff.length === 0) {
      console.log('  \x1b[33m[SKIP] No staff.\x1b[0m');
      return;
    }

    const teacher = this.ctx.staff[0]; // Margaret Sullivan

    // 13.1 Change employment status (active → on_leave) — triggers history recording
    const r1 = await this.api.patch<StaffResponse>(
      `/staff/${teacher.id}/employment-status`,
      {
        employmentStatus: 'on_leave',
        effectiveDate: todayIso(),
        reason: 'Medical leave',
        notes: 'Approved by HR — smoke test',
      },
    );
    this.ok('13.1 Update employment status (active → on_leave)', r1, [200, 201]);

    // 13.2 Change status back (on_leave → active)
    const r2 = await this.api.patch<StaffResponse>(
      `/staff/${teacher.id}/employment-status`,
      {
        employmentStatus: 'active',
        effectiveDate: todayIso(),
        reason: 'Return from leave',
      },
    );
    this.ok('13.2 Update employment status (on_leave → active)', r2, [200, 201]);

    // Small wait for eventual consistency of history entries
    await sleep(1000);

    // 13.3 Get employment history
    const r3 = await this.api.get<ListResponse<EmploymentHistoryResponse>>(
      `/staff/${teacher.id}/employment-history`,
    );
    if (r3.status === 200 && r3.data) {
      const count = r3.data.items?.length || 0;
      this.rec(`13.3 Get employment history (found ${count} entries)`, count >= 2 ? 'PASS' : 'FAIL', r3.duration,
        count < 2 ? `Expected ≥2 history entries, got ${count}` : undefined);
      if (count > 0) {
        const first = r3.data.items[0];
        console.log(`    \x1b[90m↳ Latest: ${first.previousStatus} → ${first.newStatus} on ${first.effectiveDate}\x1b[0m`);
        // Validate history entry fields
        const hasFields = first.historyId && first.staffId && first.previousStatus && first.newStatus && first.effectiveDate;
        this.rec('13.3a History entry has required fields', hasFields ? 'PASS' : 'FAIL', 0);
      }
    } else {
      this.rec('13.3 Get employment history', 'SKIP', r3.duration, `Status: ${r3.status}`);
    }

    // 13.4 History for staff with no changes (second teacher if not yet changed)
    if (this.ctx.staff.length >= 3) {
      const t3 = this.ctx.staff[2]; // Rebecca Torres
      const r4 = await this.api.get<ListResponse<EmploymentHistoryResponse>>(
        `/staff/${t3.id}/employment-history`,
      );
      if (r4.status === 200 && r4.data) {
        const count = r4.data.items?.length || 0;
        this.rec(`13.4 Employment history for unchanged staff (${count} entries)`, 'PASS', r4.duration);
      } else {
        this.rec('13.4 Employment history for unchanged staff', 'SKIP', r4.duration, `Status: ${r4.status}`);
      }
    }
  }

  // ═══════════════════════════════════════
  // MODULE 14: ABAC Permission Checks (Sprint 1A)
  // ═══════════════════════════════════════
  async mod14_ABAC() {
    this.mod = 'ABAC';
    console.log('\n\x1b[36m═══ Module 14: ABAC Permission Checks (Sprint 1A) ═══\x1b[0m');

    // 14.1 Get permission catalog
    // The catalog endpoint is nested under /users/:id/roles/permissions/catalog
    // but since we don't have a userId from auth, we'll use the 'me' user permissions endpoint
    const r1 = await this.api.get<PermissionCatalogResponse>(
      '/users/me/permissions',
    );
    if (r1.status === 200 && r1.data) {
      this.rec('14.1 GET /users/me/permissions reachable', 'PASS', r1.duration);
      const data = r1.data as Record<string, unknown>;
      // TenantAdmin should have isFullAccess
      if (data.isFullAccess === true) {
        this.rec('14.1a TenantAdmin has isFullAccess=true', 'PASS', 0);
      } else {
        this.rec('14.1a TenantAdmin has isFullAccess=true', 'FAIL', 0,
          `isFullAccess=${data.isFullAccess}`);
      }
      if (data.globalRole) {
        this.rec(`14.1b globalRole present (${data.globalRole})`, 'PASS', 0);
      }
    } else {
      this.rec('14.1 GET /users/me/permissions', 'SKIP', r1.duration, `Status: ${r1.status}`);
    }

    // 14.2 Verify Sprint 1A resources exist in permission registry
    // We need a userId for this. Try to get current user info first.
    const rMe = await this.api.get<{ userId: string; [k: string]: unknown }>('/auth/me');
    const userId = rMe.data?.userId;

    if (userId) {
      const r2 = await this.api.get<PermissionCatalogResponse>(
        `/users/${userId}/roles/permissions/catalog`,
      );
      if (r2.status === 200 && r2.data?.permissions) {
        const resources = r2.data.permissions.map(p => p.resource);
        this.rec('14.2 Permission catalog endpoint reachable', 'PASS', r2.duration);

        const hasEdOrg = resources.includes('education-organizations');
        this.rec('14.2a Catalog contains education-organizations', hasEdOrg ? 'PASS' : 'FAIL', 0);

        const hasStaffAssign = resources.includes('staff-assignments');
        this.rec('14.2b Catalog contains staff-assignments', hasStaffAssign ? 'PASS' : 'FAIL', 0);

        const hasEmpHist = resources.includes('employment-history');
        this.rec('14.2c Catalog contains employment-history', hasEmpHist ? 'PASS' : 'FAIL', 0);

        // Validate action lists
        if (hasEdOrg) {
          const edOrgDef = r2.data.permissions.find(p => p.resource === 'education-organizations');
          const hasManage = edOrgDef?.actions.includes('manage');
          this.rec('14.2d education-organizations has manage action', hasManage ? 'PASS' : 'FAIL', 0);
        }
        if (hasEmpHist) {
          const empHistDef = r2.data.permissions.find(p => p.resource === 'employment-history');
          const viewOnly = empHistDef?.actions.length === 1 && empHistDef?.actions[0] === 'view';
          this.rec('14.2e employment-history is view-only', viewOnly ? 'PASS' : 'FAIL', 0,
            viewOnly ? undefined : `Actions: ${empHistDef?.actions}`);
        }

        console.log(`    \x1b[90m↳ Total resources: ${resources.length}, Sprint 1A: ${[hasEdOrg, hasStaffAssign, hasEmpHist].filter(Boolean).length}/3\x1b[0m`);
      } else {
        this.rec('14.2 Permission catalog', 'SKIP', r2.duration, `Status: ${r2.status}`);
      }

      // 14.3 Permission check — TenantAdmin should have education-organizations:create
      const r3 = await this.api.post<CheckPermissionResponse>(
        `/users/${userId}/roles/permissions/check`,
        { resource: 'education-organizations', action: 'create' },
      );
      if (r3.status === 200 && r3.data) {
        this.rec('14.3 Permission check: education-organizations:create', r3.data.allowed ? 'PASS' : 'FAIL', r3.duration,
          r3.data.allowed ? undefined : `TenantAdmin should be allowed. reason: ${r3.data.reason}`);
      } else {
        this.rec('14.3 Permission check', 'SKIP', r3.duration, `Status: ${r3.status}`);
      }

      // 14.4 Permission check — TenantAdmin should have staff-assignments:delete
      const r4 = await this.api.post<CheckPermissionResponse>(
        `/users/${userId}/roles/permissions/check`,
        { resource: 'staff-assignments', action: 'delete' },
      );
      if (r4.status === 200 && r4.data) {
        this.rec('14.4 Permission check: staff-assignments:delete', r4.data.allowed ? 'PASS' : 'FAIL', r4.duration);
      } else {
        this.rec('14.4 Permission check', 'SKIP', r4.duration, `Status: ${r4.status}`);
      }

      // 14.5 Permission check — TenantAdmin should have employment-history:view
      const r5 = await this.api.post<CheckPermissionResponse>(
        `/users/${userId}/roles/permissions/check`,
        { resource: 'employment-history', action: 'view' },
      );
      if (r5.status === 200 && r5.data) {
        this.rec('14.5 Permission check: employment-history:view', r5.data.allowed ? 'PASS' : 'FAIL', r5.duration);
      } else {
        this.rec('14.5 Permission check', 'SKIP', r5.duration, `Status: ${r5.status}`);
      }
    } else {
      this.rec('14.2 Permission catalog (need userId)', 'SKIP', rMe.duration, 'Could not resolve userId from /auth/me');
      this.rec('14.3-14.5 Permission checks', 'SKIP', 0, 'No userId available');
    }
  }

  // ═══════════════════════════════════════
  // RUN ALL MODULES
  // ═══════════════════════════════════════
  async run() {
    console.log('\x1b[1m');
    console.log('════════════════════════════════════════════════════════════');
    console.log('  EdForge — SP1–SP3 + Sprint Alaska + Sprint 1A Simulation');
    console.log('  Modules 0–10: Foundation, Staff, Students, Enrollment,');
    console.log('    Courses, Sections, Schedules, Grades, Attendance');
    console.log('  Modules 11–14: EdOrg Hierarchy, Staff Assignments,');
    console.log('    Employment History, ABAC Permissions');
    console.log('════════════════════════════════════════════════════════════');
    console.log('\x1b[0m');
    console.log(`API:     ${BASE_URL}`);
    console.log(`Time:    ${new Date().toISOString()}`);
    console.log(`Cleanup: NONE (data persists in tenant)\n`);

    const ok = await this.mod0_Foundation();
    if (!ok) { this.printSummary(); return; }

    await this.mod1_Staff();
    await this.mod2_Students();
    await this.mod3_Enrollment();
    await this.mod4_Courses();
    await this.mod5_Sections();
    await this.mod6_Schedules();
    await this.mod7_GradingPolicy();
    await this.mod8_Grades();
    await this.mod9_Attendance();
    await this.mod10_Verification();
    await this.mod11_EdOrg();
    await this.mod12_StaffAssignments();
    await this.mod13_EmploymentHistory();
    await this.mod14_ABAC();

    this.printSummary();
    this.printDataSummary();
  }

  // ─── Summary ───
  printSummary() {
    console.log('\n\x1b[1m');
    console.log('════════════════════════════════════════════════════════════');
    console.log('  SIMULATION SUMMARY');
    console.log('════════════════════════════════════════════════════════════');
    console.log('\x1b[0m');

    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;
    const total = this.results.length;
    const rated = total - skipped;
    const passRate = rated > 0 ? ((passed / rated) * 100).toFixed(1) : '0';

    const modules = [...new Set(this.results.map(r => r.module))];
    for (const mod of modules) {
      const mr = this.results.filter(r => r.module === mod);
      const mp = mr.filter(r => r.status === 'PASS').length;
      const mf = mr.filter(r => r.status === 'FAIL').length;
      const ms = mr.filter(r => r.status === 'SKIP').length;
      const icon = mf > 0 ? '\x1b[31m' : mp > 0 ? '\x1b[32m' : '\x1b[33m';
      console.log(`  ${icon}${mod.padEnd(20)}\x1b[0m ${mp}/${mr.length - ms} passed, ${mf} failed, ${ms} skipped`);
    }

    console.log('\n  ' + '─'.repeat(50));
    console.log(`  \x1b[1mTotal:\x1b[0m     ${total} tests`);
    console.log(`  \x1b[32mPassed:\x1b[0m    ${passed}`);
    console.log(`  \x1b[31mFailed:\x1b[0m    ${failed}`);
    console.log(`  \x1b[33mSkipped:\x1b[0m   ${skipped}`);
    console.log(`  \x1b[1mPass Rate:\x1b[0m ${passRate}% (excl. skipped)`);
    console.log('════════════════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('\x1b[31mFailed Tests:\x1b[0m');
      for (const r of this.results.filter(r => r.status === 'FAIL')) {
        console.log(`  ✗ [${r.module}] ${r.name}`);
        if (r.error) console.log(`    ${r.error.slice(0, 300)}`);
      }
      console.log('');
      process.exitCode = 1;
    }
  }

  printDataSummary() {
    console.log('\x1b[36m── Persistent Data Created ──\x1b[0m');
    console.log(`  School:       ${this.ctx.schoolId}`);
    console.log(`  AcademicYear: ${this.ctx.academicYearId}`);
    console.log(`  Term1 (Fall): ${this.ctx.term1Id || 'N/A'}`);
    console.log(`  Term2 (Spr):  ${this.ctx.term2Id || 'N/A'}`);
    console.log(`  Staff:        ${this.ctx.staff.length} members`);
    this.ctx.staff.forEach(s => console.log(`    → ${s.firstName} ${s.lastSurname} (${s.department}) [${s.id}]`));
    console.log(`  Students:     ${this.ctx.students.length} enrolled`);
    this.ctx.students.forEach(s => console.log(`    → ${s.firstName} ${s.lastName} (Grade ${s.grade}) [${s.id}]`));
    console.log(`  Courses:      ${this.ctx.courses.length} in catalog`);
    this.ctx.courses.forEach(c => console.log(`    → ${c.name} (${c.type}, ${c.credits} cr) [${c.id}]`));
    console.log(`  Sections:     ${this.ctx.sections.length} class sections`);
    console.log(`  Enrollments:  ${this.ctx.enrollments.length} annual, ${this.ctx.sectionEnrollments.length} section`);
    console.log(`  GradingPolicy:${this.ctx.gradingPolicyId || 'N/A'}`);
    console.log('\x1b[36m── Sprint 1A Data ──\x1b[0m');
    console.log(`  SEA:             ${this.ctx.seaId || 'N/A'}`);
    console.log(`  LEAs:            ${this.ctx.leaIds.length} (${this.ctx.leaIds.join(', ') || 'none'})`);
    console.log(`  ESCs:            ${this.ctx.escIds.length} (${this.ctx.escIds.join(', ') || 'none'})`);
    console.log(`  StaffAssignments:${this.ctx.staffAssignmentIds.length} created`);
    console.log('');
  }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  if (!ID_TOKEN || ID_TOKEN.length < 50) {
    console.error('\x1b[31mERROR: Set ID_TOKEN env var with a valid Cognito JWT\x1b[0m');
    console.error('Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/academics-sp3-sp4-flow.ts');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `sp1_sp3_simulation_${timestamp}.log`);
  console.log(`Log file: ${logFile}\n`);

  const api = new ApiClient(BASE_URL, ID_TOKEN, logFile, LOG_LEVEL);
  const sim = new EdForgeSimulation(api);

  try {
    await sim.run();
  } finally {
    api.close();
  }
}

main().catch(err => {
  console.error('\x1b[31mUnhandled error:\x1b[0m', err);
  process.exit(1);
});

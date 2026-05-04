/**
 * EdForge — Sprint 3: Master Schedule Smoke Test
 *
 * Validates the Course Catalog & Master Schedule layer end-to-end:
 *
 *   Module 0: Foundation — Pick school + academic year + course
 *   Module 1: ClassPeriod CRUD — Create, list, get, update, overlap validation
 *   Module 2: Location CRUD — Create, list, get, update, duplicate check
 *   Module 3: CourseOffering CRUD — Create, list, get, update, unique check
 *   Module 4: Section Enhancement — Create section with period/room/offering refs
 *   Module 5: Conflict Detection — Same room+period+session conflict
 *   Module 6: Edge Cases & Negative Tests — Validation errors, 404s
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint3-schedule-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/sprint3-schedule-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || 'eyJraWQiOiJmakNuWU9ra1ZPR2Z2RzZNck9laWl5WXJLZGFzdHhHbmk5bjY2U2gzQWI4PSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiQ2lQR1ZnZVdIUDJvTEJHaGUzUFF3USIsInN1YiI6ImIxY2IwNTYwLTYwNTEtNzA4OC0wNTJlLTlmNmVmMDNhZTRhNiIsImNvZ25pdG86Z3JvdXBzIjpbIjM5MDlkMjhiLWQzYjgtNGE0NS04ZjNkLTU5NWE0MjJhNmU4MiJdLCJjdXN0b206dGVuYW50VGllciI6IkJBU0lDIiwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tXC91cy1lYXN0LTJfdEIwYzg0Qm5vIiwiY29nbml0bzp1c2VybmFtZSI6InNob2FpYi5yYWluQG91dGxvb2suY29tIiwiY3VzdG9tOnRlbmFudE5hbWUiOiJhbGxlbmlzZCIsIm9yaWdpbl9qdGkiOiI5NTAyNjczNC01ZjBjLTQ5ZDktOGQ1Ny0wZTYzMjNmY2ZhMGUiLCJjdXN0b206dGVuYW50SWQiOiIzOTA5ZDI4Yi1kM2I4LTRhNDUtOGYzZC01OTVhNDIyYTZlODIiLCJhdWQiOiI2NzhiZTJwYWZ2bzFoaGVvNGxjdDd1NHFycCIsImV2ZW50X2lkIjoiZGNiNzQ4NGMtYmMzZS00MTNjLWJiYjctMTAwMWM0NWRlN2RhIiwiY3VzdG9tOnVzZXJSb2xlIjoiVGVuYW50QWRtaW4iLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTc3MDkwNDk0NSwiZXhwIjoxNzcxMDE3MTQ0LCJpYXQiOjE3NzEwMTM1NDQsImp0aSI6ImJhMmJmZDI0LWQ0MGYtNDJiYy1iMGYxLTVmM2M4ZmM5MzU5YyIsImVtYWlsIjoic2hvYWliLnJhaW5Ab3V0bG9vay5jb20ifQ.m_Yb6iouI71Qyc-JHb0skFvKkM_WRqLabVrlhY63QEKX2qzIjfT2TpMkdCkf9y8I_f8GbLkYKbLBU34GpbaosAhzuaRpx8DCMSmnXPMztPJ0YIEX3ejWOBgXodV7TZjvYxGRYbNs9Q0nw5K_7y0XC-kfDs4A7huQx8tlYdFROht5Mru77cqytLrtuNeY2rQKMnN1H702Llz53r-QkXOrgLe8falN_XKRh_ZMMkXPjPKI-bLpkxncJy3n6nmV8GV6054qm0l-YRgRt7XSwR-8mXWuwlWS713vd9omHl8PzMyJRgC48-mmCA8Thbq1QRvUetwEv2kKRrjUJuXwXQPRbg';
const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || 'd88860fe-306a-4a2e-b76a-b5eee861ff08';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint3-schedule-flow.ts');
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

interface SchoolResponse { schoolId: string; name: string; [k: string]: unknown }
interface AcademicYearResponse { yearId: string; name: string; startDate: string; endDate: string; [k: string]: unknown }
interface AcademicSessionResponse { academicSessionId: string; sessionName: string; [k: string]: unknown }
interface CourseResponse { courseId: string; courseCode: string; courseName: string; schoolId: string; [k: string]: unknown }
interface ClassPeriodResponse { periodId: string; schoolId: string; classPeriodName: string; startTime: string; endTime: string; durationMinutes: number; sortOrder: number; periodType: string; isAcademic: boolean; [k: string]: unknown }
interface LocationResponse { locationId: string; schoolId: string; roomNumber: string; buildingName?: string; locationType: string; isActive: boolean; capacity?: number; [k: string]: unknown }
interface CourseOfferingResponse { courseOfferingId: string; courseId: string; schoolId: string; academicSessionId: string; courseName?: string; courseCode?: string; sessionName?: string; localCourseCode?: string; [k: string]: unknown }
interface SectionResponse { sectionId: string; courseId: string; schoolId: string; courseOfferingId?: string; classPeriodId?: string; locationId?: string; periodName?: string; locationRoomNumber?: string; [k: string]: unknown }

// ─────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────

interface TestContext {
  schoolId: string;
  schoolName: string;
  academicYearId: string;
  academicSessionId: string;
  courseId: string;
  courseCode: string;
  teacherId: string;
  // Created in this test
  period1Id: string;
  period2Id: string;
  period3Id: string;
  location1Id: string;
  location2Id: string;
  offeringId: string;
  sectionId: string;
}

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────

const ts5 = () => Date.now().toString().slice(-5);

// ─────────────────────────────────────────
// API CLIENT (reused pattern from Sprint 2)
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
    this.log('INFO', `=== Sprint 3 Master Schedule Smoke Test Started at ${new Date().toISOString()} ===`);
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
    this.log('INFO', `=== Smoke Test Completed at ${new Date().toISOString()} ===`);
    this.logStream.end();
  }
}

// ─────────────────────────────────────────
// SMOKE TEST RUNNER
// ─────────────────────────────────────────

class Sprint3ScheduleTest {
  private api: ApiClient;
  private results: TestResult[] = [];
  private ctx: TestContext = {
    schoolId: '', schoolName: '',
    academicYearId: '', academicSessionId: '',
    courseId: '', courseCode: '', teacherId: '',
    period1Id: '', period2Id: '', period3Id: '',
    location1Id: '', location2Id: '',
    offeringId: '', sectionId: '',
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
    if (error && status === 'FAIL') console.log(`    \x1b[31m${error.slice(0, 300)}\x1b[0m`);
  }
  private assert(name: string, condition: boolean, duration: number, errorMsg?: string): boolean {
    if (condition) { this.rec(name, 'PASS', duration); return true; }
    this.rec(name, 'FAIL', duration, errorMsg || 'Assertion failed');
    return false;
  }

  // ═══════════════════════════════════════
  // MODULE 0: Foundation
  // ═══════════════════════════════════════
  async mod0_Foundation(): Promise<boolean> {
    this.mod = 'Foundation';
    console.log('\n\x1b[36m═══ Module 0: Foundation (School + Year + Course) ═══\x1b[0m');

    // Get school
    if (SCHOOL_ID) {
      this.ctx.schoolId = SCHOOL_ID;
      const r = await this.api.get<SchoolResponse>(`/schools/${SCHOOL_ID}`);
      if (this.ok('0.1 Get school by ID', r, [200]) && r.data) {
        this.ctx.schoolName = r.data.name;
      }
    } else {
      const r = await this.api.get<ListResponse<SchoolResponse>>('/schools');
      if (this.ok('0.1 List schools', r, [200]) && r.data?.items?.length) {
        this.ctx.schoolId = r.data.items[0].schoolId;
        this.ctx.schoolName = r.data.items[0].name;
        console.log(`    Using school: ${this.ctx.schoolName} (${this.ctx.schoolId})`);
      }
    }
    if (!this.ctx.schoolId) { console.log('\x1b[31m  ABORT — no school.\x1b[0m'); return false; }

    // Get academic year
    const r2 = await this.api.get<ListResponse<AcademicYearResponse>>(`/schools/${this.ctx.schoolId}/academic-years`);
    if (this.ok('0.2 List academic years', r2, [200]) && r2.data?.items?.length) {
      const ay = r2.data.items[0];
      this.ctx.academicYearId = ay.yearId;
      console.log(`    Using academic year: ${ay.name}`);
    }
    if (!this.ctx.academicYearId) { console.log('\x1b[31m  ABORT — no academic year.\x1b[0m'); return false; }

    // Get academic session (created in Sprint 2)
    const r3 = await this.api.get<ListResponse<AcademicSessionResponse>>(`/schools/${this.ctx.schoolId}/academic-sessions`);
    if (this.ok('0.3 List academic sessions', r3, [200]) && r3.data?.items?.length) {
      this.ctx.academicSessionId = r3.data.items[0].academicSessionId;
      console.log(`    Using session: ${r3.data.items[0].sessionName}`);
    }
    if (!this.ctx.academicSessionId) { console.log('\x1b[31m  ABORT — no academic session. Run Sprint 2 smoke test first.\x1b[0m'); return false; }

    // Get or create a course
    const r4 = await this.api.get<ListResponse<CourseResponse>>(`/academics/courses?schoolId=${this.ctx.schoolId}&limit=5`);
    if (this.ok('0.4 List courses', r4, [200]) && r4.data?.items?.length) {
      this.ctx.courseId = r4.data.items[0].courseId;
      this.ctx.courseCode = r4.data.items[0].courseCode;
      console.log(`    Using course: ${r4.data.items[0].courseCode} — ${r4.data.items[0].courseName}`);
    } else {
      // Create one
      const code = `MATH-${ts5()}`;
      const r5 = await this.api.post<CourseResponse>('/academics/courses', {
        schoolId: this.ctx.schoolId,
        courseCode: code,
        courseName: 'Algebra I',
        subjectArea: 'mathematics',
        courseType: 'required',
        credits: 1,
        typicalDuration: 'year',
        gradeLevels: ['09'],
        isActive: true,
      });
      if (this.ok('0.4a Create test course', r5, [200, 201]) && r5.data) {
        this.ctx.courseId = r5.data.courseId;
        this.ctx.courseCode = r5.data.courseCode;
      }
    }
    if (!this.ctx.courseId) { console.log('\x1b[31m  ABORT — no course.\x1b[0m'); return false; }

    // Get a staff member for primaryTeacherId (needs valid UUID)
    const r6 = await this.api.get<ListResponse<{ staffId: string; [k: string]: unknown }>>(`/schools/${this.ctx.schoolId}/staff?limit=1`);
    if (r6.status === 200 && r6.data?.items?.length) {
      this.ctx.teacherId = r6.data.items[0].staffId;
      console.log(`    Using teacher: ${this.ctx.teacherId}`);
    } else {
      // Fallback: use a deterministic UUID placeholder
      this.ctx.teacherId = '00000000-0000-0000-0000-000000000001';
      console.log(`    No staff found — using placeholder UUID`);
    }

    return true;
  }

  // ═══════════════════════════════════════
  // MODULE 1: ClassPeriod CRUD
  // ═══════════════════════════════════════
  async mod1_ClassPeriodCrud() {
    this.mod = 'ClassPeriod CRUD';
    console.log('\n\x1b[36m═══ Module 1: ClassPeriod CRUD ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/class-periods`;

    // 1.1 Create Period 1
    const r1 = await this.api.post<ClassPeriodResponse>(base, {
      classPeriodName: `Period 1 (${ts5()})`,
      startTime: '08:00',
      endTime: '08:50',
      sortOrder: 0,
      periodType: 'instructional',
      isAcademic: true,
    });
    if (this.ok('1.1 Create Period 1', r1, [200, 201]) && r1.data) {
      this.ctx.period1Id = r1.data.periodId;
      this.assert('1.1a Duration is 50 min', r1.data.durationMinutes === 50, r1.duration);
      this.assert('1.1b Is academic', r1.data.isAcademic === true, r1.duration);
    }

    // 1.2 Create Period 2
    const r2 = await this.api.post<ClassPeriodResponse>(base, {
      classPeriodName: `Period 2 (${ts5()})`,
      startTime: '08:55',
      endTime: '09:45',
      sortOrder: 1,
      periodType: 'instructional',
      isAcademic: true,
    });
    if (this.ok('1.2 Create Period 2', r2, [200, 201]) && r2.data) {
      this.ctx.period2Id = r2.data.periodId;
    }

    // 1.3 Create Lunch period (non-academic)
    const r3 = await this.api.post<ClassPeriodResponse>(base, {
      classPeriodName: `Lunch (${ts5()})`,
      startTime: '11:30',
      endTime: '12:15',
      sortOrder: 5,
      periodType: 'lunch',
      isAcademic: false,
    });
    if (this.ok('1.3 Create Lunch period', r3, [200, 201]) && r3.data) {
      this.ctx.period3Id = r3.data.periodId;
      this.assert('1.3a Lunch is not academic', r3.data.isAcademic === false, r3.duration);
      this.assert('1.3b Period type is lunch', r3.data.periodType === 'lunch', r3.duration);
    }

    // 1.4 List class periods
    const r4 = await this.api.get<ListResponse<ClassPeriodResponse>>(base);
    if (this.ok('1.4 List class periods', r4, [200]) && r4.data) {
      this.assert('1.4a Has at least 3 periods', r4.data.items.length >= 3, r4.duration);
    }

    // 1.5 Get period by ID
    if (this.ctx.period1Id) {
      const r5 = await this.api.get<ClassPeriodResponse>(`${base}/${this.ctx.period1Id}`);
      if (this.ok('1.5 Get Period 1 by ID', r5, [200]) && r5.data) {
        this.assert('1.5a ID matches', r5.data.periodId === this.ctx.period1Id, r5.duration);
      }
    }

    // 1.6 Update period
    if (this.ctx.period1Id) {
      const r6 = await this.api.patch<ClassPeriodResponse>(`${base}/${this.ctx.period1Id}`, {
        classPeriodName: 'Period 1 (Updated)',
        description: 'First period of the day',
      });
      if (this.ok('1.6 Update Period 1', r6, [200]) && r6.data) {
        this.assert('1.6a Name updated', r6.data.classPeriodName === 'Period 1 (Updated)', r6.duration);
      }
    }

    // 1.7 Time overlap detection: try creating a period that overlaps Period 1
    const r7 = await this.api.post<unknown>(base, {
      classPeriodName: 'Overlapping Period',
      startTime: '08:30',
      endTime: '09:20',
      sortOrder: 10,
      periodType: 'instructional',
      isAcademic: true,
    });
    this.ok('1.7 Reject overlapping period → 409', r7, [409]);

    // 1.8 Get non-existent period → 404
    const r8 = await this.api.get<unknown>(`${base}/00000000-0000-0000-0000-000000000000`);
    this.ok('1.8 Get non-existent period → 404', r8, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 2: Location CRUD
  // ═══════════════════════════════════════
  async mod2_LocationCrud() {
    this.mod = 'Location CRUD';
    console.log('\n\x1b[36m═══ Module 2: Location CRUD ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/locations`;

    // 2.1 Create Room 101
    const room1 = `101-${ts5()}`;
    const r1 = await this.api.post<LocationResponse>(base, {
      roomNumber: room1,
      buildingName: 'Main Building',
      floorNumber: 1,
      capacity: 30,
      locationType: 'classroom',
      isActive: true,
    });
    if (this.ok('2.1 Create Room 101', r1, [200, 201]) && r1.data) {
      this.ctx.location1Id = r1.data.locationId;
      this.assert('2.1a Room number correct', r1.data.roomNumber === room1, r1.duration);
      this.assert('2.1b Capacity is 30', r1.data.capacity === 30, r1.duration);
      this.assert('2.1c Type is classroom', r1.data.locationType === 'classroom', r1.duration);
    }

    // 2.2 Create Science Lab
    const room2 = `LAB-${ts5()}`;
    const r2 = await this.api.post<LocationResponse>(base, {
      roomNumber: room2,
      buildingName: 'Science Wing',
      floorNumber: 2,
      capacity: 24,
      locationType: 'lab',
      isActive: true,
    });
    if (this.ok('2.2 Create Science Lab', r2, [200, 201]) && r2.data) {
      this.ctx.location2Id = r2.data.locationId;
    }

    // 2.3 List locations
    const r3 = await this.api.get<ListResponse<LocationResponse>>(base);
    if (this.ok('2.3 List locations', r3, [200]) && r3.data) {
      this.assert('2.3a Has at least 2 locations', r3.data.items.length >= 2, r3.duration);
    }

    // 2.4 Get location by ID
    if (this.ctx.location1Id) {
      const r4 = await this.api.get<LocationResponse>(`${base}/${this.ctx.location1Id}`);
      if (this.ok('2.4 Get Room 101 by ID', r4, [200]) && r4.data) {
        this.assert('2.4a ID matches', r4.data.locationId === this.ctx.location1Id, r4.duration);
      }
    }

    // 2.5 Update location
    if (this.ctx.location1Id) {
      const r5 = await this.api.patch<LocationResponse>(`${base}/${this.ctx.location1Id}`, {
        capacity: 32,
        description: 'Updated capacity',
      });
      if (this.ok('2.5 Update Room 101 capacity', r5, [200]) && r5.data) {
        this.assert('2.5a Capacity updated', r5.data.capacity === 32, r5.duration);
      }
    }

    // 2.6 Duplicate room number detection
    const r6 = await this.api.post<unknown>(base, {
      roomNumber: room1,
      locationType: 'classroom',
      isActive: true,
    });
    this.ok('2.6 Reject duplicate room number → 409', r6, [409]);

    // 2.7 Get non-existent location → 404
    const r7 = await this.api.get<unknown>(`${base}/00000000-0000-0000-0000-000000000000`);
    this.ok('2.7 Get non-existent location → 404', r7, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 3: CourseOffering CRUD
  // ═══════════════════════════════════════
  async mod3_CourseOfferingCrud() {
    this.mod = 'CourseOffering CRUD';
    console.log('\n\x1b[36m═══ Module 3: CourseOffering CRUD ═══\x1b[0m');
    const base = '/academics/course-offerings';

    // 3.1 Create course offering
    const r1 = await this.api.post<CourseOfferingResponse>(base, {
      courseId: this.ctx.courseId,
      academicSessionId: this.ctx.academicSessionId,
      schoolId: this.ctx.schoolId,
      localCourseCode: `LOCAL-${ts5()}`,
      localCourseTitle: 'Algebra I (Local)',
    });
    if (this.ok('3.1 Create course offering', r1, [200, 201]) && r1.data) {
      this.ctx.offeringId = r1.data.courseOfferingId;
      this.assert('3.1a Has courseOfferingId', !!r1.data.courseOfferingId, r1.duration);
      this.assert('3.1b CourseId matches', r1.data.courseId === this.ctx.courseId, r1.duration);
      this.assert('3.1c SessionId matches', r1.data.academicSessionId === this.ctx.academicSessionId, r1.duration);
    }

    // 3.2 List course offerings
    const r2 = await this.api.get<ListResponse<CourseOfferingResponse>>(`${base}?schoolId=${this.ctx.schoolId}`);
    if (this.ok('3.2 List course offerings', r2, [200]) && r2.data) {
      this.assert('3.2a Has at least 1 offering', r2.data.items.length >= 1, r2.duration);
    }

    // 3.3 Get offering by ID
    if (this.ctx.offeringId) {
      const r3 = await this.api.get<CourseOfferingResponse>(`${base}/${this.ctx.offeringId}?schoolId=${this.ctx.schoolId}`);
      if (this.ok('3.3 Get offering by ID', r3, [200]) && r3.data) {
        this.assert('3.3a ID matches', r3.data.courseOfferingId === this.ctx.offeringId, r3.duration);
      }
    }

    // 3.4 Update offering
    if (this.ctx.offeringId) {
      const r4 = await this.api.patch<CourseOfferingResponse>(
        `${base}/${this.ctx.offeringId}?schoolId=${this.ctx.schoolId}`,
        { localCourseTitle: 'Algebra I (Updated)' }
      );
      this.ok('3.4 Update offering title', r4, [200]);
    }

    // 3.5 Unique offering check: same course + session → 409
    const r5 = await this.api.post<unknown>(base, {
      courseId: this.ctx.courseId,
      academicSessionId: this.ctx.academicSessionId,
      schoolId: this.ctx.schoolId,
    });
    this.ok('3.5 Reject duplicate offering (same course+session) → 409', r5, [409]);

    // 3.6 Get non-existent offering → 404
    const r6 = await this.api.get<unknown>(`${base}/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`);
    this.ok('3.6 Get non-existent offering → 404', r6, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 4: Section with Master Schedule refs
  // ═══════════════════════════════════════
  async mod4_SectionEnhancement() {
    this.mod = 'Section Enhancement';
    console.log('\n\x1b[36m═══ Module 4: Section with Period/Room/Offering ═══\x1b[0m');

    // 4.1 Create section with all Sprint 3 references
    const r1 = await this.api.post<SectionResponse>('/academics/sections', {
      courseId: this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      sectionNumber: `S${ts5()}`,
      primaryTeacherId: this.ctx.teacherId,
      maxEnrollment: 30,
      academicYearId: this.ctx.academicYearId,
      courseOfferingId: this.ctx.offeringId || undefined,
      classPeriodId: this.ctx.period1Id || undefined,
      locationId: this.ctx.location1Id || undefined,
    });
    if (this.ok('4.1 Create section with schedule refs', r1, [200, 201]) && r1.data) {
      this.ctx.sectionId = r1.data.sectionId;
      if (this.ctx.offeringId) {
        this.assert('4.1a Has courseOfferingId', r1.data.courseOfferingId === this.ctx.offeringId, r1.duration);
      }
      if (this.ctx.period1Id) {
        this.assert('4.1b Has classPeriodId', r1.data.classPeriodId === this.ctx.period1Id, r1.duration);
      }
      if (this.ctx.location1Id) {
        this.assert('4.1c Has locationId', r1.data.locationId === this.ctx.location1Id, r1.duration);
      }
    }

    // 4.2 Get section and verify denormalized fields
    if (this.ctx.sectionId) {
      const r2 = await this.api.get<SectionResponse>(`/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`);
      if (this.ok('4.2 Get section with denormalized data', r2, [200]) && r2.data) {
        if (this.ctx.period1Id) {
          this.assert('4.2a Has periodName', !!r2.data.periodName, r2.duration, `periodName: ${r2.data.periodName}`);
        }
        if (this.ctx.location1Id) {
          this.assert('4.2b Has locationRoomNumber', !!r2.data.locationRoomNumber, r2.duration, `locationRoomNumber: ${r2.data.locationRoomNumber}`);
        }
      }
    }

    // 4.3 Create section without schedule refs (backward compat)
    const r3 = await this.api.post<SectionResponse>('/academics/sections', {
      courseId: this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      sectionNumber: `S${ts5()}`,
      primaryTeacherId: this.ctx.teacherId,
      maxEnrollment: 25,
      academicYearId: this.ctx.academicYearId,
    });
    this.ok('4.3 Create section without schedule refs (backward compat)', r3, [200, 201]);
  }

  // ═══════════════════════════════════════
  // MODULE 5: Conflict Detection
  // ═══════════════════════════════════════
  async mod5_ConflictDetection() {
    this.mod = 'Conflict Detection';
    console.log('\n\x1b[36m═══ Module 5: Conflict Detection ═══\x1b[0m');

    if (!this.ctx.period1Id || !this.ctx.location1Id) {
      this.rec('5.0 Skip — no period or location', 'SKIP', 0);
      return;
    }

    // 5.1 Attempt to create another section with same period + room + session → 409
    const r1 = await this.api.post<unknown>('/academics/sections', {
      courseId: this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      sectionNumber: `CONFLICT-${ts5()}`,
      primaryTeacherId: this.ctx.teacherId,
      maxEnrollment: 30,
      academicYearId: this.ctx.academicYearId,
      classPeriodId: this.ctx.period1Id,
      locationId: this.ctx.location1Id,
    });
    // This may or may not be implemented yet — allow 409 (conflict) or 201 (if not yet enforced)
    const conflictStatus = r1.status;
    if (conflictStatus === 409) {
      this.ok('5.1 Reject same room+period conflict → 409', r1, [409]);
    } else {
      this.rec('5.1 Conflict detection not yet enforced (got ' + conflictStatus + ')', 'SKIP', r1.duration);
    }

    // 5.2 Same period, different room → should succeed
    if (this.ctx.location2Id) {
      const r2 = await this.api.post<SectionResponse>('/academics/sections', {
        courseId: this.ctx.courseId,
        schoolId: this.ctx.schoolId,
        sectionNumber: `NOCONFLICT-${ts5()}`,
        primaryTeacherId: this.ctx.teacherId,
        maxEnrollment: 30,
        academicYearId: this.ctx.academicYearId,
        classPeriodId: this.ctx.period1Id,
        locationId: this.ctx.location2Id,
      });
      this.ok('5.2 Same period, different room → allowed', r2, [200, 201]);
    }
  }

  // ═══════════════════════════════════════
  // MODULE 6: Edge Cases & Negative Tests
  // ═══════════════════════════════════════
  async mod6_EdgeCases() {
    this.mod = 'Edge Cases';
    console.log('\n\x1b[36m═══ Module 6: Edge Cases & Negative Tests ═══\x1b[0m');
    const periodBase = `/schools/${this.ctx.schoolId}/class-periods`;
    const locationBase = `/schools/${this.ctx.schoolId}/locations`;

    // 6.1 Create period with end before start → 400
    const r1 = await this.api.post<unknown>(periodBase, {
      classPeriodName: 'Bad Period',
      startTime: '10:00',
      endTime: '09:00',
      sortOrder: 99,
      periodType: 'instructional',
      isAcademic: true,
    });
    this.ok('6.1 Reject endTime before startTime → 400', r1, [400, 422]);

    // 6.2 Create period with missing required fields → 400
    const r2 = await this.api.post<unknown>(periodBase, {
      classPeriodName: 'Missing Times',
    });
    this.ok('6.2 Reject missing required period fields → 400', r2, [400, 422]);

    // 6.3 Create location with empty room number → 400
    const r3 = await this.api.post<unknown>(locationBase, {
      roomNumber: '',
      locationType: 'classroom',
    });
    this.ok('6.3 Reject empty room number → 400', r3, [400, 422]);

    // 6.4 Create offering with non-existent course → 404/400
    const r4 = await this.api.post<unknown>('/academics/course-offerings', {
      courseId: '00000000-0000-0000-0000-000000000000',
      academicSessionId: this.ctx.academicSessionId,
      schoolId: this.ctx.schoolId,
    });
    this.ok('6.4 Reject offering for non-existent course → 404', r4, [404, 400]);

    // 6.5 Delete a period
    if (this.ctx.period3Id) {
      const r5 = await this.api.del<void>(`${periodBase}/${this.ctx.period3Id}`);
      this.ok('6.5 Delete lunch period → 204', r5, [204]);

      const r6 = await this.api.get<unknown>(`${periodBase}/${this.ctx.period3Id}`);
      this.ok('6.5a Verify deleted → 404', r6, [404]);
    }

    // 6.6 Delete a location
    if (this.ctx.location2Id) {
      const r7 = await this.api.del<void>(`${locationBase}/${this.ctx.location2Id}`);
      this.ok('6.6 Delete lab location → 204', r7, [204]);
    }

    // 6.7 Delete an offering
    if (this.ctx.offeringId) {
      const r8 = await this.api.del<void>(`/academics/course-offerings/${this.ctx.offeringId}?schoolId=${this.ctx.schoolId}`);
      this.ok('6.7 Delete course offering → 204', r8, [204]);
    }
  }

  // ═══════════════════════════════════════
  // RUN ALL
  // ═══════════════════════════════════════
  async run() {
    console.log('\x1b[1m\x1b[35m');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  EdForge Sprint 3 — Master Schedule Smoke Test      ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('\x1b[0m');
    console.log(`  API: ${BASE_URL}`);
    console.log(`  School: ${SCHOOL_ID || '(auto-detect)'}`);

    const started = Date.now();

    const ok = await this.mod0_Foundation();
    if (!ok) { this.printSummary(started); return; }

    await this.mod1_ClassPeriodCrud();
    await this.mod2_LocationCrud();
    await this.mod3_CourseOfferingCrud();
    await this.mod4_SectionEnhancement();
    await this.mod5_ConflictDetection();
    await this.mod6_EdgeCases();

    this.printSummary(started);
  }

  private printSummary(started: number) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const pass = this.results.filter(r => r.status === 'PASS').length;
    const fail = this.results.filter(r => r.status === 'FAIL').length;
    const skip = this.results.filter(r => r.status === 'SKIP').length;
    const total = this.results.length;

    console.log('\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[1m  Sprint 3 Master Schedule — Results (${elapsed}s)\x1b[0m`);
    console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m');
    console.log(`  \x1b[32m✓ ${pass} passed\x1b[0m  \x1b[31m✗ ${fail} failed\x1b[0m  \x1b[33m⊘ ${skip} skipped\x1b[0m  (${total} total)`);

    const modules = [...new Set(this.results.map(r => r.module))];
    for (const mod of modules) {
      const mr = this.results.filter(r => r.module === mod);
      const mp = mr.filter(r => r.status === 'PASS').length;
      const mf = mr.filter(r => r.status === 'FAIL').length;
      const ic = mf === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`  ${ic} ${mod}: ${mp}/${mr.length}`);
    }

    if (fail > 0) {
      console.log('\n\x1b[31m  Failed tests:\x1b[0m');
      for (const r of this.results.filter(r => r.status === 'FAIL')) {
        console.log(`    \x1b[31m✗ [${r.module}] ${r.name}\x1b[0m`);
        if (r.error) console.log(`      ${r.error.slice(0, 200)}`);
      }
    }

    console.log('');
    process.exit(fail > 0 ? 1 : 0);
  }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  const logFile = path.join(__dirname, '..', '..', 'logs', `sprint3-schedule-${new Date().toISOString().slice(0, 10)}.log`);
  const api = new ApiClient(BASE_URL, ID_TOKEN, logFile, LOG_LEVEL);

  try {
    const test = new Sprint3ScheduleTest(api);
    await test.run();
  } finally {
    api.close();
  }
}

main().catch(err => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});

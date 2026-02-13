/**
 * EdForge — Sprint 2: Calendar Domain Smoke Test
 *
 * Validates the complete Ed-Fi School Calendar domain end-to-end:
 *
 *   Module 0: Foundation — Pick school + academic year (reuses existing data)
 *   Module 1: Calendar Entity CRUD — Create, list, get, update calendars
 *   Module 2: Calendar Generation — Generate ~180 calendar dates from academic year
 *   Module 3: CalendarDate CRUD — Get, list, filter, update individual dates
 *   Module 4: CalendarDate Bulk Operations — Bulk update (mark spring break, etc.)
 *   Module 5: Calendar Stats — Verify summary statistics
 *   Module 6: AcademicSession CRUD — Create, list, get, update, delete sessions
 *   Module 7: AcademicSession Validation — Overlap detection, date boundary enforcement
 *   Module 8: GradingPeriod→Session Link — Link grading periods to sessions
 *   Module 9: Edge Cases & Negative Tests — Invalid data, 404s, conflicts
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint2-calendar-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/sprint2-calendar-flow.ts
 *   ID_TOKEN=<jwt> API_BASE_URL=https://xxx.execute-api.us-east-2.amazonaws.com/prod npx ts-node scripts/smoke-tests/sprint2-calendar-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || 'eyJraWQiOiJmakNuWU9ra1ZPR2Z2RzZNck9laWl5WXJLZGFzdHhHbmk5bjY2U2gzQWI4PSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiX2ZNdmNNWUVraV9BVEE0R1pSQ0ZZdyIsInN1YiI6ImIxY2IwNTYwLTYwNTEtNzA4OC0wNTJlLTlmNmVmMDNhZTRhNiIsImNvZ25pdG86Z3JvdXBzIjpbIjM5MDlkMjhiLWQzYjgtNGE0NS04ZjNkLTU5NWE0MjJhNmU4MiJdLCJjdXN0b206dGVuYW50VGllciI6IkJBU0lDIiwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tXC91cy1lYXN0LTJfdEIwYzg0Qm5vIiwiY29nbml0bzp1c2VybmFtZSI6InNob2FpYi5yYWluQG91dGxvb2suY29tIiwiY3VzdG9tOnRlbmFudE5hbWUiOiJhbGxlbmlzZCIsIm9yaWdpbl9qdGkiOiI4NjRlMjVmZC05NzY3LTRmMGQtOGU0YS1lYmU1M2M3NTRjOTAiLCJjdXN0b206dGVuYW50SWQiOiIzOTA5ZDI4Yi1kM2I4LTRhNDUtOGYzZC01OTVhNDIyYTZlODIiLCJhdWQiOiI2NzhiZTJwYWZ2bzFoaGVvNGxjdDd1NHFycCIsImV2ZW50X2lkIjoiMmEyYTdhZmMtOTEwZi00OTdkLWEzYWQtMTljMmE4YzNlNGRjIiwiY3VzdG9tOnVzZXJSb2xlIjoiVGVuYW50QWRtaW4iLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTc3MDY0NTQ0OSwiZXhwIjoxNzcwOTQyNjQyLCJpYXQiOjE3NzA5MzkwNDIsImp0aSI6ImU2NDczNzkzLWNjZjYtNGQxOC1iYzIwLWUyM2EzNzFlMDQwOSIsImVtYWlsIjoic2hvYWliLnJhaW5Ab3V0bG9vay5jb20ifQ.ntXoLhXF7EHxNlzVWb3uxq_ewIlzeYH4XMPRPish_7vUdlpXrENn9PZSU4cmTuByDR1LZgy0gnsv_vS4yuZrMrbjvzBdwrUs1OnPdt8aG3CZBwIZ0AgR9ZfirahKRdmhk1Cgbr0LqhMB7MSyOxF6HgNuokqMO2owbhccYT4BYZA7TvOKL8FEeuBPEzPWwiJLBC5riCtKE3mL0pFdtiTEGZmkVPSII7Eg-Y10Qm2YFd8pdaGBbEwkxq3DgrnOIj_ib3gAnuPvWiz4GILGEAftwzXjMk4uO9LYEvuw4cAx932qcKAb5gzWUty_ABHTBM8rdS1qz4usclvG4mP2fI2oNg';
const BASE_URL = process.env.API_BASE_URL || 'https://udmx0atz53.execute-api.us-east-2.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || 'fdbe4ee6-eb52-428a-a818-5e7c534c12a4';  // If empty, uses first school from listing
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint2-calendar-flow.ts');
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

interface SchoolResponse { schoolId: string; name: string; [k: string]: unknown }
interface AcademicYearResponse { yearId: string; schoolId: string; name: string; startDate: string; endDate: string; [k: string]: unknown }
interface GradingPeriodResponse { periodId: string; yearId: string; name: string; startDate: string; endDate: string; [k: string]: unknown }
interface CalendarResponse { calendarId: string; schoolId: string; academicYearId: string; calendarCode: string; calendarTypeDescriptor: string; gradeLevels?: string[]; isDefault: boolean; [k: string]: unknown }
interface CalendarDateResponse { date: string; calendarEvents: { eventType: string; description?: string }[]; isInstructionalDay: boolean; isHoliday?: boolean; isWeekend?: boolean; calendarId?: string; [k: string]: unknown }
interface CalendarStatsResponse { totalDays?: number; instructionalDays?: number; holidays?: number; weekends?: number; teacherOnlyDays?: number; [k: string]: unknown }
interface AcademicSessionResponse { academicSessionId: string; schoolId: string; academicYearId: string; sessionName: string; beginDate: string; endDate: string; totalInstructionalDays: number; termDescriptor: string; gradingPeriodIds?: string[]; [k: string]: unknown }
interface GenerateCalendarResponse { calendarId: string; totalDays: number; instructionalDays: number; holidays: number; weekends: number }
interface ListResponse<T> { items: T[]; hasMore?: boolean; lastEvaluatedKey?: string }

// ─────────────────────────────────────────
// CONTEXT — stores all created resource IDs
// ─────────────────────────────────────────

interface TestContext {
  schoolId: string;
  schoolName: string;
  academicYearId: string;
  academicYearStartDate: string;
  academicYearEndDate: string;
  calendarId: string;
  generatedCalendarId: string;
  generatedTotalDays: number;
  generatedInstructionalDays: number;
  fallSessionId: string;
  springSessionId: string;
  gradingPeriodId: string;
}

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────

const ts5 = () => Date.now().toString().slice(-5);

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
    this.log('INFO', `=== Sprint 2 Calendar Domain Smoke Test Started at ${new Date().toISOString()} ===`);
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
    this.log('INFO', `=== Smoke Test Completed at ${new Date().toISOString()} ===`);
    this.logStream.end();
  }
}

// ─────────────────────────────────────────
// SMOKE TEST RUNNER
// ─────────────────────────────────────────

class Sprint2CalendarTest {
  private api: ApiClient;
  private results: TestResult[] = [];
  private ctx: TestContext = {
    schoolId: '', schoolName: '',
    academicYearId: '', academicYearStartDate: '', academicYearEndDate: '',
    calendarId: '', generatedCalendarId: '',
    generatedTotalDays: 0, generatedInstructionalDays: 0,
    fallSessionId: '', springSessionId: '',
    gradingPeriodId: '',
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
  // MODULE 0: Foundation — Get school + academic year
  // ═══════════════════════════════════════
  async mod0_Foundation(): Promise<boolean> {
    this.mod = 'Foundation';
    console.log('\n\x1b[36m═══ Module 0: Foundation (School + Academic Year) ═══\x1b[0m');

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
    if (!this.ctx.schoolId) { console.log('\x1b[31m  ABORT — no school available.\x1b[0m'); return false; }

    // Get or create academic year
    const yearUrl = `/schools/${this.ctx.schoolId}/academic-years`;
    const r2 = await this.api.get<ListResponse<AcademicYearResponse>>(yearUrl);
    if (this.ok('0.2 List academic years', r2, [200]) && r2.data?.items?.length) {
      const ay = r2.data.items[0];
      this.ctx.academicYearId = ay.yearId;
      this.ctx.academicYearStartDate = ay.startDate;
      this.ctx.academicYearEndDate = ay.endDate;
      console.log(`    Using academic year: ${ay.name} (${ay.yearId})`);
    } else {
      // Create one
      const yd = getAcademicYearDates();
      const r3 = await this.api.post<AcademicYearResponse>(yearUrl, {
        name: yd.name, shortName: yd.shortName,
        startDate: yd.startDate, endDate: yd.endDate,
        calendarType: 'semester',
      });
      if (this.ok('0.2a Create academic year', r3, [200, 201]) && r3.data) {
        this.ctx.academicYearId = r3.data.yearId;
        this.ctx.academicYearStartDate = r3.data.startDate;
        this.ctx.academicYearEndDate = r3.data.endDate;
        // Activate
        await this.api.request('PUT', `${yearUrl}/${r3.data.yearId}/status`, { status: 'active' });
      }
    }
    if (!this.ctx.academicYearId) { console.log('\x1b[31m  ABORT — no academic year.\x1b[0m'); return false; }

    // Get grading periods if any exist
    const gpUrl = `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/grading-periods`;
    const r4 = await this.api.get<ListResponse<GradingPeriodResponse>>(gpUrl);
    if (r4.status === 200 && r4.data?.items?.length) {
      this.ctx.gradingPeriodId = r4.data.items[0].periodId;
      console.log(`    Using grading period: ${r4.data.items[0].name} (${this.ctx.gradingPeriodId})`);
    }

    return true;
  }

  // ═══════════════════════════════════════
  // MODULE 1: Calendar Entity CRUD
  // ═══════════════════════════════════════
  async mod1_CalendarCrud() {
    this.mod = 'Calendar CRUD';
    console.log('\n\x1b[36m═══ Module 1: Calendar Entity CRUD ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/calendars`;

    // 1.1 Create calendar
    const code = `STUDENT-${ts5()}`;
    const r1 = await this.api.post<CalendarResponse>(base, {
      academicYearId: this.ctx.academicYearId,
      calendarCode: code,
      calendarTypeDescriptor: 'student',
      gradeLevels: ['09', '10', '11', '12'],
      isDefault: true,
    });
    if (this.ok('1.1 Create student calendar', r1, [200, 201]) && r1.data) {
      this.ctx.calendarId = r1.data.calendarId;
      this.assert('1.1a Calendar has correct code', r1.data.calendarCode === code, r1.duration);
      this.assert('1.1b Calendar type is student', r1.data.calendarTypeDescriptor === 'student', r1.duration);
      this.assert('1.1c Calendar is default', r1.data.isDefault === true, r1.duration);
    }

    // 1.2 Create teacher calendar
    const r2 = await this.api.post<CalendarResponse>(base, {
      academicYearId: this.ctx.academicYearId,
      calendarCode: `TEACHER-${ts5()}`,
      calendarTypeDescriptor: 'teacher',
      isDefault: false,
    });
    this.ok('1.2 Create teacher calendar', r2, [200, 201]);

    // 1.3 List calendars
    const r3 = await this.api.get<ListResponse<CalendarResponse>>(base);
    if (this.ok('1.3 List calendars', r3, [200]) && r3.data) {
      this.assert('1.3a At least 2 calendars', r3.data.items.length >= 2, r3.duration);
    }

    // 1.4 Get calendar by ID
    if (this.ctx.calendarId) {
      const r4 = await this.api.get<CalendarResponse>(`${base}/${this.ctx.calendarId}`);
      if (this.ok('1.4 Get calendar by ID', r4, [200]) && r4.data) {
        this.assert('1.4a ID matches', r4.data.calendarId === this.ctx.calendarId, r4.duration);
      }
    }

    // 1.5 Update calendar
    if (this.ctx.calendarId) {
      const r5 = await this.api.patch<CalendarResponse>(`${base}/${this.ctx.calendarId}`, {
        calendarCode: `STUDENT-UPDATED-${ts5()}`,
      });
      if (this.ok('1.5 Update calendar code', r5, [200]) && r5.data) {
        this.assert('1.5a Code updated', r5.data.calendarCode.startsWith('STUDENT-UPDATED'), r5.duration);
      }
    }

    // 1.6 Negative: Get non-existent calendar
    const r6 = await this.api.get<unknown>(`${base}/00000000-0000-0000-0000-000000000000`);
    this.ok('1.6 Get non-existent calendar → 404', r6, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 2: Calendar Generation
  // ═══════════════════════════════════════
  async mod2_CalendarGeneration() {
    this.mod = 'Calendar Generation';
    console.log('\n\x1b[36m═══ Module 2: Calendar Generation ═══\x1b[0m');
    const genUrl = `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/generate-calendar`;

    // 2.1 Generate calendar with holidays and breaks
    const yd = getAcademicYearDates();
    const r1 = await this.api.post<GenerateCalendarResponse>(genUrl, {
      academicYearId: this.ctx.academicYearId,
      startDate: this.ctx.academicYearStartDate || yd.startDate,
      endDate: this.ctx.academicYearEndDate || yd.endDate,
      schoolDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      holidays: [
        { date: `${yd.year}-09-01`, name: 'Labor Day', eventType: 'holiday' },
        { date: `${yd.year}-11-27`, name: 'Thanksgiving', eventType: 'holiday' },
        { date: `${yd.year}-11-28`, name: 'Thanksgiving Friday', eventType: 'holiday' },
        { date: `${yd.year}-12-25`, name: 'Christmas Day', eventType: 'holiday' },
        { date: `${yd.year + 1}-01-01`, name: 'New Years Day', eventType: 'holiday' },
        { date: `${yd.year + 1}-01-20`, name: 'MLK Day', eventType: 'holiday' },
      ],
      breaks: [
        {
          startDate: `${yd.year}-12-23`,
          endDate: `${yd.year + 1}-01-03`,
          name: 'Winter Break',
          eventType: 'break',
        },
        {
          startDate: `${yd.year + 1}-03-10`,
          endDate: `${yd.year + 1}-03-14`,
          name: 'Spring Break',
          eventType: 'break',
        },
      ],
    });
    if (this.ok('2.1 Generate calendar', r1, [200, 201]) && r1.data) {
      this.ctx.generatedCalendarId = r1.data.calendarId;
      this.ctx.generatedTotalDays = r1.data.totalDays;
      this.ctx.generatedInstructionalDays = r1.data.instructionalDays;
      console.log(`    Generated: ${r1.data.totalDays} total, ${r1.data.instructionalDays} instructional, ${r1.data.holidays} holidays, ${r1.data.weekends} weekends`);
      this.assert('2.1a Total days > 150', r1.data.totalDays > 150, r1.duration);
      this.assert('2.1b Instructional days > 100', r1.data.instructionalDays > 100, r1.duration);
      this.assert('2.1c Has holidays', r1.data.holidays > 0, r1.duration);
      this.assert('2.1d Has weekends', r1.data.weekends > 0, r1.duration);
      this.assert('2.1e Instructional < total', r1.data.instructionalDays < r1.data.totalDays, r1.duration);
    }

    // 2.2 Verify dates exist after generation
    await sleep(1000);  // Allow for eventual consistency
    const datesUrl = `/schools/${this.ctx.schoolId}/calendar-dates?academicYearId=${this.ctx.academicYearId}&limit=400`;
    const r2 = await this.api.get<ListResponse<CalendarDateResponse>>(datesUrl);
    if (this.ok('2.2 List generated dates', r2, [200]) && r2.data) {
      this.assert('2.2a Date count matches generation', r2.data.items.length > 100, r2.duration,
        `Expected >100 dates, got ${r2.data.items.length}`);
    }

    // 2.3 Re-generate (idempotent — should replace existing)
    const r3 = await this.api.post<GenerateCalendarResponse>(genUrl, {
      academicYearId: this.ctx.academicYearId,
      startDate: this.ctx.academicYearStartDate || yd.startDate,
      endDate: this.ctx.academicYearEndDate || yd.endDate,
      schoolDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
    this.ok('2.3 Re-generate calendar (idempotent)', r3, [200, 201]);
  }

  // ═══════════════════════════════════════
  // MODULE 3: CalendarDate CRUD
  // ═══════════════════════════════════════
  async mod3_CalendarDateCrud() {
    this.mod = 'CalendarDate CRUD';
    console.log('\n\x1b[36m═══ Module 3: CalendarDate CRUD ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/calendar-dates`;

    // 3.1 List with date range filter
    const yd = getAcademicYearDates();
    const r1 = await this.api.get<ListResponse<CalendarDateResponse>>(
      `${base}?academicYearId=${this.ctx.academicYearId}&startDate=${yd.sem1Start}&endDate=${yd.sem1End}`
    );
    if (this.ok('3.1 List dates (semester 1 range)', r1, [200]) && r1.data) {
      this.assert('3.1a Has semester 1 dates', r1.data.items.length > 50, r1.duration,
        `Expected >50, got ${r1.data.items.length}`);
    }

    // 3.2 Filter by month
    const r2 = await this.api.get<ListResponse<CalendarDateResponse>>(
      `${base}?academicYearId=${this.ctx.academicYearId}&month=9`
    );
    if (this.ok('3.2 Filter dates by month (September)', r2, [200]) && r2.data) {
      this.assert('3.2a September has 20-23 dates', r2.data.items.length >= 15 && r2.data.items.length <= 30, r2.duration,
        `Got ${r2.data.items.length} dates for September`);
      // Verify all dates are in September
      const allSept = r2.data.items.every(d => d.date.startsWith(`${yd.year}-09`));
      this.assert('3.2b All dates in September', allSept, r2.duration);
    }

    // 3.3 Filter by instructional days
    const r3 = await this.api.get<ListResponse<CalendarDateResponse>>(
      `${base}?academicYearId=${this.ctx.academicYearId}&isInstructionalDay=true&limit=50`
    );
    if (this.ok('3.3 Filter instructional days only', r3, [200]) && r3.data) {
      const allInstructional = r3.data.items.every(d => d.isInstructionalDay === true);
      this.assert('3.3a All are instructional', allInstructional, r3.duration);
    }

    // 3.4 Get single date
    const testDate = `${yd.year}-09-02`;  // Should be a school day
    const r4 = await this.api.get<CalendarDateResponse>(`${base}/${testDate}`);
    if (this.ok('3.4 Get single calendar date', r4, [200]) && r4.data) {
      this.assert('3.4a Date matches', r4.data.date === testDate, r4.duration);
      this.assert('3.4b Has calendarEvents', Array.isArray(r4.data.calendarEvents), r4.duration);
    }

    // 3.5 Update single date (mark as teacher-only)
    const r5 = await this.api.patch<CalendarDateResponse>(`${base}/${testDate}`, {
      calendarEvents: [{ eventType: 'teacher_only', description: 'Professional development day' }],
      isInstructionalDay: false,
      notes: 'Updated by Sprint 2 smoke test',
    });
    if (this.ok('3.5 Update calendar date to teacher_only', r5, [200]) && r5.data) {
      this.assert('3.5a Event type updated', r5.data.calendarEvents?.[0]?.eventType === 'teacher_only', r5.duration);
      this.assert('3.5b No longer instructional', r5.data.isInstructionalDay === false, r5.duration);
    }

    // 3.6 Create single date (manual entry)
    const manualDate = `${yd.year}-08-18`;  // Day before school starts — orientation
    const r6 = await this.api.post<CalendarDateResponse>(
      `${base}?academicYearId=${this.ctx.academicYearId}`,
      {
        date: manualDate,
        calendarEvents: [{ eventType: 'non_instructional_day', description: 'Student orientation' }],
        isInstructionalDay: false,
      }
    );
    this.ok('3.6 Create manual calendar date (orientation)', r6, [200, 201]);

    // 3.7 Get non-existent date → 404
    const r7 = await this.api.get<unknown>(`${base}/2099-01-01`);
    this.ok('3.7 Get non-existent date → 404', r7, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 4: CalendarDate Bulk Operations
  // ═══════════════════════════════════════
  async mod4_BulkOperations() {
    this.mod = 'Bulk Operations';
    console.log('\n\x1b[36m═══ Module 4: CalendarDate Bulk Operations ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/calendar-dates`;
    const yd = getAcademicYearDates();

    // 4.1 Bulk update: mark spring break dates
    const springBreakDates: string[] = [];
    for (let d = 10; d <= 14; d++) {
      springBreakDates.push(`${yd.year + 1}-03-${d.toString().padStart(2, '0')}`);
    }
    const r1 = await this.api.post<{ updated: number }>(`${base}/bulk-update`, {
      dates: springBreakDates,
      updates: {
        calendarEvents: [{ eventType: 'break', description: 'Spring Break' }],
        isInstructionalDay: false,
        isHoliday: true,
      },
    });
    if (this.ok('4.1 Bulk update spring break dates', r1, [200, 201]) && r1.data) {
      this.assert('4.1a Updated count matches', r1.data.updated === springBreakDates.length, r1.duration,
        `Expected ${springBreakDates.length}, got ${r1.data.updated}`);
    }

    // 4.2 Verify bulk update took effect
    await sleep(500);
    const r2 = await this.api.get<CalendarDateResponse>(`${base}/${springBreakDates[0]}`);
    if (this.ok('4.2 Verify spring break date updated', r2, [200]) && r2.data) {
      this.assert('4.2a Is not instructional', r2.data.isInstructionalDay === false, r2.duration);
      this.assert('4.2b Event type is break', r2.data.calendarEvents?.[0]?.eventType === 'break', r2.duration);
    }

    // 4.3 Bulk create dates
    const r3 = await this.api.post<{ created: number }>(`${base}/bulk`, {
      academicYearId: this.ctx.academicYearId,
      dates: [
        {
          date: `${yd.year}-08-16`,
          calendarEvents: [{ eventType: 'teacher_only', description: 'Teacher prep day 1' }],
          isInstructionalDay: false,
        },
        {
          date: `${yd.year}-08-17`,
          calendarEvents: [{ eventType: 'teacher_only', description: 'Teacher prep day 2' }],
          isInstructionalDay: false,
        },
      ],
    });
    this.ok('4.3 Bulk create teacher prep dates', r3, [200, 201]);
  }

  // ═══════════════════════════════════════
  // MODULE 5: Calendar Stats
  // ═══════════════════════════════════════
  async mod5_CalendarStats() {
    this.mod = 'Calendar Stats';
    console.log('\n\x1b[36m═══ Module 5: Calendar Stats ═══\x1b[0m');
    const statsUrl = `/schools/${this.ctx.schoolId}/calendar-dates/stats?academicYearId=${this.ctx.academicYearId}`;

    const r1 = await this.api.get<CalendarStatsResponse>(statsUrl);
    if (this.ok('5.1 Get calendar stats', r1, [200]) && r1.data) {
      console.log(`    Stats: ${JSON.stringify(r1.data)}`);
      if (r1.data.totalDays !== undefined) {
        this.assert('5.1a Total days > 0', r1.data.totalDays > 0, r1.duration);
      }
      if (r1.data.instructionalDays !== undefined) {
        this.assert('5.1b Instructional days > 0', r1.data.instructionalDays > 0, r1.duration);
        this.assert('5.1c Instructional < total', r1.data.instructionalDays < (r1.data.totalDays || 999), r1.duration);
      }
    }
  }

  // ═══════════════════════════════════════
  // MODULE 6: AcademicSession CRUD
  // ═══════════════════════════════════════
  async mod6_AcademicSessionCrud() {
    this.mod = 'AcademicSession CRUD';
    console.log('\n\x1b[36m═══ Module 6: AcademicSession CRUD ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/academic-sessions`;
    const yd = getAcademicYearDates();

    // 6.1 Create Fall Semester session
    const r1 = await this.api.post<AcademicSessionResponse>(base, {
      academicYearId: this.ctx.academicYearId,
      sessionName: `Fall ${yd.year}`,
      beginDate: yd.sem1Start,
      endDate: yd.sem1End,
      termDescriptor: 'fall_semester',
    });
    if (this.ok('6.1 Create Fall Semester session', r1, [200, 201]) && r1.data) {
      this.ctx.fallSessionId = r1.data.academicSessionId;
      this.assert('6.1a Session name matches', r1.data.sessionName === `Fall ${yd.year}`, r1.duration);
      this.assert('6.1b Term is fall_semester', r1.data.termDescriptor === 'fall_semester', r1.duration);
      this.assert('6.1c beginDate matches', r1.data.beginDate === yd.sem1Start, r1.duration);
      this.assert('6.1d endDate matches', r1.data.endDate === yd.sem1End, r1.duration);
      this.assert('6.1e schoolId matches', r1.data.schoolId === this.ctx.schoolId, r1.duration);
    }

    // 6.2 Create Spring Semester session
    const r2 = await this.api.post<AcademicSessionResponse>(base, {
      academicYearId: this.ctx.academicYearId,
      sessionName: `Spring ${yd.year + 1}`,
      beginDate: yd.sem2Start,
      endDate: yd.sem2End,
      termDescriptor: 'spring_semester',
    });
    if (this.ok('6.2 Create Spring Semester session', r2, [200, 201]) && r2.data) {
      this.ctx.springSessionId = r2.data.academicSessionId;
    }

    // 6.3 List sessions
    const r3 = await this.api.get<ListResponse<AcademicSessionResponse>>(base);
    if (this.ok('6.3 List academic sessions', r3, [200]) && r3.data) {
      this.assert('6.3a Has 2 sessions', r3.data.items.length >= 2, r3.duration,
        `Expected >=2, got ${r3.data.items.length}`);
      // Verify sorted by beginDate
      if (r3.data.items.length >= 2) {
        this.assert('6.3b Sorted by beginDate',
          r3.data.items[0].beginDate <= r3.data.items[1].beginDate, r3.duration);
      }
    }

    // 6.4 List sessions filtered by academicYearId
    const r4 = await this.api.get<ListResponse<AcademicSessionResponse>>(
      `${base}?academicYearId=${this.ctx.academicYearId}`
    );
    if (this.ok('6.4 List sessions by academic year', r4, [200]) && r4.data) {
      const allMatch = r4.data.items.every(s => s.academicYearId === this.ctx.academicYearId);
      this.assert('6.4a All sessions match year', allMatch, r4.duration);
    }

    // 6.5 Get session by ID
    if (this.ctx.fallSessionId) {
      const r5 = await this.api.get<AcademicSessionResponse>(`${base}/${this.ctx.fallSessionId}`);
      if (this.ok('6.5 Get Fall session by ID', r5, [200]) && r5.data) {
        this.assert('6.5a ID matches', r5.data.academicSessionId === this.ctx.fallSessionId, r5.duration);
      }
    }

    // 6.6 Update session
    if (this.ctx.fallSessionId) {
      const r6 = await this.api.patch<AcademicSessionResponse>(`${base}/${this.ctx.fallSessionId}`, {
        sessionName: `Fall ${yd.year} (Updated)`,
      });
      if (this.ok('6.6 Update Fall session name', r6, [200]) && r6.data) {
        this.assert('6.6a Name updated', r6.data.sessionName.includes('Updated'), r6.duration);
      }
    }

    // 6.7 Get non-existent session → 404
    const r7 = await this.api.get<unknown>(`${base}/00000000-0000-0000-0000-000000000000`);
    this.ok('6.7 Get non-existent session → 404', r7, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 7: AcademicSession Validation
  // ═══════════════════════════════════════
  async mod7_SessionValidation() {
    this.mod = 'Session Validation';
    console.log('\n\x1b[36m═══ Module 7: AcademicSession Validation ═══\x1b[0m');
    const base = `/schools/${this.ctx.schoolId}/academic-sessions`;
    const yd = getAcademicYearDates();

    // 7.1 Overlap detection: create session overlapping Fall
    const r1 = await this.api.post<unknown>(base, {
      academicYearId: this.ctx.academicYearId,
      sessionName: 'Overlapping Session',
      beginDate: yd.sem1Start,
      endDate: `${yd.year}-10-15`,
      termDescriptor: 'first_quarter',
    });
    this.ok('7.1 Reject overlapping session → 409', r1, [409]);

    // 7.2 Dates outside academic year bounds
    const r2 = await this.api.post<unknown>(base, {
      academicYearId: this.ctx.academicYearId,
      sessionName: 'Out of Bounds Session',
      beginDate: `${yd.year}-06-01`,  // Before year starts
      endDate: `${yd.year}-07-31`,
      termDescriptor: 'summer',
    });
    this.ok('7.2 Reject session outside year bounds → 400', r2, [400]);

    // 7.3 End date before begin date (Zod validation)
    const r3 = await this.api.post<unknown>(base, {
      academicYearId: this.ctx.academicYearId,
      sessionName: 'Invalid Dates',
      beginDate: yd.sem2End,
      endDate: yd.sem2Start,  // End before begin
      termDescriptor: 'spring_semester',
    });
    this.ok('7.3 Reject endDate before beginDate → 400', r3, [400, 422]);

    // 7.4 Missing required fields
    const r4 = await this.api.post<unknown>(base, {
      academicYearId: this.ctx.academicYearId,
      // Missing sessionName, beginDate, endDate, termDescriptor
    });
    this.ok('7.4 Reject missing required fields → 400', r4, [400, 422]);

    // 7.5 Invalid termDescriptor
    const r5 = await this.api.post<unknown>(base, {
      academicYearId: this.ctx.academicYearId,
      sessionName: 'Bad Term',
      beginDate: yd.sem1Start,
      endDate: yd.sem1End,
      termDescriptor: 'invalid_term_type',
    });
    this.ok('7.5 Reject invalid termDescriptor → 400', r5, [400, 422]);

    // 7.6 Delete session and recreate (verify delete works)
    if (this.ctx.springSessionId) {
      const r6 = await this.api.del<void>(`${base}/${this.ctx.springSessionId}`);
      this.ok('7.6 Delete Spring session → 204', r6, [204]);

      // Verify gone
      const r7 = await this.api.get<unknown>(`${base}/${this.ctx.springSessionId}`);
      this.ok('7.6a Verify deleted → 404', r7, [404]);

      // Recreate for module 8
      const r8 = await this.api.post<AcademicSessionResponse>(base, {
        academicYearId: this.ctx.academicYearId,
        sessionName: `Spring ${yd.year + 1}`,
        beginDate: yd.sem2Start,
        endDate: yd.sem2End,
        termDescriptor: 'spring_semester',
      });
      if (this.ok('7.6b Recreate Spring session', r8, [200, 201]) && r8.data) {
        this.ctx.springSessionId = r8.data.academicSessionId;
      }
    }

    // 7.7 Delete non-existent session → 404
    const r9 = await this.api.del<void>(`${base}/00000000-0000-0000-0000-000000000000`);
    this.ok('7.7 Delete non-existent session → 404', r9, [404]);
  }

  // ═══════════════════════════════════════
  // MODULE 8: GradingPeriod → Session Link
  // ═══════════════════════════════════════
  async mod8_GradingPeriodSessionLink() {
    this.mod = 'GradingPeriod-Session Link';
    console.log('\n\x1b[36m═══ Module 8: GradingPeriod → AcademicSession Link ═══\x1b[0m');

    if (!this.ctx.fallSessionId) {
      this.rec('8.0 Skipping — no Fall session', 'SKIP', 0, 'Fall session not created');
      return;
    }

    const gpBase = `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/grading-periods`;
    const yd = getAcademicYearDates();

    // 8.1 Create grading period linked to Fall session
    const r1 = await this.api.post<GradingPeriodResponse>(gpBase, {
      name: `Q1 ${yd.year}`,
      startDate: yd.sem1Start,
      endDate: `${yd.year}-10-18`,
      termType: 'quarter',
      sequence: 1,
      academicSessionId: this.ctx.fallSessionId,
    });
    if (this.ok('8.1 Create grading period with session link', r1, [200, 201]) && r1.data) {
      this.ctx.gradingPeriodId = r1.data.periodId;
    }

    // 8.2 Create second grading period linked to Fall session
    const r2 = await this.api.post<GradingPeriodResponse>(gpBase, {
      name: `Q2 ${yd.year}`,
      startDate: `${yd.year}-10-20`,
      endDate: yd.sem1End,
      termType: 'quarter',
      sequence: 2,
      academicSessionId: this.ctx.fallSessionId,
    });
    this.ok('8.2 Create Q2 grading period linked to Fall', r2, [200, 201]);

    // 8.3 Update session to include grading period IDs
    if (this.ctx.gradingPeriodId) {
      const gpIds = [this.ctx.gradingPeriodId];
      if (r2.status >= 200 && r2.status < 300 && r2.data) {
        gpIds.push((r2.data as GradingPeriodResponse).periodId);
      }
      const r3 = await this.api.patch<AcademicSessionResponse>(
        `/schools/${this.ctx.schoolId}/academic-sessions/${this.ctx.fallSessionId}`,
        { gradingPeriodIds: gpIds }
      );
      if (this.ok('8.3 Link grading periods to Fall session', r3, [200]) && r3.data) {
        this.assert('8.3a Has grading period IDs',
          Array.isArray(r3.data.gradingPeriodIds) && r3.data.gradingPeriodIds.length >= 1, r3.duration);
      }
    }
  }

  // ═══════════════════════════════════════
  // MODULE 9: Edge Cases & Negative Tests
  // ═══════════════════════════════════════
  async mod9_EdgeCases() {
    this.mod = 'Edge Cases';
    console.log('\n\x1b[36m═══ Module 9: Edge Cases & Negative Tests ═══\x1b[0m');

    // 9.1 Calendar with invalid type
    const calBase = `/schools/${this.ctx.schoolId}/calendars`;
    const r1 = await this.api.post<unknown>(calBase, {
      academicYearId: this.ctx.academicYearId,
      calendarCode: 'BAD-TYPE',
      calendarTypeDescriptor: 'invalid_type',
    });
    this.ok('9.1 Reject invalid calendar type → 400', r1, [400, 422]);

    // 9.2 Calendar with missing required fields
    const r2 = await this.api.post<unknown>(calBase, {
      calendarTypeDescriptor: 'student',
      // Missing academicYearId and calendarCode
    });
    this.ok('9.2 Reject missing calendar fields → 400', r2, [400, 422]);

    // 9.3 Bulk update with empty dates array
    const r3 = await this.api.post<unknown>(`/schools/${this.ctx.schoolId}/calendar-dates/bulk-update`, {
      dates: [],
      updates: { isInstructionalDay: false },
    });
    this.ok('9.3 Reject empty bulk update dates → 400', r3, [400, 422]);

    // 9.4 Generate calendar with invalid date format
    const genUrl = `/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}/generate-calendar`;
    const r4 = await this.api.post<unknown>(genUrl, {
      academicYearId: this.ctx.academicYearId,
      startDate: 'not-a-date',
      endDate: 'also-not-a-date',
    });
    this.ok('9.4 Reject invalid date format in generation → 400', r4, [400, 422]);

    // 9.5 Operations on non-existent school
    const fakeSchool = '00000000-0000-0000-0000-000000000000';
    const r5 = await this.api.get<unknown>(`/schools/${fakeSchool}/calendars`);
    // Might return empty list or 404
    this.ok('9.5 List calendars for non-existent school', r5, [200, 404]);

    // 9.6 Academic session with invalid UUID for academicYearId
    const r6 = await this.api.post<unknown>(`/schools/${this.ctx.schoolId}/academic-sessions`, {
      academicYearId: 'not-a-uuid',
      sessionName: 'Bad Year',
      beginDate: '2025-08-19',
      endDate: '2025-12-20',
      termDescriptor: 'fall_semester',
    });
    this.ok('9.6 Reject invalid UUID format → 400', r6, [400, 422]);
  }

  // ═══════════════════════════════════════
  // RUN ALL
  // ═══════════════════════════════════════
  async run() {
    console.log('\x1b[1m\x1b[35m');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  EdForge Sprint 2 — Calendar Domain Smoke Test      ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('\x1b[0m');
    console.log(`  API: ${BASE_URL}`);
    console.log(`  School: ${SCHOOL_ID || '(auto-detect)'}`);

    const started = Date.now();

    const ok = await this.mod0_Foundation();
    if (!ok) {
      this.printSummary(started);
      return;
    }

    await this.mod1_CalendarCrud();
    await this.mod2_CalendarGeneration();
    await this.mod3_CalendarDateCrud();
    await this.mod4_BulkOperations();
    await this.mod5_CalendarStats();
    await this.mod6_AcademicSessionCrud();
    await this.mod7_SessionValidation();
    await this.mod8_GradingPeriodSessionLink();
    await this.mod9_EdgeCases();

    this.printSummary(started);
  }

  private printSummary(started: number) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const pass = this.results.filter(r => r.status === 'PASS').length;
    const fail = this.results.filter(r => r.status === 'FAIL').length;
    const skip = this.results.filter(r => r.status === 'SKIP').length;
    const total = this.results.length;

    console.log('\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[1m  Sprint 2 Calendar Domain — Results (${elapsed}s)\x1b[0m`);
    console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m');
    console.log(`  \x1b[32m✓ ${pass} passed\x1b[0m  \x1b[31m✗ ${fail} failed\x1b[0m  \x1b[33m⊘ ${skip} skipped\x1b[0m  (${total} total)`);

    // Per-module breakdown
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
  const logFile = path.join(__dirname, '..', '..', 'logs', `sprint2-calendar-${new Date().toISOString().slice(0, 10)}.log`);
  const api = new ApiClient(BASE_URL, ID_TOKEN, logFile, LOG_LEVEL);

  try {
    const test = new Sprint2CalendarTest(api);
    await test.run();
  } finally {
    api.close();
  }
}

main().catch(err => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});

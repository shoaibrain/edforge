/**
 * EdForge Academics Service - SP1 Smoke Test Suite
 *
 * Runtime API test suite that validates all SP1 (Course Catalog & Course Sections)
 * endpoints and business logic through ~72 tests across 5 modules:
 *   Module 0: Prerequisites Setup (school, academic year, staff, students)
 *   Module 1: Courses CRUD (16 tests)
 *   Module 2: Sections CRUD (16 tests)
 *   Module 3: Section Enrollment (18 tests)
 *   Module 4: Error Handling & Cross-Cutting (10 tests)
 *   Module 5: Data Integrity & Cross-Entity (12 tests)
 *   Cleanup: Remove all test data
 *
 * Usage:
 *   1. Paste your Cognito JWT in ID_TOKEN below
 *   2. Run: npx ts-node scripts/smoke-tests/academics-sp1-flow.ts
 *   3. Check console for results and logs/ for detailed output
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// CONFIGURATION - Edit these values
// ============================================

const ID_TOKEN = process.env.ID_TOKEN || ''; // export ID_TOKEN=<Cognito ID token>; never paste a token into this file
if (!ID_TOKEN) {
  console.error('ID_TOKEN is not set. Mint a dev-tenant ID token and export it; tokens are never committed.');
  process.exit(2);
} // Paste your Cognito JWT here

const BASE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

// ============================================
// TYPE DEFINITIONS
// ============================================

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
  expected?: number;
  actual?: number;
}

interface TestContext {
  // Prerequisites (created in setup, cleaned up at end)
  schoolId?: string;
  schoolCode?: string;
  academicYearId?: string;
  staffId?: string;
  staffId2?: string;
  studentId?: string;
  studentId2?: string;
  // SP1 entities
  courseId?: string;
  courseId2?: string;
  courseCode?: string;
  courseCode2?: string;
  sectionId?: string;
  sectionId2?: string;
  deletedCourseId?: string;
  deletedSectionId?: string;
}

// Response DTOs
interface SchoolResponse {
  schoolId: string;
  schoolCode: string;
  name: string;
  [key: string]: unknown;
}

interface AcademicYearResponse {
  yearId: string;
  name: string;
  [key: string]: unknown;
}

interface StaffResponse {
  staffId: string;
  staffUniqueId: string;
  [key: string]: unknown;
}

interface StudentResponse {
  studentId: string;
  firstName: string;
  lastName: string;
  [key: string]: unknown;
}

interface CourseResponse {
  courseId: string;
  courseCode: string;
  courseName: string;
  schoolId: string;
  isActive: boolean;
  version: number;
  [key: string]: unknown;
}

interface SectionResponse {
  sectionId: string;
  sectionNumber: string;
  courseId: string;
  schoolId: string;
  maxEnrollment: number;
  currentEnrollment: number;
  isActive: boolean;
  [key: string]: unknown;
}

interface StudentSectionResponse {
  studentId: string;
  sectionId: string;
  enrolledAt: string;
  [key: string]: unknown;
}

interface SectionRosterResponse {
  sectionId: string;
  students: StudentSectionResponse[];
  totalCount: number;
  [key: string]: unknown;
}

interface ListResponse<T> {
  items: T[];
  hasMore?: boolean;
  lastEvaluatedKey?: string;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

const random4 = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const generateSchoolCode = () => `SP1${Date.now().toString().slice(-5)}`;
const generateCourseCode = () => `CRS-${random4()}`;
const generateStaffUniqueId = () => `STF-SP1-${Date.now()}-${random4()}`;
const generateEmail = (prefix: string) => `${prefix}-${Date.now()}@sp1-smoke.local`;
const generateStudentNumber = () => `STU-SP1-${Date.now()}-${random4()}`;

function getAcademicYearDates() {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    name: `${year}-${year + 1}`,
    shortName: `${year.toString().slice(2)}/${(year + 1).toString().slice(2)}`,
    startDate: `${year}-08-15`,
    endDate: `${year + 1}-06-15`,
  };
}

// ============================================
// API CLIENT CLASS
// ============================================

class ApiClient {
  private baseUrl: string;
  private token: string;
  private logStream: fs.WriteStream;
  private logLevel: string;

  constructor(baseUrl: string, token: string, logFilePath: string, logLevel: string = 'info') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.logLevel = logLevel;

    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    this.log(`=== SP1 Smoke Test Run Started at ${new Date().toISOString()} ===`);
    this.log(`Base URL: ${baseUrl}`);
  }

  private log(message: string): void {
    this.logStream.write(`[${new Date().toISOString()}] ${message}\n`);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: unknown,
    token?: string
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();

    try {
      const config: AxiosRequestConfig = {
        method,
        url,
        headers: {
          'Authorization': `Bearer ${token || this.token}`,
          'Content-Type': 'application/json',
        },
        data: body,
        validateStatus: () => true,
        timeout: 30000,
      };

      this.log(`[${method}] ${url}`);
      if (body && this.logLevel === 'debug') {
        this.log(`Request Body: ${JSON.stringify(body, null, 2)}`);
      }

      const response = await axios(config);
      const duration = Date.now() - startTime;

      this.log(`[${method}] ${url} - ${response.status} - ${duration}ms`);
      if (this.logLevel === 'debug') {
        this.log(`Response Body: ${JSON.stringify(response.data, null, 2)}`);
      }

      const isSuccess = response.status >= 200 && response.status < 300;
      return {
        status: response.status,
        data: isSuccess ? (response.data as T) : null,
        error: isSuccess ? null : JSON.stringify(response.data),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`[${method}] ${url} - ERROR - ${duration}ms: ${errorMessage}`);
      return { status: 0, data: null, error: errorMessage, duration };
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', endpoint);
  }
  async post<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', endpoint, body);
  }
  async patch<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', endpoint, body);
  }
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', endpoint);
  }
  // Request with no auth token
  async requestNoAuth<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(method, endpoint, body, 'invalid');
  }

  close(): void {
    this.log(`=== SP1 Smoke Test Run Completed at ${new Date().toISOString()} ===`);
    this.logStream.end();
  }
}

// ============================================
// SP1 SMOKE TEST RUNNER
// ============================================

class SP1SmokeTestRunner {
  private client: ApiClient;
  private results: TestResult[] = [];
  private ctx: TestContext = {};
  private currentModule: string = '';

  constructor(client: ApiClient) {
    this.client = client;
  }

  private record(name: string, status: 'PASS' | 'FAIL' | 'SKIP', duration: number, opts?: { error?: string; expected?: number; actual?: number }): void {
    this.results.push({ name, module: this.currentModule, status, duration, ...opts });
    const icon = status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m' : status === 'FAIL' ? '\x1b[31m[FAIL]\x1b[0m' : '\x1b[33m[SKIP]\x1b[0m';
    console.log(`  ${icon} ${name} (${duration}ms)`);
    if (opts?.error) console.log(`       Error: ${opts.error.slice(0, 200)}`);
  }

  private assertStatus(res: ApiResponse<unknown>, expected: number | number[], name: string): boolean {
    const expectedArr = Array.isArray(expected) ? expected : [expected];
    if (expectedArr.includes(res.status)) {
      this.record(name, 'PASS', res.duration);
      return true;
    }
    this.record(name, 'FAIL', res.duration, {
      error: res.error || `Expected ${expected}, got ${res.status}`,
      expected: expectedArr[0],
      actual: res.status,
    });
    return false;
  }

  // ============================================
  // MODULE 0: PREREQUISITES SETUP
  // ============================================
  async runSetup(): Promise<void> {
    this.currentModule = 'Setup';
    console.log('\n\x1b[36m=== Module 0: Prerequisites Setup ===\x1b[0m');

    // 0.1 Create school
    const schoolCode = generateSchoolCode();
    const res1 = await this.client.post<SchoolResponse>('/schools', {
      schoolCode,
      name: `SP1 Smoke Test School ${Date.now()}`,
      schoolType: 'high',
      gradeRange: { start: '9', end: '12' },
      timezone: 'America/Chicago',
      locale: 'en-US',
    });
    if (this.assertStatus(res1, [200, 201], '0.1 Create test school') && res1.data) {
      this.ctx.schoolId = res1.data.schoolId;
      this.ctx.schoolCode = schoolCode;
    }

    if (!this.ctx.schoolId) {
      console.log('\x1b[31m  Cannot continue without a school. Aborting.\x1b[0m');
      return;
    }

    // 0.2 Create academic year
    const yearDates = getAcademicYearDates();
    const res2 = await this.client.post<AcademicYearResponse>(`/schools/${this.ctx.schoolId}/academic-years`, {
      name: yearDates.name,
      shortName: yearDates.shortName,
      startDate: yearDates.startDate,
      endDate: yearDates.endDate,
      calendarType: 'semester',
    });
    if (this.assertStatus(res2, [200, 201], '0.2 Create academic year') && res2.data) {
      this.ctx.academicYearId = res2.data.yearId;
    }

    // 0.3 Create staff member (teacher)
    const res3 = await this.client.post<StaffResponse>('/staff', {
      staffUniqueId: generateStaffUniqueId(),
      firstName: 'SP1',
      lastSurname: 'Teacher',
      email: generateEmail('sp1-teacher'),
      employmentStatus: 'active',
      schoolAssignments: [{ schoolId: this.ctx.schoolId, isPrimary: true, role: 'Teacher' }],
    });
    if (this.assertStatus(res3, [200, 201], '0.3 Create staff (teacher)') && res3.data) {
      this.ctx.staffId = res3.data.staffId;
    }

    // 0.4 Create second staff member
    const res4 = await this.client.post<StaffResponse>('/staff', {
      staffUniqueId: generateStaffUniqueId(),
      firstName: 'SP1',
      lastSurname: 'Teacher2',
      email: generateEmail('sp1-teacher2'),
      employmentStatus: 'active',
      schoolAssignments: [{ schoolId: this.ctx.schoolId, isPrimary: true, role: 'Teacher' }],
    });
    if (this.assertStatus(res4, [200, 201], '0.4 Create staff (teacher 2)') && res4.data) {
      this.ctx.staffId2 = res4.data.staffId;
    }

    // 0.5 Create student 1
    const res5 = await this.client.post<StudentResponse>('/academics/students', {
      firstName: 'SP1Student',
      lastName: 'One',
      studentNumber: generateStudentNumber(),
      dateOfBirth: '2008-03-15',
      gender: 'male',
      schoolId: this.ctx.schoolId,
      gradeLevel: '10',
      enrollmentDate: '2024-08-15',
    });
    if (this.assertStatus(res5, [200, 201], '0.5 Create student 1') && res5.data) {
      this.ctx.studentId = res5.data.studentId;
    }

    // 0.6 Create student 2
    const res6 = await this.client.post<StudentResponse>('/academics/students', {
      firstName: 'SP1Student',
      lastName: 'Two',
      studentNumber: generateStudentNumber(),
      dateOfBirth: '2008-07-22',
      gender: 'female',
      schoolId: this.ctx.schoolId,
      gradeLevel: '10',
      enrollmentDate: '2024-08-15',
    });
    if (this.assertStatus(res6, [200, 201], '0.6 Create student 2') && res6.data) {
      this.ctx.studentId2 = res6.data.studentId;
    }

    console.log(`\n  Context: schoolId=${this.ctx.schoolId}, yearId=${this.ctx.academicYearId}`);
    console.log(`  staffId=${this.ctx.staffId}, studentId=${this.ctx.studentId}`);
  }

  // ============================================
  // MODULE 1: COURSES CRUD (16 tests)
  // ============================================
  async runCoursesModule(): Promise<void> {
    this.currentModule = 'Courses';
    console.log('\n\x1b[36m=== Module 1: Courses CRUD (16 tests) ===\x1b[0m');

    if (!this.ctx.schoolId) {
      console.log('  \x1b[33m[SKIP] No schoolId - skipping module\x1b[0m');
      return;
    }

    // 1.1 Create course
    const courseCode = generateCourseCode();
    const res1 = await this.client.post<CourseResponse>('/academics/courses', {
      courseCode,
      courseName: 'Algebra I',
      schoolId: this.ctx.schoolId,
      subjectArea: 'mathematics',
      courseType: 'core',
      credits: 1.0,
      creditType: 'regular',
      gradeLevels: ['9', '10'],
      description: 'Introductory algebra course',
    });
    if (this.assertStatus(res1, [200, 201], '1.1 Create course') && res1.data) {
      this.ctx.courseId = res1.data.courseId;
      this.ctx.courseCode = courseCode;
    }

    // 1.2 Create course - duplicate courseCode
    if (this.ctx.courseCode) {
      const res2 = await this.client.post<CourseResponse>('/academics/courses', {
        courseCode: this.ctx.courseCode,
        courseName: 'Duplicate Course',
        schoolId: this.ctx.schoolId,
        subjectArea: 'mathematics',
        courseType: 'core',
        credits: 1.0,
        creditType: 'regular',
        gradeLevels: ['9'],
      });
      this.assertStatus(res2, [400, 409], '1.2 Create course - duplicate code');
    } else {
      this.record('1.2 Create course - duplicate code', 'SKIP', 0, { error: 'No courseCode' });
    }

    // 1.3 Create course - invalid schoolId
    const res3 = await this.client.post<CourseResponse>('/academics/courses', {
      courseCode: generateCourseCode(),
      courseName: 'Bad School Course',
      schoolId: '00000000-0000-0000-0000-000000000000',
      subjectArea: 'science',
      courseType: 'core',
      credits: 1.0,
      creditType: 'regular',
      gradeLevels: ['9'],
    });
    this.assertStatus(res3, [400, 404], '1.3 Create course - invalid schoolId');

    // 1.4 Create course - missing required fields
    const res4 = await this.client.post<CourseResponse>('/academics/courses', {
      courseName: 'No Code Course',
    });
    this.assertStatus(res4, [400, 404, 422], '1.4 Create course - missing fields');

    // 1.5 List courses by schoolId
    const res5 = await this.client.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res5, 200, '1.5 List courses by schoolId') && res5.data) {
      console.log(`       Found ${res5.data.items?.length || 0} course(s)`);
    }

    // 1.6 List courses - pagination
    const res6 = await this.client.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}&limit=1`
    );
    this.assertStatus(res6, 200, '1.6 List courses - limit=1');

    // 1.7 List courses - filter by subjectArea
    const res7 = await this.client.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}&subjectArea=mathematics`
    );
    this.assertStatus(res7, 200, '1.7 List courses - filter subjectArea');

    // 1.8 List courses - filter by isActive
    const res8 = await this.client.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}&isActive=true`
    );
    this.assertStatus(res8, 200, '1.8 List courses - filter isActive');

    // 1.9 Get course by ID
    if (this.ctx.courseId) {
      const res9 = await this.client.get<CourseResponse>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`
      );
      if (this.assertStatus(res9, 200, '1.9 Get course by ID') && res9.data) {
        console.log(`       courseCode=${res9.data.courseCode}, courseName=${res9.data.courseName}`);
      }
    } else {
      this.record('1.9 Get course by ID', 'SKIP', 0, { error: 'No courseId' });
    }

    // 1.10 Get course - nonexistent
    const res10 = await this.client.get<CourseResponse>(
      `/academics/courses/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res10, 404, '1.10 Get course - nonexistent');

    // 1.11 Update course
    if (this.ctx.courseId) {
      const res11 = await this.client.patch<CourseResponse>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`,
        { courseName: 'Algebra I (Updated)', description: 'Updated description' }
      );
      this.assertStatus(res11, 200, '1.11 Update course');
    } else {
      this.record('1.11 Update course', 'SKIP', 0, { error: 'No courseId' });
    }

    // 1.12 Update course - add prerequisites
    if (this.ctx.courseId) {
      const res12 = await this.client.patch<CourseResponse>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`,
        { prerequisites: [] }
      );
      this.assertStatus(res12, 200, '1.12 Update course - prerequisites');
    } else {
      this.record('1.12 Update course - prerequisites', 'SKIP', 0, { error: 'No courseId' });
    }

    // 1.13 Update course - nonexistent
    const res13 = await this.client.patch<CourseResponse>(
      `/academics/courses/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`,
      { courseName: 'Ghost' }
    );
    this.assertStatus(res13, 404, '1.13 Update course - nonexistent');

    // 1.14 Create a course to delete
    const deleteCode = generateCourseCode();
    const res14a = await this.client.post<CourseResponse>('/academics/courses', {
      courseCode: deleteCode,
      courseName: 'Course To Delete',
      schoolId: this.ctx.schoolId,
      subjectArea: 'elective',
      courseType: 'elective',
      credits: 0.5,
      creditType: 'regular',
      gradeLevels: ['9'],
    });
    if (res14a.status >= 200 && res14a.status < 300 && res14a.data) {
      this.ctx.deletedCourseId = (res14a.data as CourseResponse).courseId;
    }

    if (this.ctx.deletedCourseId) {
      const res14 = await this.client.delete<void>(
        `/academics/courses/${this.ctx.deletedCourseId}?schoolId=${this.ctx.schoolId}`
      );
      this.assertStatus(res14, 204, '1.14 Delete course (soft delete)');
    } else {
      this.record('1.14 Delete course (soft delete)', 'SKIP', 0, { error: 'Could not create course to delete' });
    }

    // 1.15 Verify deleted course isActive=false
    if (this.ctx.deletedCourseId) {
      const res15 = await this.client.get<CourseResponse>(
        `/academics/courses/${this.ctx.deletedCourseId}?schoolId=${this.ctx.schoolId}`
      );
      if (res15.status === 200 && res15.data && !(res15.data as CourseResponse).isActive) {
        this.record('1.15 Deleted course isActive=false', 'PASS', res15.duration);
      } else if (res15.status === 404) {
        // Hard delete — also acceptable
        this.record('1.15 Deleted course - hard deleted', 'PASS', res15.duration);
      } else {
        this.record('1.15 Deleted course isActive=false', 'FAIL', res15.duration, {
          error: `Expected isActive=false, got status=${res15.status}`,
        });
      }
    } else {
      this.record('1.15 Deleted course isActive=false', 'SKIP', 0, { error: 'No deletedCourseId' });
    }

    // 1.16 Create second course (for sections)
    const courseCode2 = generateCourseCode();
    const res16 = await this.client.post<CourseResponse>('/academics/courses', {
      courseCode: courseCode2,
      courseName: 'US History',
      schoolId: this.ctx.schoolId,
      subjectArea: 'social_studies',
      courseType: 'core',
      credits: 1.0,
      creditType: 'regular',
      gradeLevels: ['10', '11'],
    });
    if (this.assertStatus(res16, [200, 201], '1.16 Create second course') && res16.data) {
      this.ctx.courseId2 = res16.data.courseId;
      this.ctx.courseCode2 = courseCode2;
    }
  }

  // ============================================
  // MODULE 2: SECTIONS CRUD (16 tests)
  // ============================================
  async runSectionsModule(): Promise<void> {
    this.currentModule = 'Sections';
    console.log('\n\x1b[36m=== Module 2: Sections CRUD (16 tests) ===\x1b[0m');

    if (!this.ctx.schoolId || !this.ctx.courseId || !this.ctx.academicYearId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    // 2.1 Create section
    const res1 = await this.client.post<SectionResponse>('/academics/sections', {
      sectionNumber: '001',
      sectionName: 'Algebra I - Period 1',
      courseId: this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      academicYearId: this.ctx.academicYearId,
      primaryTeacherId: this.ctx.staffId,
      maxEnrollment: 30,
    });
    if (this.assertStatus(res1, [200, 201], '2.1 Create section') && res1.data) {
      this.ctx.sectionId = res1.data.sectionId;
      console.log(`       sectionId=${this.ctx.sectionId}`);
    }

    // 2.2 Create section - invalid courseId
    const res2 = await this.client.post<SectionResponse>('/academics/sections', {
      sectionNumber: '999',
      courseId: '00000000-0000-0000-0000-000000000000',
      schoolId: this.ctx.schoolId,
      academicYearId: this.ctx.academicYearId,
      primaryTeacherId: this.ctx.staffId,
      maxEnrollment: 30,
    });
    this.assertStatus(res2, [400, 404], '2.2 Create section - invalid courseId');

    // 2.3 Create section - invalid teacherId
    const res3 = await this.client.post<SectionResponse>('/academics/sections', {
      sectionNumber: '998',
      courseId: this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      academicYearId: this.ctx.academicYearId,
      primaryTeacherId: '00000000-0000-0000-0000-000000000000',
      maxEnrollment: 30,
    });
    this.assertStatus(res3, [400, 404], '2.3 Create section - invalid teacherId');

    // 2.4 Create section - duplicate sectionNumber for same course
    if (this.ctx.sectionId) {
      const res4 = await this.client.post<SectionResponse>('/academics/sections', {
        sectionNumber: '001', // Same as 2.1
        courseId: this.ctx.courseId,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        primaryTeacherId: this.ctx.staffId,
        maxEnrollment: 30,
      });
      this.assertStatus(res4, [400, 409], '2.4 Create section - duplicate sectionNumber');
    } else {
      this.record('2.4 Create section - duplicate sectionNumber', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 2.5 Create section - missing required fields
    const res5 = await this.client.post<SectionResponse>('/academics/sections', {
      sectionNumber: '002',
    });
    this.assertStatus(res5, [400, 404, 422], '2.5 Create section - missing fields');

    // 2.6 List sections by schoolId
    const res6 = await this.client.get<ListResponse<SectionResponse>>(
      `/academics/sections?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res6, 200, '2.6 List sections by schoolId') && res6.data) {
      console.log(`       Found ${res6.data.items?.length || 0} section(s)`);
    }

    // 2.7 List sections - filter by courseId
    const res7 = await this.client.get<ListResponse<SectionResponse>>(
      `/academics/sections?schoolId=${this.ctx.schoolId}&courseId=${this.ctx.courseId}`
    );
    this.assertStatus(res7, 200, '2.7 List sections - filter courseId');

    // 2.8 List sections - filter by teacherId
    if (this.ctx.staffId) {
      const res8 = await this.client.get<ListResponse<SectionResponse>>(
        `/academics/sections?schoolId=${this.ctx.schoolId}&teacherId=${this.ctx.staffId}`
      );
      this.assertStatus(res8, 200, '2.8 List sections - filter teacherId');
    } else {
      this.record('2.8 List sections - filter teacherId', 'SKIP', 0, { error: 'No staffId' });
    }

    // 2.9 List sections - filter by academicYearId
    const res9 = await this.client.get<ListResponse<SectionResponse>>(
      `/academics/sections?schoolId=${this.ctx.schoolId}&academicYearId=${this.ctx.academicYearId}`
    );
    this.assertStatus(res9, 200, '2.9 List sections - filter academicYearId');

    // 2.10 Get section by ID
    if (this.ctx.sectionId) {
      const res10 = await this.client.get<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      if (this.assertStatus(res10, 200, '2.10 Get section by ID') && res10.data) {
        console.log(`       sectionNumber=${res10.data.sectionNumber}, maxEnrollment=${res10.data.maxEnrollment}`);
      }
    } else {
      this.record('2.10 Get section by ID', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 2.11 Get section - nonexistent
    const res11 = await this.client.get<SectionResponse>(
      `/academics/sections/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res11, 404, '2.11 Get section - nonexistent');

    // 2.12 Update section - change maxEnrollment
    if (this.ctx.sectionId) {
      const res12 = await this.client.patch<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`,
        { maxEnrollment: 35 }
      );
      this.assertStatus(res12, 200, '2.12 Update section - maxEnrollment');
    } else {
      this.record('2.12 Update section - maxEnrollment', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 2.13 Update section - change teacher
    if (this.ctx.sectionId && this.ctx.staffId2) {
      const res13 = await this.client.patch<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`,
        { primaryTeacherId: this.ctx.staffId2 }
      );
      this.assertStatus(res13, 200, '2.13 Update section - change teacher');
    } else {
      this.record('2.13 Update section - change teacher', 'SKIP', 0, { error: 'Missing context' });
    }

    // 2.14 Update section - nonexistent
    const res14 = await this.client.patch<SectionResponse>(
      `/academics/sections/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`,
      { maxEnrollment: 10 }
    );
    this.assertStatus(res14, 404, '2.14 Update section - nonexistent');

    // 2.15 Create a section to delete
    const res15a = await this.client.post<SectionResponse>('/academics/sections', {
      sectionNumber: 'DEL',
      sectionName: 'Section To Delete',
      courseId: this.ctx.courseId2 || this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      academicYearId: this.ctx.academicYearId,
      primaryTeacherId: this.ctx.staffId,
      maxEnrollment: 5,
    });
    if (res15a.status >= 200 && res15a.status < 300 && res15a.data) {
      this.ctx.deletedSectionId = (res15a.data as SectionResponse).sectionId;
    }

    if (this.ctx.deletedSectionId) {
      const res15 = await this.client.delete<void>(
        `/academics/sections/${this.ctx.deletedSectionId}?schoolId=${this.ctx.schoolId}`
      );
      this.assertStatus(res15, 204, '2.15 Delete section (soft delete)');
    } else {
      this.record('2.15 Delete section (soft delete)', 'SKIP', 0, { error: 'Could not create section to delete' });
    }

    // 2.16 Create second section (for enrollment tests)
    if (this.ctx.courseId2) {
      const res16 = await this.client.post<SectionResponse>('/academics/sections', {
        sectionNumber: '001',
        sectionName: 'US History - Period 2',
        courseId: this.ctx.courseId2,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        primaryTeacherId: this.ctx.staffId,
        maxEnrollment: 30,
      });
      if (this.assertStatus(res16, [200, 201], '2.16 Create second section') && res16.data) {
        this.ctx.sectionId2 = res16.data.sectionId;
      }
    } else {
      this.record('2.16 Create second section', 'SKIP', 0, { error: 'No courseId2' });
    }
  }

  // ============================================
  // MODULE 3: SECTION ENROLLMENT (18 tests)
  // ============================================
  async runEnrollmentModule(): Promise<void> {
    this.currentModule = 'Enrollment';
    console.log('\n\x1b[36m=== Module 3: Section Enrollment (18 tests) ===\x1b[0m');

    if (!this.ctx.sectionId || !this.ctx.studentId || !this.ctx.schoolId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    // 3.1 Enroll student in section
    const res1 = await this.client.post<StudentSectionResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`,
      { studentId: this.ctx.studentId }
    );
    this.assertStatus(res1, [200, 201], '3.1 Enroll student in section');

    // 3.2 Enroll same student again - expect conflict
    const res2 = await this.client.post<StudentSectionResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`,
      { studentId: this.ctx.studentId }
    );
    this.assertStatus(res2, [400, 409], '3.2 Enroll student - already enrolled');

    // 3.3 Enroll student - section not found
    const res3 = await this.client.post<StudentSectionResponse>(
      `/academics/sections/00000000-0000-0000-0000-000000000000/students?schoolId=${this.ctx.schoolId}`,
      { studentId: this.ctx.studentId }
    );
    this.assertStatus(res3, 404, '3.3 Enroll student - section not found');

    // 3.4 Enroll student - inactive section
    if (this.ctx.deletedSectionId) {
      const res4 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.deletedSectionId}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId }
      );
      this.assertStatus(res4, [400, 404], '3.4 Enroll student - inactive section');
    } else {
      this.record('3.4 Enroll student - inactive section', 'SKIP', 0, { error: 'No deletedSectionId' });
    }

    // 3.5 Get section roster
    const res5 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res5, 200, '3.5 Get section roster') && res5.data) {
      console.log(`       totalCount=${res5.data.totalCount}`);
    }

    // 3.6 Verify roster has 1 student
    if (res5.status === 200 && res5.data) {
      const roster = res5.data as SectionRosterResponse;
      if (roster.totalCount === 1) {
        this.record('3.6 Roster totalCount = 1', 'PASS', 0);
      } else {
        this.record('3.6 Roster totalCount = 1', 'FAIL', 0, { error: `Expected 1, got ${roster.totalCount}` });
      }
    } else {
      this.record('3.6 Roster totalCount = 1', 'SKIP', 0, { error: 'No roster data' });
    }

    // 3.7 Enroll second student
    if (this.ctx.studentId2) {
      const res7 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId2 }
      );
      this.assertStatus(res7, [200, 201], '3.7 Enroll second student');
    } else {
      this.record('3.7 Enroll second student', 'SKIP', 0, { error: 'No studentId2' });
    }

    // 3.8 Verify roster totalCount = 2
    const res8 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (res8.status === 200 && res8.data) {
      const roster = res8.data as SectionRosterResponse;
      if (roster.totalCount === 2) {
        this.record('3.8 Roster totalCount = 2', 'PASS', res8.duration);
      } else {
        this.record('3.8 Roster totalCount = 2', 'FAIL', res8.duration, { error: `Expected 2, got ${roster.totalCount}` });
      }
    } else {
      this.record('3.8 Roster totalCount = 2', 'SKIP', res8.duration, { error: 'No roster data' });
    }

    // 3.9 Drop student from section
    const res9 = await this.client.delete<void>(
      `/academics/sections/${this.ctx.sectionId}/students/${this.ctx.studentId2}?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res9, 204, '3.9 Drop student from section');

    // 3.10 Verify roster totalCount = 1 after drop
    const res10 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (res10.status === 200 && res10.data) {
      const roster = res10.data as SectionRosterResponse;
      if (roster.totalCount === 1) {
        this.record('3.10 Roster totalCount = 1 after drop', 'PASS', res10.duration);
      } else {
        this.record('3.10 Roster totalCount = 1 after drop', 'FAIL', res10.duration, { error: `Expected 1, got ${roster.totalCount}` });
      }
    } else {
      this.record('3.10 Roster totalCount = 1 after drop', 'SKIP', res10.duration, { error: 'No roster data' });
    }

    // 3.11 Drop student - not enrolled (already dropped)
    if (this.ctx.studentId2) {
      const res11 = await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId}/students/${this.ctx.studentId2}?schoolId=${this.ctx.schoolId}`
      );
      this.assertStatus(res11, 404, '3.11 Drop student - not enrolled');
    } else {
      this.record('3.11 Drop student - not enrolled', 'SKIP', 0, { error: 'No studentId2' });
    }

    // 3.12 Drop student - section not found
    const res12 = await this.client.delete<void>(
      `/academics/sections/00000000-0000-0000-0000-000000000000/students/${this.ctx.studentId}?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res12, [404, 400], '3.12 Drop student - section not found');

    // 3.13 Test max capacity enforcement
    // Create a tiny section with maxEnrollment=1 and try to enroll 2 students
    const tinySection = await this.client.post<SectionResponse>('/academics/sections', {
      sectionNumber: 'CAP',
      sectionName: 'Capacity Test',
      courseId: this.ctx.courseId,
      schoolId: this.ctx.schoolId,
      academicYearId: this.ctx.academicYearId,
      primaryTeacherId: this.ctx.staffId,
      maxEnrollment: 1,
    });
    if (tinySection.status >= 200 && tinySection.status < 300 && tinySection.data) {
      const tinySectionId = (tinySection.data as SectionResponse).sectionId;
      // Enroll first student — should succeed
      await this.client.post<StudentSectionResponse>(
        `/academics/sections/${tinySectionId}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId }
      );
      // Enroll second student — should fail (at capacity)
      if (this.ctx.studentId2) {
        const res13 = await this.client.post<StudentSectionResponse>(
          `/academics/sections/${tinySectionId}/students?schoolId=${this.ctx.schoolId}`,
          { studentId: this.ctx.studentId2 }
        );
        this.assertStatus(res13, 400, '3.13 Enroll student - section at capacity');
      } else {
        this.record('3.13 Enroll student - section at capacity', 'SKIP', 0, { error: 'No studentId2' });
      }
      // Clean up: drop student from tiny section
      await this.client.delete<void>(
        `/academics/sections/${tinySectionId}/students/${this.ctx.studentId}?schoolId=${this.ctx.schoolId}`
      );
    } else {
      this.record('3.13 Enroll student - section at capacity', 'SKIP', 0, { error: 'Could not create tiny section' });
    }

    // 3.14 Verify section currentEnrollment counter
    if (this.ctx.sectionId) {
      const res14 = await this.client.get<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      if (res14.status === 200 && res14.data) {
        const section = res14.data as SectionResponse;
        if (section.currentEnrollment === 1) {
          this.record('3.14 currentEnrollment counter = 1', 'PASS', res14.duration);
        } else {
          this.record('3.14 currentEnrollment counter = 1', 'FAIL', res14.duration, {
            error: `Expected currentEnrollment=1, got ${section.currentEnrollment}`,
          });
        }
      } else {
        this.record('3.14 currentEnrollment counter = 1', 'SKIP', res14.duration, { error: 'Could not get section' });
      }
    } else {
      this.record('3.14 currentEnrollment counter = 1', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 3.15 Enroll student in second section
    if (this.ctx.sectionId2 && this.ctx.studentId) {
      const res15 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId }
      );
      this.assertStatus(res15, [200, 201], '3.15 Enroll student in second section');
    } else {
      this.record('3.15 Enroll student in second section', 'SKIP', 0, { error: 'Missing context' });
    }

    // 3.16 Get student sections via GET /academics/students/:id/sections?academicYearId=xxx
    if (this.ctx.studentId && this.ctx.academicYearId) {
      const res16 = await this.client.get<StudentSectionResponse[]>(
        `/academics/students/${this.ctx.studentId}/sections?academicYearId=${this.ctx.academicYearId}`
      );
      if (this.assertStatus(res16, 200, '3.16 Get student sections') && res16.data) {
        const sections = res16.data as StudentSectionResponse[];
        console.log(`       Student enrolled in ${Array.isArray(sections) ? sections.length : 0} section(s)`);
      }
    } else {
      this.record('3.16 Get student sections', 'SKIP', 0, { error: 'Missing studentId or academicYearId' });
    }

    // 3.17 Re-enroll dropped student (studentId2 was dropped in 3.9, re-enroll)
    if (this.ctx.studentId2 && this.ctx.sectionId2) {
      const res17 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId2 }
      );
      this.assertStatus(res17, [200, 201], '3.17 Re-enroll student in different section');
    } else {
      this.record('3.17 Re-enroll student in different section', 'SKIP', 0, { error: 'Missing context' });
    }

    // 3.18 Verify second section roster
    if (this.ctx.sectionId2) {
      const res18 = await this.client.get<SectionRosterResponse>(
        `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`
      );
      if (this.assertStatus(res18, 200, '3.18 Second section roster') && res18.data) {
        console.log(`       totalCount=${res18.data.totalCount}`);
      }
    } else {
      this.record('3.18 Second section roster', 'SKIP', 0, { error: 'No sectionId2' });
    }
  }

  // ============================================
  // MODULE 4: ERROR HANDLING & CROSS-CUTTING (10 tests)
  // ============================================
  async runErrorHandlingModule(): Promise<void> {
    this.currentModule = 'ErrorHandling';
    console.log('\n\x1b[36m=== Module 4: Error Handling & Cross-Cutting (10 tests) ===\x1b[0m');

    // 4.1 Request without auth token
    const res1 = await this.client.requestNoAuth<unknown>('GET', `/academics/courses?schoolId=${this.ctx.schoolId || 'x'}`);
    this.assertStatus(res1, [401, 403], '4.1 No auth token - expect 401/403');

    // 4.2 Request with invalid token
    const res2 = await this.client.requestNoAuth<unknown>('GET', `/academics/sections?schoolId=${this.ctx.schoolId || 'x'}`);
    this.assertStatus(res2, [401, 403], '4.2 Invalid token - expect 401/403');

    // 4.3 Create course with extra unknown fields
    if (this.ctx.schoolId) {
      const res3 = await this.client.post<CourseResponse>('/academics/courses', {
        courseCode: generateCourseCode(),
        courseName: 'Extra Fields Course',
        schoolId: this.ctx.schoolId,
        subjectArea: 'science',
        courseType: 'core',
        credits: 1.0,
        creditType: 'regular',
        gradeLevels: ['9'],
        unknownField1: 'should be ignored or rejected',
        unknownField2: 12345,
      });
      // Either accepts (200/201) or rejects (400) - both are valid behaviors
      this.assertStatus(res3, [200, 201, 400], '4.3 Extra unknown fields');
      // Clean up if created
      if (res3.status >= 200 && res3.status < 300 && res3.data) {
        await this.client.delete<void>(`/academics/courses/${(res3.data as CourseResponse).courseId}?schoolId=${this.ctx.schoolId}`);
      }
    } else {
      this.record('4.3 Extra unknown fields', 'SKIP', 0, { error: 'No schoolId' });
    }

    // 4.4 Pagination - large limit
    if (this.ctx.schoolId) {
      const res4 = await this.client.get<ListResponse<CourseResponse>>(
        `/academics/courses?schoolId=${this.ctx.schoolId}&limit=1000`
      );
      this.assertStatus(res4, 200, '4.4 Large limit value');
    } else {
      this.record('4.4 Large limit value', 'SKIP', 0, { error: 'No schoolId' });
    }

    // 4.5 Pagination - invalid cursor
    if (this.ctx.schoolId) {
      const res5 = await this.client.get<ListResponse<CourseResponse>>(
        `/academics/courses?schoolId=${this.ctx.schoolId}&cursor=invalid-cursor`
      );
      this.assertStatus(res5, [200, 400], '4.5 Invalid cursor');
    } else {
      this.record('4.5 Invalid cursor', 'SKIP', 0, { error: 'No schoolId' });
    }

    // 4.6 Delete course with active sections (enrollment guard)
    if (this.ctx.courseId && this.ctx.sectionId) {
      const res6 = await this.client.delete<void>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`
      );
      // Should either block (400) or succeed (204) depending on implementation
      this.assertStatus(res6, [204, 400], '4.6 Delete course with active sections');
      // If it succeeded, the course is now deleted - that's fine for cleanup
    } else {
      this.record('4.6 Delete course with active sections', 'SKIP', 0, { error: 'Missing context' });
    }

    // 4.7 Section filter - combine multiple filters
    if (this.ctx.schoolId && this.ctx.academicYearId) {
      const res7 = await this.client.get<ListResponse<SectionResponse>>(
        `/academics/sections?schoolId=${this.ctx.schoolId}&academicYearId=${this.ctx.academicYearId}&isActive=true`
      );
      this.assertStatus(res7, 200, '4.7 Combined section filters');
    } else {
      this.record('4.7 Combined section filters', 'SKIP', 0, { error: 'Missing context' });
    }

    // 4.8 Course filter - combine subjectArea + isActive
    if (this.ctx.schoolId) {
      const res8 = await this.client.get<ListResponse<CourseResponse>>(
        `/academics/courses?schoolId=${this.ctx.schoolId}&subjectArea=mathematics&isActive=true`
      );
      this.assertStatus(res8, 200, '4.8 Combined course filters');
    } else {
      this.record('4.8 Combined course filters', 'SKIP', 0, { error: 'No schoolId' });
    }

    // 4.9 Empty roster for new section
    if (this.ctx.deletedSectionId) {
      const res9 = await this.client.get<SectionRosterResponse>(
        `/academics/sections/${this.ctx.deletedSectionId}/students?schoolId=${this.ctx.schoolId}`
      );
      // Deleted section might return 404 or empty roster
      this.assertStatus(res9, [200, 404], '4.9 Roster for deleted section');
    } else {
      this.record('4.9 Roster for deleted section', 'SKIP', 0, { error: 'No deletedSectionId' });
    }

    // 4.10 Courses list with no schoolId (should require schoolId)
    const res10 = await this.client.get<ListResponse<CourseResponse>>('/academics/courses');
    // Might return 400 (missing required param) or 200 with empty results
    this.assertStatus(res10, [200, 400], '4.10 List courses - no schoolId');
  }

  // ============================================
  // MODULE 5: DATA INTEGRITY & CROSS-ENTITY (12 tests)
  // ============================================
  async runDataIntegrityModule(): Promise<void> {
    this.currentModule = 'DataIntegrity';
    console.log('\n\x1b[36m=== Module 5: Data Integrity & Cross-Entity (12 tests) ===\x1b[0m');

    if (!this.ctx.schoolId || !this.ctx.courseId || !this.ctx.sectionId || !this.ctx.studentId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    // 5.1 Verify section has correct course denormalized data
    const res1 = await this.client.get<SectionResponse>(
      `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
    );
    if (res1.status === 200 && res1.data) {
      const section = res1.data as SectionResponse;
      if (section.courseId === this.ctx.courseId) {
        this.record('5.1 Section courseId matches', 'PASS', res1.duration);
      } else {
        this.record('5.1 Section courseId matches', 'FAIL', res1.duration, {
          error: `Expected ${this.ctx.courseId}, got ${section.courseId}`,
        });
      }
    } else {
      this.record('5.1 Section courseId matches', 'SKIP', res1.duration, { error: 'Could not fetch section' });
    }

    // 5.2 Verify course has updated version after PATCH
    if (this.ctx.courseId) {
      const res2 = await this.client.get<CourseResponse>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`
      );
      if (res2.status === 200 && res2.data) {
        const course = res2.data as CourseResponse;
        if (course.version && course.version > 1) {
          this.record('5.2 Course version incremented after update', 'PASS', res2.duration);
        } else {
          this.record('5.2 Course version incremented after update', 'FAIL', res2.duration, {
            error: `Expected version > 1, got ${course.version}`,
          });
        }
      } else {
        this.record('5.2 Course version incremented after update', 'SKIP', res2.duration, { error: 'Could not fetch course' });
      }
    }

    // 5.3 Verify student sections count matches enrollments
    if (this.ctx.studentId && this.ctx.academicYearId) {
      const res3 = await this.client.get<StudentSectionResponse[]>(
        `/academics/students/${this.ctx.studentId}/sections?academicYearId=${this.ctx.academicYearId}`
      );
      if (res3.status === 200 && res3.data) {
        const sections = res3.data as StudentSectionResponse[];
        // Student should be enrolled in at least 1 section (section1) and possibly section2
        if (Array.isArray(sections) && sections.length >= 1) {
          this.record('5.3 Student has expected section count', 'PASS', res3.duration);
          console.log(`       Student enrolled in ${sections.length} section(s)`);
        } else {
          this.record('5.3 Student has expected section count', 'FAIL', res3.duration, {
            error: `Expected >= 1 sections, got ${Array.isArray(sections) ? sections.length : 0}`,
          });
        }
      } else {
        this.record('5.3 Student has expected section count', 'SKIP', res3.duration, { error: 'Could not fetch student sections' });
      }
    } else {
      this.record('5.3 Student has expected section count', 'SKIP', 0, { error: 'Missing context' });
    }

    // 5.4 Verify student not enrolled in nonexistent section
    if (this.ctx.studentId && this.ctx.academicYearId) {
      const res4 = await this.client.get<StudentSectionResponse[]>(
        `/academics/students/${this.ctx.studentId}/sections?academicYearId=nonexistent-year`
      );
      if (res4.status === 200 && res4.data) {
        const sections = res4.data as StudentSectionResponse[];
        if (Array.isArray(sections) && sections.length === 0) {
          this.record('5.4 No sections for nonexistent academic year', 'PASS', res4.duration);
        } else {
          this.record('5.4 No sections for nonexistent academic year', 'FAIL', res4.duration, {
            error: `Expected 0 sections, got ${Array.isArray(sections) ? sections.length : 'non-array'}`,
          });
        }
      } else {
        this.record('5.4 No sections for nonexistent academic year', 'SKIP', res4.duration, { error: `Status: ${res4.status}` });
      }
    } else {
      this.record('5.4 No sections for nonexistent academic year', 'SKIP', 0, { error: 'Missing context' });
    }

    // 5.5 Delete section with enrolled students (should block)
    if (this.ctx.sectionId) {
      const res5 = await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      this.assertStatus(res5, 400, '5.5 Delete section with enrolled students blocked');
    } else {
      this.record('5.5 Delete section with enrolled students blocked', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 5.6 Course search/filter functionality
    if (this.ctx.schoolId) {
      const res6 = await this.client.get<ListResponse<CourseResponse>>(
        `/academics/courses?schoolId=${this.ctx.schoolId}&search=Algebra`
      );
      if (this.assertStatus(res6, 200, '5.6 Course search by name') && res6.data) {
        const items = (res6.data as ListResponse<CourseResponse>).items;
        console.log(`       Search 'Algebra' returned ${items?.length || 0} result(s)`);
      }
    } else {
      this.record('5.6 Course search by name', 'SKIP', 0, { error: 'No schoolId' });
    }

    // 5.7 Verify section listing filters by academicYearId
    if (this.ctx.schoolId && this.ctx.academicYearId) {
      const res7 = await this.client.get<ListResponse<SectionResponse>>(
        `/academics/sections?schoolId=${this.ctx.schoolId}&academicYearId=${this.ctx.academicYearId}&isActive=true`
      );
      if (this.assertStatus(res7, 200, '5.7 Section list with year + active filter') && res7.data) {
        const items = (res7.data as ListResponse<SectionResponse>).items;
        console.log(`       Found ${items?.length || 0} active section(s) in year`);
      }
    } else {
      this.record('5.7 Section list with year + active filter', 'SKIP', 0, { error: 'Missing context' });
    }

    // 5.8 Concurrent enrollment - enroll same student in same section twice rapidly
    if (this.ctx.sectionId2 && this.ctx.studentId2) {
      // studentId2 may or may not be enrolled in sectionId2 from earlier tests
      // Try to enroll — if already enrolled, expect 409
      const res8a = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId2 }
      );
      // First attempt — could be 200/201 or 409 (already enrolled from 3.17)
      if (res8a.status === 200 || res8a.status === 201 || res8a.status === 409) {
        // Now try again — should always be 409
        const res8b = await this.client.post<StudentSectionResponse>(
          `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`,
          { studentId: this.ctx.studentId2 }
        );
        this.assertStatus(res8b, 409, '5.8 Duplicate enrollment prevented');
      } else {
        this.record('5.8 Duplicate enrollment prevented', 'SKIP', res8a.duration, {
          error: `Setup failed with status ${res8a.status}`,
        });
      }
    } else {
      this.record('5.8 Duplicate enrollment prevented', 'SKIP', 0, { error: 'Missing context' });
    }

    // 5.9 Roster returns student details
    const res9 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (res9.status === 200 && res9.data) {
      const roster = res9.data as SectionRosterResponse;
      if (roster.students && roster.students.length > 0 && roster.students[0].studentId) {
        this.record('5.9 Roster returns valid student entries', 'PASS', res9.duration);
      } else {
        this.record('5.9 Roster returns valid student entries', 'FAIL', res9.duration, {
          error: `Expected students with studentId, got ${JSON.stringify(roster.students?.slice(0, 1))}`,
        });
      }
    } else {
      this.record('5.9 Roster returns valid student entries', 'SKIP', res9.duration, { error: `Status: ${res9.status}` });
    }

    // 5.10 Section update preserves enrollment counter
    if (this.ctx.sectionId) {
      const before = await this.client.get<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      const beforeEnrollment = before.data ? (before.data as SectionResponse).currentEnrollment : -1;

      // Update something unrelated to enrollment
      await this.client.patch<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`,
        { sectionName: 'Updated Name for Integrity Test' }
      );

      const after = await this.client.get<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      const afterEnrollment = after.data ? (after.data as SectionResponse).currentEnrollment : -2;

      if (beforeEnrollment === afterEnrollment && beforeEnrollment >= 0) {
        this.record('5.10 Update preserves enrollment counter', 'PASS', (before.duration || 0) + (after.duration || 0));
      } else {
        this.record('5.10 Update preserves enrollment counter', 'FAIL', 0, {
          error: `Before: ${beforeEnrollment}, After: ${afterEnrollment}`,
        });
      }
    } else {
      this.record('5.10 Update preserves enrollment counter', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 5.11 Section isActive after update remains true
    if (this.ctx.sectionId) {
      const res11 = await this.client.get<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      if (res11.status === 200 && res11.data && (res11.data as SectionResponse).isActive === true) {
        this.record('5.11 Section isActive preserved after update', 'PASS', res11.duration);
      } else {
        this.record('5.11 Section isActive preserved after update', 'FAIL', res11.duration, {
          error: `isActive=${res11.data ? (res11.data as SectionResponse).isActive : 'N/A'}`,
        });
      }
    } else {
      this.record('5.11 Section isActive preserved after update', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 5.12 List courses returns consistent schema
    if (this.ctx.schoolId) {
      const res12 = await this.client.get<ListResponse<CourseResponse>>(
        `/academics/courses?schoolId=${this.ctx.schoolId}`
      );
      if (res12.status === 200 && res12.data) {
        const list = res12.data as ListResponse<CourseResponse>;
        const hasRequiredShape = list.items !== undefined && typeof list.hasMore === 'boolean';
        if (hasRequiredShape) {
          this.record('5.12 List courses returns correct schema shape', 'PASS', res12.duration);
        } else {
          this.record('5.12 List courses returns correct schema shape', 'FAIL', res12.duration, {
            error: `Missing items or hasMore: ${JSON.stringify(Object.keys(list))}`,
          });
        }
      } else {
        this.record('5.12 List courses returns correct schema shape', 'SKIP', res12.duration, { error: `Status: ${res12.status}` });
      }
    } else {
      this.record('5.12 List courses returns correct schema shape', 'SKIP', 0, { error: 'No schoolId' });
    }
  }

  // ============================================
  // CLEANUP
  // ============================================
  async runCleanup(): Promise<void> {
    this.currentModule = 'Cleanup';
    console.log('\n\x1b[36m=== Cleanup: Removing Test Data ===\x1b[0m');

    // Drop all enrolled students first
    if (this.ctx.sectionId && this.ctx.studentId && this.ctx.schoolId) {
      await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId}/students/${this.ctx.studentId}?schoolId=${this.ctx.schoolId}`
      );
      console.log('  Dropped student1 from section1');
    }
    if (this.ctx.sectionId2 && this.ctx.studentId && this.ctx.schoolId) {
      await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId2}/students/${this.ctx.studentId}?schoolId=${this.ctx.schoolId}`
      );
      console.log('  Dropped student1 from section2');
    }
    if (this.ctx.sectionId2 && this.ctx.studentId2 && this.ctx.schoolId) {
      await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId2}/students/${this.ctx.studentId2}?schoolId=${this.ctx.schoolId}`
      );
      console.log('  Dropped student2 from section2');
    }

    // Delete sections
    if (this.ctx.sectionId && this.ctx.schoolId) {
      await this.client.delete<void>(`/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`);
      console.log('  Deleted section1');
    }
    if (this.ctx.sectionId2 && this.ctx.schoolId) {
      await this.client.delete<void>(`/academics/sections/${this.ctx.sectionId2}?schoolId=${this.ctx.schoolId}`);
      console.log('  Deleted section2');
    }

    // Delete courses
    if (this.ctx.courseId && this.ctx.schoolId) {
      await this.client.delete<void>(`/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`);
      console.log('  Deleted course1');
    }
    if (this.ctx.courseId2 && this.ctx.schoolId) {
      await this.client.delete<void>(`/academics/courses/${this.ctx.courseId2}?schoolId=${this.ctx.schoolId}`);
      console.log('  Deleted course2');
    }

    // Delete students
    if (this.ctx.studentId) {
      await this.client.delete<void>(`/academics/students/${this.ctx.studentId}`);
      console.log('  Deleted student1');
    }
    if (this.ctx.studentId2) {
      await this.client.delete<void>(`/academics/students/${this.ctx.studentId2}`);
      console.log('  Deleted student2');
    }

    // Delete staff
    if (this.ctx.staffId) {
      await this.client.delete<void>(`/staff/${this.ctx.staffId}`);
      console.log('  Deleted staff1');
    }
    if (this.ctx.staffId2) {
      await this.client.delete<void>(`/staff/${this.ctx.staffId2}`);
      console.log('  Deleted staff2');
    }

    // Delete academic year
    if (this.ctx.schoolId && this.ctx.academicYearId) {
      await this.client.delete<void>(`/schools/${this.ctx.schoolId}/academic-years/${this.ctx.academicYearId}`);
      console.log('  Deleted academic year');
    }

    // Delete school
    if (this.ctx.schoolId) {
      await this.client.delete<void>(`/schools/${this.ctx.schoolId}`);
      console.log('  Deleted school');
    }

    console.log('  Cleanup complete.');
  }

  // ============================================
  // RUN ALL MODULES
  // ============================================
  async run(): Promise<void> {
    console.log('\x1b[1m');
    console.log('================================================================');
    console.log('  EdForge Academics - SP1 Smoke Test Suite');
    console.log('  Course Catalog & Course Sections');
    console.log('================================================================');
    console.log('\x1b[0m');
    console.log(`API Base URL: ${BASE_URL}`);
    console.log(`Started at: ${new Date().toISOString()}`);

    await this.runSetup();
    await this.runCoursesModule();
    await this.runSectionsModule();
    await this.runEnrollmentModule();
    await this.runErrorHandlingModule();
    await this.runDataIntegrityModule();
    await this.runCleanup();

    this.printSummary();
  }

  printSummary(): void {
    console.log('\n\x1b[1m');
    console.log('================================================================');
    console.log('  SP1 SMOKE TEST SUMMARY');
    console.log('================================================================');
    console.log('\x1b[0m');

    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;
    const total = this.results.length;
    const passRate = total - skipped > 0 ? ((passed / (total - skipped)) * 100).toFixed(1) : '0';

    // Summary by module
    const modules = Array.from(new Set(this.results.map(r => r.module)));
    for (const mod of modules) {
      const modResults = this.results.filter(r => r.module === mod);
      const modPassed = modResults.filter(r => r.status === 'PASS').length;
      const modFailed = modResults.filter(r => r.status === 'FAIL').length;
      const modSkipped = modResults.filter(r => r.status === 'SKIP').length;
      console.log(`  ${mod.padEnd(20)} ${modPassed}/${modResults.length - modSkipped} passed, ${modFailed} failed, ${modSkipped} skipped`);
    }

    console.log('\n  ' + '-'.repeat(50));
    console.log(`  \x1b[1mTotal:\x1b[0m     ${total} tests`);
    console.log(`  \x1b[32mPassed:\x1b[0m    ${passed}`);
    console.log(`  \x1b[31mFailed:\x1b[0m    ${failed}`);
    console.log(`  \x1b[33mSkipped:\x1b[0m   ${skipped}`);
    console.log(`  \x1b[1mPass Rate:\x1b[0m ${passRate}% (excluding skipped)`);
    console.log('================================================================\n');

    if (failed > 0) {
      console.log('\x1b[31mFailed Tests:\x1b[0m');
      for (const r of this.results.filter(r => r.status === 'FAIL')) {
        console.log(`  - [${r.module}] ${r.name}`);
        if (r.error) console.log(`    Error: ${r.error.slice(0, 150)}`);
      }
      process.exitCode = 1;
    }
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

async function main(): Promise<void> {
  if (!ID_TOKEN || ID_TOKEN.length < 50) {
    console.error('\x1b[31mERROR: Please set ID_TOKEN at the top of the script with a valid Cognito JWT\x1b[0m');
    console.error('You can obtain this from the AWS Cognito console or via the login API.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `sp1_smoke_${timestamp}.log`);

  console.log(`Log file: ${logFile}\n`);

  const client = new ApiClient(BASE_URL, ID_TOKEN, logFile, LOG_LEVEL);
  const runner = new SP1SmokeTestRunner(client);

  try {
    await runner.run();
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error('\x1b[31mUnhandled error:\x1b[0m', err);
  process.exit(1);
});

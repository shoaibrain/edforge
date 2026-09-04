/**
 * EdForge Academics Service - Full Smoke Test Suite (Sprint 1 + Sprint 2)
 *
 * Comprehensive runtime API test suite validating all Academics endpoints:
 *   Module 0: Prerequisites Setup (school, academic year, staff, students)
 *   Module 1: Courses CRUD (SP1)
 *   Module 2: Sections CRUD (SP1)
 *   Module 3: Section Enrollment (SP1)
 *   Module 4: Grading Policies CRUD (SP2)
 *   Module 5: Grade Recording (SP2)
 *   Module 6: GPA Calculation (SP2)
 *   Module 7: Student Grades Endpoint (SP2)
 *   Module 8: Error Handling & Cross-Cutting
 *   Module 9: Data Integrity & Cross-Entity
 *   Cleanup: Remove all test data
 *
 * Usage:
 *   1. Set the ID_TOKEN environment variable (never paste a token into this file)
 *   2. Run: npx ts-node scripts/smoke-tests/academics-full-flow.ts
 *   3. Check console for results and logs/ for detailed output
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// CONFIGURATION
// ============================================

const ID_TOKEN = process.env.ID_TOKEN || ''; // export ID_TOKEN=<Cognito ID token>; never paste a token into this file
const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const LOG_LEVEL = 'debug';

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
  // Prerequisites
  schoolId?: string;
  schoolCode?: string;
  academicYearId?: string;
  termId?: string;
  staffId?: string;
  staffId2?: string;
  studentId?: string;
  studentId2?: string;
  // SP1: Courses & Sections
  courseId?: string;
  courseId2?: string;
  courseCode?: string;
  courseCode2?: string;
  sectionId?: string;
  sectionId2?: string;
  deletedCourseId?: string;
  deletedSectionId?: string;
  // SP2: Grading
  gradingPolicyId?: string;
  gradingPolicyId2?: string;
  gradeId?: string;
  assignmentId?: string;
  assignmentId2?: string;
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
  terms?: Array<{ termId: string; name: string }>;
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
  credits: number;
  creditType?: string;
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

interface GradingPolicyResponse {
  policyId: string;
  schoolId: string;
  policyName: string;
  gradingScale: Array<{
    letter: string;
    minPercentage: number;
    maxPercentage: number;
    gpaPoints: number;
  }>;
  categoryWeights: Array<{
    categoryId: string;
    categoryName: string;
    weight: number;
  }>;
  roundingRule: string;
  minimumPassingGrade: number;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  [key: string]: unknown;
}

interface AssignmentGradeResponse {
  assignmentId: string;
  assignmentName: string;
  categoryId: string;
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  gradedAt: string;
  [key: string]: unknown;
}

interface GradeResponse {
  gradeId: string;
  studentId: string;
  courseId: string;
  termId: string;
  schoolId: string;
  numericGrade?: number;
  letterGrade?: string;
  gpaPoints?: number;
  assignments: AssignmentGradeResponse[];
  isFinal: boolean;
  [key: string]: unknown;
}

interface GpaResult {
  cumulativeGpa: number | null;
  weightedGpa: number | null;
  totalCredits: number;
  termGpas: Array<{ termId: string; gpa: number; credits: number }>;
}

interface StudentGradesResponse {
  studentId: string;
  academicYearId: string;
  grades: GradeResponse[];
  gpa: GpaResult | null;
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
const generateSchoolCode = () => `FULL${Date.now().toString().slice(-5)}`;
const generateCourseCode = () => `CRS-${random4()}`;
const generateStaffUniqueId = () => `STF-FULL-${Date.now()}-${random4()}`;
const generateEmail = (prefix: string) => `${prefix}-${Date.now()}@full-smoke.local`;
const generateStudentNumber = () => `STU-FULL-${Date.now()}-${random4()}`;
const generateAssignmentId = () => `ASGN-${random4()}`;

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
    this.log('INFO', `=== Full Smoke Test Run Started at ${new Date().toISOString()} ===`);
    this.log('INFO', `Base URL: ${baseUrl}`);
  }

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;
    this.logStream.write(logLine + '\n');

    // Also log to console for debug level
    if (this.logLevel === 'debug' && (level === 'DEBUG' || level === 'ERROR')) {
      console.log(`    ${level === 'ERROR' ? '\x1b[31m' : '\x1b[90m'}${message}\x1b[0m`);
    }
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

      this.log('DEBUG', `[${method}] ${endpoint}`);
      if (body && this.logLevel === 'debug') {
        this.log('DEBUG', `Request: ${JSON.stringify(body)}`);
      }

      const response = await axios(config);
      const duration = Date.now() - startTime;

      this.log('DEBUG', `[${method}] ${endpoint} -> ${response.status} (${duration}ms)`);
      if (this.logLevel === 'debug' && response.data) {
        const dataStr = JSON.stringify(response.data);
        this.log('DEBUG', `Response: ${dataStr.length > 500 ? dataStr.slice(0, 500) + '...' : dataStr}`);
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
      this.log('ERROR', `[${method}] ${endpoint} - ERROR (${duration}ms): ${errorMessage}`);
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
  async requestNoAuth<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(method, endpoint, body, 'invalid');
  }

  close(): void {
    this.log('INFO', `=== Full Smoke Test Run Completed at ${new Date().toISOString()} ===`);
    this.logStream.end();
  }
}

// ============================================
// FULL SMOKE TEST RUNNER
// ============================================

class FullSmokeTestRunner {
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
    if (opts?.error) console.log(`       \x1b[31mError: ${opts.error.slice(0, 200)}\x1b[0m`);
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
      name: `Full Smoke Test School ${Date.now()}`,
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

    // 0.2 Create academic year with terms
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
      // Use a simple term ID for testing
      this.ctx.termId = 'term-Q1';
    }

    // 0.3 Create staff member (teacher)
    const res3 = await this.client.post<StaffResponse>('/staff', {
      staffUniqueId: generateStaffUniqueId(),
      firstName: 'Full',
      lastSurname: 'Teacher',
      email: generateEmail('full-teacher'),
      employmentStatus: 'active',
      schoolAssignments: [{ schoolId: this.ctx.schoolId, isPrimary: true, role: 'Teacher' }],
    });
    if (this.assertStatus(res3, [200, 201], '0.3 Create staff (teacher)') && res3.data) {
      this.ctx.staffId = res3.data.staffId;
    }

    // 0.4 Create second staff member
    const res4 = await this.client.post<StaffResponse>('/staff', {
      staffUniqueId: generateStaffUniqueId(),
      firstName: 'Full',
      lastSurname: 'Teacher2',
      email: generateEmail('full-teacher2'),
      employmentStatus: 'active',
      schoolAssignments: [{ schoolId: this.ctx.schoolId, isPrimary: true, role: 'Teacher' }],
    });
    if (this.assertStatus(res4, [200, 201], '0.4 Create staff (teacher 2)') && res4.data) {
      this.ctx.staffId2 = res4.data.staffId;
    }

    // 0.5 Create student 1
    const res5 = await this.client.post<StudentResponse>('/academics/students', {
      firstName: 'FullStudent',
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
      firstName: 'FullStudent',
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
  // MODULE 1: COURSES CRUD (SP1)
  // ============================================
  async runCoursesModule(): Promise<void> {
    this.currentModule = 'Courses';
    console.log('\n\x1b[36m=== Module 1: Courses CRUD (SP1) ===\x1b[0m');

    if (!this.ctx.schoolId) {
      console.log('  \x1b[33m[SKIP] No schoolId - skipping module\x1b[0m');
      return;
    }

    // 1.1 Create course (regular)
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
    if (this.assertStatus(res1, [200, 201], '1.1 Create course (regular)') && res1.data) {
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

    // 1.4 List courses by schoolId
    const res4 = await this.client.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res4, 200, '1.4 List courses by schoolId') && res4.data) {
      console.log(`       Found ${res4.data.items?.length || 0} course(s)`);
    }

    // 1.5 Get course by ID
    if (this.ctx.courseId) {
      const res5 = await this.client.get<CourseResponse>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`
      );
      if (this.assertStatus(res5, 200, '1.5 Get course by ID') && res5.data) {
        console.log(`       courseCode=${res5.data.courseCode}, credits=${res5.data.credits}`);
      }
    } else {
      this.record('1.5 Get course by ID', 'SKIP', 0, { error: 'No courseId' });
    }

    // 1.6 Update course
    if (this.ctx.courseId) {
      const res6 = await this.client.patch<CourseResponse>(
        `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`,
        { courseName: 'Algebra I (Updated)', description: 'Updated description' }
      );
      this.assertStatus(res6, 200, '1.6 Update course');
    } else {
      this.record('1.6 Update course', 'SKIP', 0, { error: 'No courseId' });
    }

    // 1.7 Get course - nonexistent
    const res7 = await this.client.get<CourseResponse>(
      `/academics/courses/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res7, 404, '1.7 Get course - nonexistent');

    // 1.8 Create second course (AP for weighted GPA testing)
    const courseCode2 = generateCourseCode();
    const res8 = await this.client.post<CourseResponse>('/academics/courses', {
      courseCode: courseCode2,
      courseName: 'AP US History',
      schoolId: this.ctx.schoolId,
      subjectArea: 'social_studies',
      courseType: 'core',
      credits: 1.0,
      creditType: 'ap',
      gradeLevels: ['10', '11'],
    });
    if (this.assertStatus(res8, [200, 201], '1.8 Create second course (AP)') && res8.data) {
      this.ctx.courseId2 = res8.data.courseId;
      this.ctx.courseCode2 = courseCode2;
    }

    // 1.9 Create a course to delete
    const deleteCode = generateCourseCode();
    const res9a = await this.client.post<CourseResponse>('/academics/courses', {
      courseCode: deleteCode,
      courseName: 'Course To Delete',
      schoolId: this.ctx.schoolId,
      subjectArea: 'elective',
      courseType: 'elective',
      credits: 0.5,
      creditType: 'regular',
      gradeLevels: ['9'],
    });
    if (res9a.status >= 200 && res9a.status < 300 && res9a.data) {
      this.ctx.deletedCourseId = res9a.data.courseId;
    }

    if (this.ctx.deletedCourseId) {
      const res9 = await this.client.delete<void>(
        `/academics/courses/${this.ctx.deletedCourseId}?schoolId=${this.ctx.schoolId}`
      );
      this.assertStatus(res9, 204, '1.9 Delete course (soft delete)');
    } else {
      this.record('1.9 Delete course (soft delete)', 'SKIP', 0, { error: 'Could not create course to delete' });
    }

    // 1.10 Verify deleted course isActive=false
    if (this.ctx.deletedCourseId) {
      const res10 = await this.client.get<CourseResponse>(
        `/academics/courses/${this.ctx.deletedCourseId}?schoolId=${this.ctx.schoolId}`
      );
      if (res10.status === 200 && res10.data && !res10.data.isActive) {
        this.record('1.10 Deleted course isActive=false', 'PASS', res10.duration);
      } else if (res10.status === 404) {
        this.record('1.10 Deleted course - hard deleted', 'PASS', res10.duration);
      } else {
        this.record('1.10 Deleted course isActive=false', 'FAIL', res10.duration, {
          error: `Expected isActive=false, got status=${res10.status}`,
        });
      }
    } else {
      this.record('1.10 Deleted course isActive=false', 'SKIP', 0, { error: 'No deletedCourseId' });
    }
  }

  // ============================================
  // MODULE 2: SECTIONS CRUD (SP1)
  // ============================================
  async runSectionsModule(): Promise<void> {
    this.currentModule = 'Sections';
    console.log('\n\x1b[36m=== Module 2: Sections CRUD (SP1) ===\x1b[0m');

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

    // 2.3 Create section - duplicate sectionNumber for same course
    if (this.ctx.sectionId) {
      const res3 = await this.client.post<SectionResponse>('/academics/sections', {
        sectionNumber: '001',
        courseId: this.ctx.courseId,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        primaryTeacherId: this.ctx.staffId,
        maxEnrollment: 30,
      });
      this.assertStatus(res3, [400, 409], '2.3 Create section - duplicate sectionNumber');
    } else {
      this.record('2.3 Create section - duplicate sectionNumber', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 2.4 List sections by schoolId
    const res4 = await this.client.get<ListResponse<SectionResponse>>(
      `/academics/sections?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res4, 200, '2.4 List sections by schoolId') && res4.data) {
      console.log(`       Found ${res4.data.items?.length || 0} section(s)`);
    }

    // 2.5 Get section by ID
    if (this.ctx.sectionId) {
      const res5 = await this.client.get<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
      );
      if (this.assertStatus(res5, 200, '2.5 Get section by ID') && res5.data) {
        console.log(`       sectionNumber=${res5.data.sectionNumber}, maxEnrollment=${res5.data.maxEnrollment}`);
      }
    } else {
      this.record('2.5 Get section by ID', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 2.6 Update section - change maxEnrollment
    if (this.ctx.sectionId) {
      const res6 = await this.client.patch<SectionResponse>(
        `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`,
        { maxEnrollment: 35 }
      );
      this.assertStatus(res6, 200, '2.6 Update section - maxEnrollment');
    } else {
      this.record('2.6 Update section - maxEnrollment', 'SKIP', 0, { error: 'No sectionId' });
    }

    // 2.7 Get section - nonexistent
    const res7 = await this.client.get<SectionResponse>(
      `/academics/sections/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res7, 404, '2.7 Get section - nonexistent');

    // 2.8 Create second section (for AP course)
    if (this.ctx.courseId2) {
      const res8 = await this.client.post<SectionResponse>('/academics/sections', {
        sectionNumber: '001',
        sectionName: 'AP US History - Period 2',
        courseId: this.ctx.courseId2,
        schoolId: this.ctx.schoolId,
        academicYearId: this.ctx.academicYearId,
        primaryTeacherId: this.ctx.staffId,
        maxEnrollment: 30,
      });
      if (this.assertStatus(res8, [200, 201], '2.8 Create second section (AP)') && res8.data) {
        this.ctx.sectionId2 = res8.data.sectionId;
      }
    } else {
      this.record('2.8 Create second section (AP)', 'SKIP', 0, { error: 'No courseId2' });
    }
  }

  // ============================================
  // MODULE 3: SECTION ENROLLMENT (SP1)
  // ============================================
  async runEnrollmentModule(): Promise<void> {
    this.currentModule = 'Enrollment';
    console.log('\n\x1b[36m=== Module 3: Section Enrollment (SP1) ===\x1b[0m');

    if (!this.ctx.sectionId || !this.ctx.studentId || !this.ctx.schoolId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    // 3.1 Enroll student 1 in section 1
    const res1 = await this.client.post<StudentSectionResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`,
      { studentId: this.ctx.studentId }
    );
    this.assertStatus(res1, [200, 201], '3.1 Enroll student 1 in section 1');

    // 3.2 Enroll same student again - expect conflict
    const res2 = await this.client.post<StudentSectionResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`,
      { studentId: this.ctx.studentId }
    );
    this.assertStatus(res2, [400, 409], '3.2 Enroll student - already enrolled');

    // 3.3 Get section roster
    const res3 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res3, 200, '3.3 Get section roster') && res3.data) {
      console.log(`       totalCount=${res3.data.totalCount}`);
    }

    // 3.4 Enroll student 2 in section 1
    if (this.ctx.studentId2) {
      const res4 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId2 }
      );
      this.assertStatus(res4, [200, 201], '3.4 Enroll student 2 in section 1');
    } else {
      this.record('3.4 Enroll student 2 in section 1', 'SKIP', 0, { error: 'No studentId2' });
    }

    // 3.5 Verify roster totalCount = 2
    const res5 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (res5.status === 200 && res5.data) {
      if (res5.data.totalCount === 2) {
        this.record('3.5 Roster totalCount = 2', 'PASS', res5.duration);
      } else {
        this.record('3.5 Roster totalCount = 2', 'FAIL', res5.duration, { error: `Expected 2, got ${res5.data.totalCount}` });
      }
    } else {
      this.record('3.5 Roster totalCount = 2', 'SKIP', res5.duration, { error: 'No roster data' });
    }

    // 3.6 Enroll student 1 in section 2 (AP course)
    if (this.ctx.sectionId2 && this.ctx.studentId) {
      const res6 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId }
      );
      this.assertStatus(res6, [200, 201], '3.6 Enroll student 1 in section 2 (AP)');
    } else {
      this.record('3.6 Enroll student 1 in section 2 (AP)', 'SKIP', 0, { error: 'Missing context' });
    }

    // 3.7 Enroll student 2 in section 2 (AP course)
    if (this.ctx.sectionId2 && this.ctx.studentId2) {
      const res7 = await this.client.post<StudentSectionResponse>(
        `/academics/sections/${this.ctx.sectionId2}/students?schoolId=${this.ctx.schoolId}`,
        { studentId: this.ctx.studentId2 }
      );
      this.assertStatus(res7, [200, 201], '3.7 Enroll student 2 in section 2 (AP)');
    } else {
      this.record('3.7 Enroll student 2 in section 2 (AP)', 'SKIP', 0, { error: 'Missing context' });
    }

    // 3.8 Get student sections
    if (this.ctx.studentId && this.ctx.academicYearId) {
      const res8 = await this.client.get<StudentSectionResponse[]>(
        `/academics/students/${this.ctx.studentId}/sections?academicYearId=${this.ctx.academicYearId}`
      );
      if (this.assertStatus(res8, 200, '3.8 Get student sections') && res8.data) {
        const sections = res8.data as StudentSectionResponse[];
        console.log(`       Student enrolled in ${Array.isArray(sections) ? sections.length : 0} section(s)`);
      }
    } else {
      this.record('3.8 Get student sections', 'SKIP', 0, { error: 'Missing context' });
    }
  }

  // ============================================
  // MODULE 4: GRADING POLICIES CRUD (SP2)
  // ============================================
  async runGradingPoliciesModule(): Promise<void> {
    this.currentModule = 'GradingPolicies';
    console.log('\n\x1b[36m=== Module 4: Grading Policies CRUD (SP2) ===\x1b[0m');

    if (!this.ctx.schoolId) {
      console.log('  \x1b[33m[SKIP] No schoolId - skipping module\x1b[0m');
      return;
    }

    const standardGradingScale = [
      { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
      { letter: 'B', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.0 },
      { letter: 'C', minPercentage: 70, maxPercentage: 79, gpaPoints: 2.0 },
      { letter: 'D', minPercentage: 60, maxPercentage: 69, gpaPoints: 1.0 },
      { letter: 'F', minPercentage: 0, maxPercentage: 59, gpaPoints: 0.0 },
    ];

    const categoryWeights = [
      { categoryId: 'homework', categoryName: 'Homework', weight: 20 },
      { categoryId: 'quizzes', categoryName: 'Quizzes', weight: 20 },
      { categoryId: 'tests', categoryName: 'Tests', weight: 40 },
      { categoryId: 'final', categoryName: 'Final Exam', weight: 20 },
    ];

    // 4.1 Create grading policy
    const res1 = await this.client.post<GradingPolicyResponse>('/academics/grading-policies', {
      schoolId: this.ctx.schoolId,
      policyName: 'Standard Grading Policy',
      gradingScale: standardGradingScale,
      categoryWeights,
      roundingRule: 'nearest',
      minimumPassingGrade: 60,
      isDefault: true,
    });
    if (this.assertStatus(res1, [200, 201], '4.1 Create grading policy') && res1.data) {
      this.ctx.gradingPolicyId = res1.data.policyId;
      console.log(`       policyId=${this.ctx.gradingPolicyId}`);
    }

    // 4.2 Create grading policy - weights don't sum to 100%
    const res2 = await this.client.post<GradingPolicyResponse>('/academics/grading-policies', {
      schoolId: this.ctx.schoolId,
      policyName: 'Bad Weights Policy',
      gradingScale: standardGradingScale,
      categoryWeights: [
        { categoryId: 'hw', categoryName: 'Homework', weight: 30 },
        { categoryId: 'test', categoryName: 'Tests', weight: 50 },
        // Missing 20%
      ],
      roundingRule: 'nearest',
      minimumPassingGrade: 60,
    });
    this.assertStatus(res2, 400, '4.2 Create policy - weights != 100%');

    // 4.3 Create grading policy - overlapping grade ranges
    const res3 = await this.client.post<GradingPolicyResponse>('/academics/grading-policies', {
      schoolId: this.ctx.schoolId,
      policyName: 'Overlapping Scale Policy',
      gradingScale: [
        { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
        { letter: 'B', minPercentage: 85, maxPercentage: 95, gpaPoints: 3.0 }, // Overlaps with A
      ],
      categoryWeights: [{ categoryId: 'all', categoryName: 'All', weight: 100 }],
      roundingRule: 'nearest',
      minimumPassingGrade: 60,
    });
    this.assertStatus(res3, 400, '4.3 Create policy - overlapping scale');

    // 4.4 Create grading policy - min > max in scale
    const res4 = await this.client.post<GradingPolicyResponse>('/academics/grading-policies', {
      schoolId: this.ctx.schoolId,
      policyName: 'Bad Range Policy',
      gradingScale: [
        { letter: 'A', minPercentage: 100, maxPercentage: 90, gpaPoints: 4.0 }, // min > max
      ],
      categoryWeights: [{ categoryId: 'all', categoryName: 'All', weight: 100 }],
      roundingRule: 'nearest',
      minimumPassingGrade: 60,
    });
    this.assertStatus(res4, 400, '4.4 Create policy - min > max');

    // 4.5 List grading policies
    const res5 = await this.client.get<ListResponse<GradingPolicyResponse>>(
      `/academics/grading-policies?schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res5, 200, '4.5 List grading policies') && res5.data) {
      console.log(`       Found ${res5.data.items?.length || 0} policy(ies)`);
    }

    // 4.6 Get grading policy by ID
    if (this.ctx.gradingPolicyId) {
      const res6 = await this.client.get<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId}?schoolId=${this.ctx.schoolId}`
      );
      if (this.assertStatus(res6, 200, '4.6 Get grading policy by ID') && res6.data) {
        console.log(`       policyName=${res6.data.policyName}, isDefault=${res6.data.isDefault}`);
      }
    } else {
      this.record('4.6 Get grading policy by ID', 'SKIP', 0, { error: 'No policyId' });
    }

    // 4.7 Get grading policy - nonexistent
    const res7 = await this.client.get<GradingPolicyResponse>(
      `/academics/grading-policies/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}`
    );
    this.assertStatus(res7, 404, '4.7 Get policy - nonexistent');

    // 4.8 Update grading policy
    if (this.ctx.gradingPolicyId) {
      const res8 = await this.client.patch<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId}?schoolId=${this.ctx.schoolId}`,
        { policyName: 'Standard Grading Policy (Updated)', minimumPassingGrade: 65 }
      );
      this.assertStatus(res8, 200, '4.8 Update grading policy');
    } else {
      this.record('4.8 Update grading policy', 'SKIP', 0, { error: 'No policyId' });
    }

    // 4.9 Create a second policy (non-default)
    const res9 = await this.client.post<GradingPolicyResponse>('/academics/grading-policies', {
      schoolId: this.ctx.schoolId,
      policyName: 'Honors Grading Policy',
      gradingScale: standardGradingScale,
      categoryWeights,
      roundingRule: 'up',
      minimumPassingGrade: 70,
      isDefault: false,
    });
    if (this.assertStatus(res9, [200, 201], '4.9 Create second policy (non-default)') && res9.data) {
      this.ctx.gradingPolicyId2 = res9.data.policyId;
    }

    // 4.10 Set second policy as default (should unset first)
    if (this.ctx.gradingPolicyId2) {
      const res10 = await this.client.patch<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId2}?schoolId=${this.ctx.schoolId}`,
        { isDefault: true }
      );
      this.assertStatus(res10, 200, '4.10 Set second policy as default');
    } else {
      this.record('4.10 Set second policy as default', 'SKIP', 0, { error: 'No policyId2' });
    }

    // 4.11 Verify first policy is no longer default
    if (this.ctx.gradingPolicyId) {
      const res11 = await this.client.get<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId}?schoolId=${this.ctx.schoolId}`
      );
      if (res11.status === 200 && res11.data && res11.data.isDefault === false) {
        this.record('4.11 First policy no longer default', 'PASS', res11.duration);
      } else {
        this.record('4.11 First policy no longer default', 'FAIL', res11.duration, {
          error: `Expected isDefault=false, got ${res11.data?.isDefault}`,
        });
      }
    } else {
      this.record('4.11 First policy no longer default', 'SKIP', 0, { error: 'No policyId' });
    }

    // 4.12 Reset first policy as default for grade tests
    if (this.ctx.gradingPolicyId) {
      const res12 = await this.client.patch<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId}?schoolId=${this.ctx.schoolId}`,
        { isDefault: true }
      );
      this.assertStatus(res12, 200, '4.12 Reset first policy as default');
    } else {
      this.record('4.12 Reset first policy as default', 'SKIP', 0, { error: 'No policyId' });
    }
  }

  // ============================================
  // MODULE 5: GRADE RECORDING (SP2)
  // ============================================
  async runGradeRecordingModule(): Promise<void> {
    this.currentModule = 'GradeRecording';
    console.log('\n\x1b[36m=== Module 5: Grade Recording (SP2) ===\x1b[0m');

    if (!this.ctx.studentId || !this.ctx.courseId || !this.ctx.sectionId || !this.ctx.schoolId || !this.ctx.termId || !this.ctx.staffId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    this.ctx.assignmentId = generateAssignmentId();
    this.ctx.assignmentId2 = generateAssignmentId();

    // 5.1 Record single assignment grade (creates new Grade doc)
    // NOTE: API expects nested `assignment` object with `assignmentType` + `teacherId` required
    const res1 = await this.client.post<GradeResponse>('/academics/grades/record', {
      studentId: this.ctx.studentId,
      schoolId: this.ctx.schoolId,
      courseId: this.ctx.courseId,
      sectionId: this.ctx.sectionId,
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: this.ctx.assignmentId,
        assignmentName: 'Homework 1',
        assignmentType: 'homework',
        categoryId: 'homework',
        earnedPoints: 85,
        possiblePoints: 100,
      },
    });
    if (this.assertStatus(res1, [200, 201], '5.1 Record assignment grade (new)') && res1.data) {
      this.ctx.gradeId = res1.data.gradeId;
      console.log(`       gradeId=${this.ctx.gradeId}, numericGrade=${res1.data.numericGrade}`);
    }

    // 5.2 Record second assignment grade (update existing Grade doc)
    const res2 = await this.client.post<GradeResponse>('/academics/grades/record', {
      studentId: this.ctx.studentId,
      schoolId: this.ctx.schoolId,
      courseId: this.ctx.courseId,
      sectionId: this.ctx.sectionId,
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: this.ctx.assignmentId2,
        assignmentName: 'Quiz 1',
        assignmentType: 'quiz',
        categoryId: 'quizzes',
        earnedPoints: 18,
        possiblePoints: 20,
      },
    });
    if (this.assertStatus(res2, [200, 201], '5.2 Record second assignment') && res2.data) {
      console.log(`       Updated numericGrade=${res2.data.numericGrade}, assignments=${res2.data.assignments?.length}`);
    }

    // 5.3 Record grade - earnedPoints > possiblePoints (error)
    const res3 = await this.client.post<GradeResponse>('/academics/grades/record', {
      studentId: this.ctx.studentId,
      schoolId: this.ctx.schoolId,
      courseId: this.ctx.courseId,
      sectionId: this.ctx.sectionId,
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: generateAssignmentId(),
        assignmentName: 'Invalid Assignment',
        assignmentType: 'test',
        categoryId: 'tests',
        earnedPoints: 110,
        possiblePoints: 100,
      },
    });
    this.assertStatus(res3, 400, '5.3 Record grade - earned > possible');

    // 5.4 Record grade with extra credit (should be allowed)
    const res4 = await this.client.post<GradeResponse>('/academics/grades/record', {
      studentId: this.ctx.studentId,
      schoolId: this.ctx.schoolId,
      courseId: this.ctx.courseId,
      sectionId: this.ctx.sectionId,
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: generateAssignmentId(),
        assignmentName: 'Extra Credit Assignment',
        assignmentType: 'homework',
        categoryId: 'homework',
        earnedPoints: 10,
        possiblePoints: 10,
        isExtraCredit: true,
      },
    });
    this.assertStatus(res4, [200, 201], '5.4 Record grade with extra credit');

    // 5.5 Get grade by student/course/term
    const res5 = await this.client.get<GradeResponse>(
      `/academics/grades?studentId=${this.ctx.studentId}&courseId=${this.ctx.courseId}&termId=${this.ctx.termId}&schoolId=${this.ctx.schoolId}`
    );
    if (this.assertStatus(res5, 200, '5.5 Get grade by student/course/term') && res5.data) {
      const grades = Array.isArray(res5.data) ? res5.data : [res5.data];
      console.log(`       Found ${grades.length} grade(s)`);
    }

    // 5.6 Bulk record grades for section
    // NOTE: API expects `grades` array (not `studentGrades`) and nested `assignment` object
    const res6 = await this.client.post<{ recorded: number; errors: { studentId: string; error: string }[] }>('/academics/grades/record/bulk', {
      schoolId: this.ctx.schoolId,
      sectionId: this.ctx.sectionId,
      courseId: this.ctx.courseId,
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: generateAssignmentId(),
        assignmentName: 'Test 1',
        assignmentType: 'test',
        categoryId: 'tests',
        possiblePoints: 100,
      },
      grades: [
        { studentId: this.ctx.studentId, earnedPoints: 92 },
        { studentId: this.ctx.studentId2, earnedPoints: 88 },
      ],
    });
    if (this.assertStatus(res6, [200, 201], '5.6 Bulk record grades') && res6.data) {
      console.log(`       Bulk recorded: ${res6.data.recorded} successful, ${res6.data.errors?.length || 0} errors`);
    }

    // 5.7 Get section grades
    const res7 = await this.client.get<GradeResponse[]>(
      `/academics/grades/section/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}&termId=${this.ctx.termId}`
    );
    if (this.assertStatus(res7, 200, '5.7 Get section grades') && res7.data) {
      const grades = Array.isArray(res7.data) ? res7.data : [];
      console.log(`       Section has ${grades.length} grade(s)`);
    }

    // 5.8 Record grade for AP course (student 1)
    if (this.ctx.courseId2 && this.ctx.sectionId2) {
      const res8 = await this.client.post<GradeResponse>('/academics/grades/record', {
        studentId: this.ctx.studentId,
        schoolId: this.ctx.schoolId,
        courseId: this.ctx.courseId2,
        sectionId: this.ctx.sectionId2,
        termId: this.ctx.termId,
        academicYearId: this.ctx.academicYearId,
        teacherId: this.ctx.staffId,
        assignment: {
          assignmentId: generateAssignmentId(),
          assignmentName: 'AP History Essay',
          assignmentType: 'test',
          categoryId: 'tests',
          earnedPoints: 95,
          possiblePoints: 100,
        },
      });
      this.assertStatus(res8, [200, 201], '5.8 Record grade for AP course');
    } else {
      this.record('5.8 Record grade for AP course', 'SKIP', 0, { error: 'Missing AP course/section' });
    }

    // 5.9 Finalize grade
    if (this.ctx.gradeId) {
      // gradeId format is composite: studentId:courseId:termId
      const gradeIdComposite = `${this.ctx.studentId}:${this.ctx.courseId}:${this.ctx.termId}`;
      const res9 = await this.client.patch<GradeResponse>(
        `/academics/grades/${encodeURIComponent(gradeIdComposite)}/finalize?schoolId=${this.ctx.schoolId}`,
        {}
      );
      this.assertStatus(res9, 200, '5.9 Finalize grade');
    } else {
      this.record('5.9 Finalize grade', 'SKIP', 0, { error: 'No gradeId' });
    }

    // 5.10 Try to record on finalized grade (should fail)
    if (this.ctx.gradeId) {
      const res10 = await this.client.post<GradeResponse>('/academics/grades/record', {
        studentId: this.ctx.studentId,
        schoolId: this.ctx.schoolId,
        courseId: this.ctx.courseId,
        sectionId: this.ctx.sectionId,
        termId: this.ctx.termId,
        academicYearId: this.ctx.academicYearId,
        teacherId: this.ctx.staffId,
        assignment: {
          assignmentId: generateAssignmentId(),
          assignmentName: 'Post-Final Assignment',
          assignmentType: 'homework',
          categoryId: 'homework',
          earnedPoints: 50,
          possiblePoints: 50,
        },
      });
      this.assertStatus(res10, [400, 409], '5.10 Record on finalized grade (blocked)');
    } else {
      this.record('5.10 Record on finalized grade (blocked)', 'SKIP', 0, { error: 'No gradeId' });
    }

    // 5.11 Record grade for student 2 in AP course (for GPA comparison)
    if (this.ctx.courseId2 && this.ctx.sectionId2 && this.ctx.studentId2) {
      const res11 = await this.client.post<GradeResponse>('/academics/grades/record', {
        studentId: this.ctx.studentId2,
        schoolId: this.ctx.schoolId,
        courseId: this.ctx.courseId2,
        sectionId: this.ctx.sectionId2,
        termId: this.ctx.termId,
        academicYearId: this.ctx.academicYearId,
        teacherId: this.ctx.staffId,
        assignment: {
          assignmentId: generateAssignmentId(),
          assignmentName: 'AP History Essay',
          assignmentType: 'test',
          categoryId: 'tests',
          earnedPoints: 88,
          possiblePoints: 100,
        },
      });
      this.assertStatus(res11, [200, 201], '5.11 Record grade for student 2 AP course');
    } else {
      this.record('5.11 Record grade for student 2 AP course', 'SKIP', 0, { error: 'Missing context' });
    }
  }

  // ============================================
  // MODULE 6: GPA CALCULATION (SP2)
  // ============================================
  async runGpaModule(): Promise<void> {
    this.currentModule = 'GPA';
    console.log('\n\x1b[36m=== Module 6: GPA Calculation (SP2) ===\x1b[0m');

    if (!this.ctx.studentId || !this.ctx.academicYearId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    // 6.1 Get student grades with GPA (via student grades endpoint)
    const res1 = await this.client.get<StudentGradesResponse>(
      `/academics/students/${this.ctx.studentId}/grades?academicYearId=${this.ctx.academicYearId}&termId=${this.ctx.termId}`
    );
    if (this.assertStatus(res1, 200, '6.1 Get student grades with GPA') && res1.data) {
      console.log(`       grades=${res1.data.grades?.length || 0}, cumulativeGpa=${res1.data.gpa?.cumulativeGpa}`);
      console.log(`       weightedGpa=${res1.data.gpa?.weightedGpa}, totalCredits=${res1.data.gpa?.totalCredits}`);
    }

    // 6.2 Verify GPA calculation for student 2 (has grades in both courses)
    if (this.ctx.studentId2) {
      const res2 = await this.client.get<StudentGradesResponse>(
        `/academics/students/${this.ctx.studentId2}/grades?academicYearId=${this.ctx.academicYearId}&termId=${this.ctx.termId}`
      );
      if (this.assertStatus(res2, 200, '6.2 Get student 2 grades with GPA') && res2.data) {
        console.log(`       grades=${res2.data.grades?.length || 0}, cumulativeGpa=${res2.data.gpa?.cumulativeGpa}`);
      }
    } else {
      this.record('6.2 Get student 2 grades with GPA', 'SKIP', 0, { error: 'No studentId2' });
    }

    // 6.3 Verify weighted GPA differs from unweighted (AP course)
    if (res1.data?.gpa) {
      const unweighted = res1.data.gpa.cumulativeGpa;
      const weighted = res1.data.gpa.weightedGpa;
      if (weighted !== null && unweighted !== null && weighted >= unweighted) {
        this.record('6.3 Weighted GPA >= Unweighted GPA', 'PASS', 0);
        console.log(`       Unweighted=${unweighted}, Weighted=${weighted}`);
      } else if (weighted === null || unweighted === null) {
        this.record('6.3 Weighted GPA >= Unweighted GPA', 'SKIP', 0, { error: 'GPA is null (no finalized grades)' });
      } else {
        this.record('6.3 Weighted GPA >= Unweighted GPA', 'FAIL', 0, {
          error: `Expected weighted >= unweighted, got ${weighted} < ${unweighted}`
        });
      }
    } else {
      this.record('6.3 Weighted GPA >= Unweighted GPA', 'SKIP', 0, { error: 'No GPA data' });
    }

    // 6.4 Get grades without academicYearId (should work with termId)
    const res4 = await this.client.get<StudentGradesResponse>(
      `/academics/students/${this.ctx.studentId}/grades?academicYearId=${this.ctx.academicYearId}`
    );
    this.assertStatus(res4, 200, '6.4 Get grades without termId filter');

    // 6.5 Get grades for nonexistent student
    const res5 = await this.client.get<StudentGradesResponse>(
      `/academics/students/00000000-0000-0000-0000-000000000000/grades?academicYearId=${this.ctx.academicYearId}`
    );
    // Should return empty or 404
    this.assertStatus(res5, [200, 404], '6.5 Get grades - nonexistent student');
  }

  // ============================================
  // MODULE 7: ERROR HANDLING & CROSS-CUTTING
  // ============================================
  async runErrorHandlingModule(): Promise<void> {
    this.currentModule = 'ErrorHandling';
    console.log('\n\x1b[36m=== Module 7: Error Handling & Cross-Cutting ===\x1b[0m');

    // 7.1 Request without auth token
    const res1 = await this.client.requestNoAuth<unknown>('GET', `/academics/courses?schoolId=${this.ctx.schoolId || 'x'}`);
    this.assertStatus(res1, [401, 403], '7.1 No auth token - expect 401/403');

    // 7.2 Grading policies without schoolId
    const res2 = await this.client.get<ListResponse<GradingPolicyResponse>>('/academics/grading-policies');
    this.assertStatus(res2, [200, 400], '7.2 List policies - no schoolId');

    // 7.3 Record grade - invalid sectionId
    const res3 = await this.client.post<GradeResponse>('/academics/grades/record', {
      studentId: this.ctx.studentId,
      schoolId: this.ctx.schoolId,
      courseId: this.ctx.courseId,
      sectionId: '00000000-0000-0000-0000-000000000000',
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: generateAssignmentId(),
        assignmentName: 'Invalid Section Assignment',
        assignmentType: 'homework',
        categoryId: 'homework',
        earnedPoints: 80,
        possiblePoints: 100,
      },
    });
    this.assertStatus(res3, [400, 404, 500], '7.3 Record grade - invalid sectionId');

    // 7.4 Finalize grade - nonexistent
    const res4 = await this.client.patch<GradeResponse>(
      `/academics/grades/nonexistent:nonexistent:nonexistent/finalize?schoolId=${this.ctx.schoolId}`,
      {}
    );
    this.assertStatus(res4, 404, '7.4 Finalize - nonexistent grade');

    // 7.5 Update policy - validate weights on update
    if (this.ctx.gradingPolicyId) {
      const res5 = await this.client.patch<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId}?schoolId=${this.ctx.schoolId}`,
        {
          categoryWeights: [
            { categoryId: 'only', categoryName: 'Only', weight: 50 }, // != 100%
          ]
        }
      );
      this.assertStatus(res5, 400, '7.5 Update policy - invalid weights');
    } else {
      this.record('7.5 Update policy - invalid weights', 'SKIP', 0, { error: 'No policyId' });
    }

    // 7.6 Section grades - invalid sectionId
    const res6 = await this.client.get<ListResponse<GradeResponse>>(
      `/academics/grades/section/00000000-0000-0000-0000-000000000000?schoolId=${this.ctx.schoolId}&termId=${this.ctx.termId}`
    );
    this.assertStatus(res6, [200, 404], '7.6 Section grades - invalid sectionId');

    // 7.7 Bulk grades with empty grades array
    const res7 = await this.client.post<{ recorded: number; errors: { studentId: string; error: string }[] }>('/academics/grades/record/bulk', {
      schoolId: this.ctx.schoolId,
      sectionId: this.ctx.sectionId,
      courseId: this.ctx.courseId,
      termId: this.ctx.termId,
      academicYearId: this.ctx.academicYearId,
      teacherId: this.ctx.staffId,
      assignment: {
        assignmentId: generateAssignmentId(),
        assignmentName: 'Empty Bulk',
        assignmentType: 'test',
        categoryId: 'tests',
        possiblePoints: 100,
      },
      grades: [],
    });
    this.assertStatus(res7, [200, 400], '7.7 Bulk grades - empty array');
  }

  // ============================================
  // MODULE 8: DATA INTEGRITY & CROSS-ENTITY
  // ============================================
  async runDataIntegrityModule(): Promise<void> {
    this.currentModule = 'DataIntegrity';
    console.log('\n\x1b[36m=== Module 8: Data Integrity & Cross-Entity ===\x1b[0m');

    if (!this.ctx.schoolId || !this.ctx.courseId || !this.ctx.sectionId || !this.ctx.studentId) {
      console.log('  \x1b[33m[SKIP] Missing prerequisites - skipping module\x1b[0m');
      return;
    }

    // 8.1 Verify section has correct course denormalized data
    const res1 = await this.client.get<SectionResponse>(
      `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
    );
    if (res1.status === 200 && res1.data) {
      if (res1.data.courseId === this.ctx.courseId) {
        this.record('8.1 Section courseId matches', 'PASS', res1.duration);
      } else {
        this.record('8.1 Section courseId matches', 'FAIL', res1.duration, {
          error: `Expected ${this.ctx.courseId}, got ${res1.data.courseId}`,
        });
      }
    } else {
      this.record('8.1 Section courseId matches', 'SKIP', res1.duration, { error: 'Could not fetch section' });
    }

    // 8.2 Verify course version incremented after update
    const res2 = await this.client.get<CourseResponse>(
      `/academics/courses/${this.ctx.courseId}?schoolId=${this.ctx.schoolId}`
    );
    if (res2.status === 200 && res2.data) {
      if (res2.data.version && res2.data.version > 1) {
        this.record('8.2 Course version incremented', 'PASS', res2.duration);
      } else {
        this.record('8.2 Course version incremented', 'FAIL', res2.duration, {
          error: `Expected version > 1, got ${res2.data.version}`,
        });
      }
    } else {
      this.record('8.2 Course version incremented', 'SKIP', res2.duration, { error: 'Could not fetch course' });
    }

    // 8.3 Verify grading policy has correct school reference
    if (this.ctx.gradingPolicyId) {
      const res3 = await this.client.get<GradingPolicyResponse>(
        `/academics/grading-policies/${this.ctx.gradingPolicyId}?schoolId=${this.ctx.schoolId}`
      );
      if (res3.status === 200 && res3.data && res3.data.schoolId === this.ctx.schoolId) {
        this.record('8.3 Policy schoolId matches', 'PASS', res3.duration);
      } else {
        this.record('8.3 Policy schoolId matches', 'FAIL', res3.duration, {
          error: `Expected schoolId=${this.ctx.schoolId}`,
        });
      }
    } else {
      this.record('8.3 Policy schoolId matches', 'SKIP', 0, { error: 'No policyId' });
    }

    // 8.4 Verify grade has correct student/course/term
    const res4 = await this.client.get<ListResponse<GradeResponse>>(
      `/academics/grades?studentId=${this.ctx.studentId}&courseId=${this.ctx.courseId}&termId=${this.ctx.termId}&schoolId=${this.ctx.schoolId}`
    );
    if (res4.status === 200 && res4.data) {
      const grades = res4.data.items || (Array.isArray(res4.data) ? res4.data : []);
      if (grades.length > 0 && grades[0].studentId === this.ctx.studentId) {
        this.record('8.4 Grade student/course/term matches', 'PASS', res4.duration);
      } else {
        this.record('8.4 Grade student/course/term matches', 'FAIL', res4.duration, {
          error: `No matching grades found`,
        });
      }
    } else {
      this.record('8.4 Grade student/course/term matches', 'SKIP', res4.duration, { error: 'Could not fetch grades' });
    }

    // 8.5 Verify section enrollment counter
    const res5 = await this.client.get<SectionResponse>(
      `/academics/sections/${this.ctx.sectionId}?schoolId=${this.ctx.schoolId}`
    );
    if (res5.status === 200 && res5.data && res5.data.currentEnrollment >= 1) {
      this.record('8.5 Section enrollment counter >= 1', 'PASS', res5.duration);
      console.log(`       currentEnrollment=${res5.data.currentEnrollment}`);
    } else {
      this.record('8.5 Section enrollment counter >= 1', 'FAIL', res5.duration, {
        error: `currentEnrollment=${res5.data?.currentEnrollment}`,
      });
    }

    // 8.6 Verify roster student entries have required fields
    const res6 = await this.client.get<SectionRosterResponse>(
      `/academics/sections/${this.ctx.sectionId}/students?schoolId=${this.ctx.schoolId}`
    );
    if (res6.status === 200 && res6.data && res6.data.students?.length > 0) {
      const hasRequiredFields = res6.data.students[0].studentId && res6.data.students[0].enrolledAt;
      if (hasRequiredFields) {
        this.record('8.6 Roster entries have required fields', 'PASS', res6.duration);
      } else {
        this.record('8.6 Roster entries have required fields', 'FAIL', res6.duration, {
          error: 'Missing studentId or enrolledAt',
        });
      }
    } else {
      this.record('8.6 Roster entries have required fields', 'SKIP', res6.duration, { error: 'No roster data' });
    }

    // 8.7 List courses returns correct schema shape
    const res7 = await this.client.get<ListResponse<CourseResponse>>(
      `/academics/courses?schoolId=${this.ctx.schoolId}`
    );
    if (res7.status === 200 && res7.data) {
      const hasRequiredShape = res7.data.items !== undefined && typeof res7.data.hasMore === 'boolean';
      if (hasRequiredShape) {
        this.record('8.7 List courses correct schema', 'PASS', res7.duration);
      } else {
        this.record('8.7 List courses correct schema', 'FAIL', res7.duration, {
          error: `Missing items or hasMore`,
        });
      }
    } else {
      this.record('8.7 List courses correct schema', 'SKIP', res7.duration, { error: 'No data' });
    }

    // 8.8 Verify grade assignments array structure
    const res8 = await this.client.get<StudentGradesResponse>(
      `/academics/students/${this.ctx.studentId}/grades?academicYearId=${this.ctx.academicYearId}&termId=${this.ctx.termId}`
    );
    if (res8.status === 200 && res8.data && res8.data.grades?.length > 0) {
      const grade = res8.data.grades[0];
      if (Array.isArray(grade.assignments)) {
        this.record('8.8 Grade has assignments array', 'PASS', res8.duration);
        console.log(`       Grade has ${grade.assignments.length} assignment(s)`);
      } else {
        this.record('8.8 Grade has assignments array', 'FAIL', res8.duration, {
          error: 'assignments is not an array',
        });
      }
    } else {
      this.record('8.8 Grade has assignments array', 'SKIP', res8.duration, { error: 'No grade data' });
    }
  }

  // ============================================
  // CLEANUP
  // ============================================
  async runCleanup(): Promise<void> {
    this.currentModule = 'Cleanup';
    console.log('\n\x1b[36m=== Cleanup: Removing Test Data ===\x1b[0m');

    // Drop enrolled students from sections first
    if (this.ctx.sectionId && this.ctx.studentId && this.ctx.schoolId) {
      await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId}/students/${this.ctx.studentId}?schoolId=${this.ctx.schoolId}`
      );
      console.log('  Dropped student1 from section1');
    }
    if (this.ctx.sectionId && this.ctx.studentId2 && this.ctx.schoolId) {
      await this.client.delete<void>(
        `/academics/sections/${this.ctx.sectionId}/students/${this.ctx.studentId2}?schoolId=${this.ctx.schoolId}`
      );
      console.log('  Dropped student2 from section1');
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

    // Delete grading policies (Note: may not have delete endpoint, skip if not available)
    // Policies are typically soft-deleted or retained for audit

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
    console.log('  EdForge Academics - Full Smoke Test Suite');
    console.log('  Sprint 1 (Courses & Sections) + Sprint 2 (Grades & GPA)');
    console.log('================================================================');
    console.log('\x1b[0m');
    console.log(`API Base URL: ${BASE_URL}`);
    console.log(`Started at: ${new Date().toISOString()}`);

    await this.runSetup();
    await this.runCoursesModule();
    await this.runSectionsModule();
    await this.runEnrollmentModule();
    await this.runGradingPoliciesModule();
    await this.runGradeRecordingModule();
    await this.runGpaModule();
    await this.runErrorHandlingModule();
    await this.runDataIntegrityModule();
    await this.runCleanup();

    this.printSummary();
  }

  printSummary(): void {
    console.log('\n\x1b[1m');
    console.log('================================================================');
    console.log('  FULL SMOKE TEST SUMMARY');
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
      const icon = modFailed > 0 ? '\x1b[31m' : '\x1b[32m';
      console.log(`  ${icon}${mod.padEnd(20)}\x1b[0m ${modPassed}/${modResults.length - modSkipped} passed, ${modFailed} failed, ${modSkipped} skipped`);
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
  if (!ID_TOKEN || ID_TOKEN.length < 50 || ID_TOKEN === 'PASTE_YOUR_JWT_HERE') {
    console.error('\x1b[31mERROR: Please set ID_TOKEN environment variable or paste JWT in the script\x1b[0m');
    console.error('Usage: ID_TOKEN=<your-jwt> npx ts-node scripts/smoke-tests/academics-full-flow.ts');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `full_smoke_${timestamp}.log`);

  console.log(`Log file: ${logFile}\n`);

  const client = new ApiClient(BASE_URL, ID_TOKEN, logFile, LOG_LEVEL);
  const runner = new FullSmokeTestRunner(client);

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

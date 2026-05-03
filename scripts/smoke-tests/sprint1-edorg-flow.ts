/**
 * EdForge Sprint 1 - EdOrg Hierarchy & Platform Foundation Smoke Test
 *
 * Validates the Sprint 1 flow:
 *   1. Authenticate (JWT from Cognito)
 *   2. GET /education-organizations/hierarchy → verify tree structure
 *   3. Create/GET school with localEducationAgencyId → verify Ed-Fi field round-trip
 *   4. GET /schools?leaId=... → verify LEA filter
 *   5. GET /schools/:schoolId → verify school detail with Ed-Fi fields
 *   6. GET /schools/:schoolId/staff → verify school-scoped staff listing
 *   7. GET /schools/:schoolId/configuration → verify school config
 *
 * Usage:
 *   1. Paste your Cognito JWT in ID_TOKEN below
 *   2. Run: npx ts-node scripts/smoke-tests/sprint1-edorg-flow.ts
 *   3. Check console output and logs/ for detailed results
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// CONFIGURATION - Edit these values
// ============================================

const ID_TOKEN = process.env.ID_TOKEN || 'PASTE_YOUR_TOKEN_HERE';
const BASE_URL = process.env.BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
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
}

interface TestContext {
  schoolId?: string;
  schoolId2?: string;
  schoolCode?: string;
  leaId?: string;
  seaId?: string;
  staffId?: string;
  hierarchyNodeCount?: number;
}

interface SchoolResponse {
  schoolId: string;
  schoolCode: string;
  name: string;
  status: string;
  localEducationAgencyId?: string;
  schoolCategories?: string[];
  schoolTypeDescriptor?: string;
  gradeLevels?: string[];
  [key: string]: unknown;
}

interface HierarchyResponse {
  sea?: { id: string; name: string; [key: string]: unknown };
  leas?: Array<{ id: string; name: string; schools?: Array<{ id: string; name: string }>; [key: string]: unknown }>;
  schools?: Array<{ id: string; name: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface StaffResponse {
  staffId: string;
  firstName: string;
  lastSurname: string;
  email: string;
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
const generateEmail = (prefix: string) => `${prefix}-${Date.now()}@smoketest.local`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    this.log(`=== Sprint 1 Smoke Test Started at ${new Date().toISOString()} ===`);
    this.log(`Base URL: ${baseUrl}`);
  }

  private log(message: string): void {
    const logLine = `[${new Date().toISOString()}] ${message}\n`;
    this.logStream.write(logLine);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();

    try {
      const config: AxiosRequestConfig = {
        method,
        url,
        headers: {
          'Authorization': `Bearer ${this.token}`,
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
      this.log(`[${method}] ${url} - ERROR - ${duration}ms - ${errorMessage}`);
      return { status: 0, data: null, error: errorMessage, duration };
    }
  }

  close(): void {
    this.logStream.end();
  }
}

// ============================================
// TEST RUNNER
// ============================================

class Sprint1TestRunner {
  private api: ApiClient;
  private ctx: TestContext = {};
  private results: TestResult[] = [];

  constructor(api: ApiClient) {
    this.api = api;
  }

  private pass(name: string, module: string, duration: number): void {
    this.results.push({ name, module, status: 'PASS', duration });
    console.log(`  ✅ ${name} (${duration}ms)`);
  }

  private fail(name: string, module: string, duration: number, error: string): void {
    this.results.push({ name, module, status: 'FAIL', duration, error });
    console.log(`  ❌ ${name} (${duration}ms) - ${error}`);
  }

  private skip(name: string, module: string, reason: string): void {
    this.results.push({ name, module, status: 'SKIP', duration: 0, error: reason });
    console.log(`  ⏭️  ${name} - SKIPPED: ${reason}`);
  }

  // ============================================
  // MODULE 1: EdOrg Hierarchy
  // ============================================

  async testEdOrgHierarchy(): Promise<void> {
    console.log('\n📋 Module 1: Education Organization Hierarchy');

    // Test 1.1: GET hierarchy
    const t = Date.now();
    const res = await this.api.request<HierarchyResponse>('GET', '/education-organizations/hierarchy');
    const dur = Date.now() - t;

    if (res.status === 200 && res.data) {
      this.pass('GET /education-organizations/hierarchy returns 200', 'EdOrg', dur);
      
      // Verify tree structure has expected shape
      const data = res.data;
      const hasSea = !!data.sea;
      const hasLeas = Array.isArray(data.leas) && data.leas.length > 0;

      if (hasSea) {
        this.pass('Hierarchy contains SEA node', 'EdOrg', 0);
        this.ctx.seaId = data.sea!.id;
      } else {
        this.skip('Hierarchy contains SEA node', 'EdOrg', 'No SEA configured for this tenant');
      }

      if (hasLeas) {
        this.pass('Hierarchy contains LEA nodes', 'EdOrg', 0);
        this.ctx.leaId = data.leas![0].id;
      } else {
        this.skip('Hierarchy contains LEA nodes', 'EdOrg', 'No LEAs configured for this tenant');
      }
    } else {
      this.fail('GET /education-organizations/hierarchy returns 200', 'EdOrg', dur, res.error || `Status: ${res.status}`);
    }

    // Test 1.2: GET LEAs
    const leaRes = await this.api.request<ListResponse<{ leaId: string; name: string }>>('GET', '/education-organizations/leas');
    if (leaRes.status === 200 && leaRes.data) {
      this.pass('GET /education-organizations/leas returns 200', 'EdOrg', leaRes.duration);
      if (leaRes.data.items && leaRes.data.items.length > 0) {
        this.ctx.leaId = leaRes.data.items[0].leaId;
        this.pass(`Found ${leaRes.data.items.length} LEA(s)`, 'EdOrg', 0);
      }
    } else {
      this.fail('GET /education-organizations/leas returns 200', 'EdOrg', leaRes.duration, leaRes.error || `Status: ${leaRes.status}`);
    }
  }

  // ============================================
  // MODULE 2: School CRUD with Ed-Fi Fields
  // ============================================

  async testSchoolWithEdFiFields(): Promise<void> {
    console.log('\n🏫 Module 2: School CRUD with Ed-Fi Fields');

    // Test 2.1: Create school with localEducationAgencyId
    const schoolCode = generateSchoolCode();
    const createBody: Record<string, unknown> = {
      schoolCode,
      name: `Sprint 1 Test School ${random4()}`,
      shortName: `SP1-${random4()}`,
      schoolType: 'elementary',
      gradeRange: { start: 'K', end: '5' },
      phone: '555-100-2000',
      email: `school-${Date.now()}@smoketest.local`,
      timezone: 'America/Chicago',
      locale: 'en-US',
      academicCalendarType: 'semester',
      // Ed-Fi fields
      schoolCategories: ['Elementary'],
      gradeLevels: ['Kindergarten', 'FirstGrade', 'SecondGrade', 'ThirdGrade', 'FourthGrade'],
    };

    // If we have a LEA from hierarchy, link this school to it
    if (this.ctx.leaId) {
      createBody.localEducationAgencyId = this.ctx.leaId;
    }

    const createRes = await this.api.request<SchoolResponse>('POST', '/schools', createBody);
    if (createRes.status === 201 && createRes.data) {
      this.pass('POST /schools with Ed-Fi fields returns 201', 'School', createRes.duration);
      this.ctx.schoolId = createRes.data.schoolId;
      this.ctx.schoolCode = schoolCode;

      // Verify Ed-Fi field round-trip
      if (this.ctx.leaId && createRes.data.localEducationAgencyId === this.ctx.leaId) {
        this.pass('localEducationAgencyId persisted correctly', 'School', 0);
      } else if (this.ctx.leaId) {
        this.fail('localEducationAgencyId persisted correctly', 'School', 0,
          `Expected ${this.ctx.leaId}, got ${createRes.data.localEducationAgencyId}`);
      } else {
        this.skip('localEducationAgencyId persisted correctly', 'School', 'No LEA available to test');
      }

      if (Array.isArray(createRes.data.schoolCategories) && createRes.data.schoolCategories.length > 0) {
        this.pass('schoolCategories persisted as array', 'School', 0);
      } else {
        this.fail('schoolCategories persisted as array', 'School', 0, 'schoolCategories not in response');
      }

      if (Array.isArray(createRes.data.gradeLevels) && createRes.data.gradeLevels.length === 5) {
        this.pass('gradeLevels persisted correctly (5 items)', 'School', 0);
      } else {
        this.fail('gradeLevels persisted correctly', 'School', 0,
          `Expected 5 gradeLevels, got ${createRes.data.gradeLevels?.length || 0}`);
      }
    } else {
      this.fail('POST /schools with Ed-Fi fields returns 201', 'School', createRes.duration, createRes.error || `Status: ${createRes.status}`);
    }

    // Test 2.2: GET school detail verifies Ed-Fi fields
    if (this.ctx.schoolId) {
      const getRes = await this.api.request<SchoolResponse>('GET', `/schools/${this.ctx.schoolId}`);
      if (getRes.status === 200 && getRes.data) {
        this.pass('GET /schools/:schoolId returns 200', 'School', getRes.duration);

        if (getRes.data.localEducationAgencyId === (this.ctx.leaId || undefined)) {
          this.pass('GET school detail includes localEducationAgencyId', 'School', 0);
        }
      } else {
        this.fail('GET /schools/:schoolId returns 200', 'School', getRes.duration, getRes.error || `Status: ${getRes.status}`);
      }
    }

    // Test 2.3: Update school to add/change localEducationAgencyId
    if (this.ctx.schoolId) {
      const updateRes = await this.api.request<SchoolResponse>('PATCH', `/schools/${this.ctx.schoolId}`, {
        schoolTypeDescriptor: 'Regular',
        titleIPartASchoolDesignationDescriptor: 'Not A Title I School',
      });
      if (updateRes.status === 200 && updateRes.data) {
        this.pass('PATCH /schools/:schoolId with Ed-Fi fields returns 200', 'School', updateRes.duration);
        if (updateRes.data.schoolTypeDescriptor === 'Regular') {
          this.pass('schoolTypeDescriptor updated correctly', 'School', 0);
        }
      } else {
        this.fail('PATCH /schools/:schoolId with Ed-Fi fields returns 200', 'School', updateRes.duration, updateRes.error || `Status: ${updateRes.status}`);
      }
    }

    // Test 2.4: List schools with leaId filter
    if (this.ctx.leaId) {
      const filterRes = await this.api.request<ListResponse<SchoolResponse>>('GET', `/schools?leaId=${this.ctx.leaId}`);
      if (filterRes.status === 200 && filterRes.data) {
        this.pass('GET /schools?leaId=... returns 200', 'School', filterRes.duration);
        const filtered = filterRes.data.items || [];
        const allMatchLea = filtered.every(s => s.localEducationAgencyId === this.ctx.leaId);
        if (allMatchLea && filtered.length > 0) {
          this.pass(`LEA filter returned ${filtered.length} school(s), all matching`, 'School', 0);
        } else if (filtered.length === 0) {
          this.skip('LEA filter validation', 'School', 'No schools returned for this LEA');
        } else {
          this.fail('LEA filter validation', 'School', 0, 'Some schools do not match leaId filter');
        }
      } else {
        this.fail('GET /schools?leaId=... returns 200', 'School', filterRes.duration, filterRes.error || `Status: ${filterRes.status}`);
      }
    } else {
      this.skip('GET /schools?leaId=... filter test', 'School', 'No LEA configured');
    }
  }

  // ============================================
  // MODULE 3: School-Scoped Staff
  // ============================================

  async testSchoolScopedStaff(): Promise<void> {
    console.log('\n👥 Module 3: School-Scoped Staff Listing');

    if (!this.ctx.schoolId) {
      this.skip('GET /schools/:schoolId/staff', 'Staff', 'No schoolId from previous tests');
      return;
    }

    // Test 3.1: Create a staff member in the school
    const staffEmail = generateEmail('sp1-staff');
    const createRes = await this.api.request<StaffResponse>('POST', `/schools/${this.ctx.schoolId}/staff`, {
      staffUniqueId: `STF-SP1-${Date.now()}`,
      firstName: 'Sprint1',
      lastSurname: `Teacher${random4()}`,
      email: staffEmail,
      phone: '555-200-3000',
      role: 'teacher',
      employmentType: 'full_time',
      hireDate: '2026-01-15',
      department: 'Mathematics',
    });

    if (createRes.status === 201 && createRes.data) {
      this.pass('POST /schools/:schoolId/staff returns 201', 'Staff', createRes.duration);
      this.ctx.staffId = createRes.data.staffId;
    } else {
      this.fail('POST /schools/:schoolId/staff returns 201', 'Staff', createRes.duration, createRes.error || `Status: ${createRes.status}`);
    }

    // Test 3.2: List staff in school
    const listRes = await this.api.request<ListResponse<StaffResponse>>('GET', `/schools/${this.ctx.schoolId}/staff`);
    if (listRes.status === 200 && listRes.data) {
      this.pass('GET /schools/:schoolId/staff returns 200', 'Staff', listRes.duration);
      const staffCount = listRes.data.items?.length || 0;
      if (staffCount > 0) {
        this.pass(`School has ${staffCount} staff member(s)`, 'Staff', 0);
      } else {
        this.fail('School has staff members after creation', 'Staff', 0, 'Staff list is empty');
      }
    } else {
      this.fail('GET /schools/:schoolId/staff returns 200', 'Staff', listRes.duration, listRes.error || `Status: ${listRes.status}`);
    }
  }

  // ============================================
  // MODULE 4: School Configuration
  // ============================================

  async testSchoolConfiguration(): Promise<void> {
    console.log('\n⚙️  Module 4: School Configuration');

    if (!this.ctx.schoolId) {
      this.skip('School configuration tests', 'Config', 'No schoolId from previous tests');
      return;
    }

    // Test 4.1: GET school configuration (auto-creates default)
    const getRes = await this.api.request<Record<string, unknown>>('GET', `/schools/${this.ctx.schoolId}/configuration`);
    if (getRes.status === 200 && getRes.data) {
      this.pass('GET /schools/:schoolId/configuration returns 200', 'Config', getRes.duration);
      if (getRes.data.timezone) {
        this.pass('Configuration includes timezone', 'Config', 0);
      }
      if (getRes.data.gradingScale) {
        this.pass('Configuration includes gradingScale', 'Config', 0);
      }
    } else {
      this.fail('GET /schools/:schoolId/configuration returns 200', 'Config', getRes.duration, getRes.error || `Status: ${getRes.status}`);
    }
  }

  // ============================================
  // MODULE 5: Cleanup
  // ============================================

  async cleanup(): Promise<void> {
    console.log('\n🧹 Module 5: Cleanup');

    // Soft-delete the staff member
    if (this.ctx.staffId) {
      const delStaff = await this.api.request('DELETE', `/staff/${this.ctx.staffId}`);
      if (delStaff.status === 204) {
        this.pass('DELETE /staff/:staffId returns 204 (soft delete)', 'Cleanup', delStaff.duration);
      } else {
        this.fail('DELETE /staff/:staffId returns 204', 'Cleanup', delStaff.duration, `Status: ${delStaff.status}`);
      }
    }

    // Soft-delete the test school
    if (this.ctx.schoolId) {
      const delSchool = await this.api.request('DELETE', `/schools/${this.ctx.schoolId}`);
      if (delSchool.status === 204) {
        this.pass('DELETE /schools/:schoolId returns 204 (soft delete)', 'Cleanup', delSchool.duration);
      } else {
        this.fail('DELETE /schools/:schoolId returns 204', 'Cleanup', delSchool.duration, `Status: ${delSchool.status}`);
      }
    }
  }

  // ============================================
  // RUNNER
  // ============================================

  async run(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  EdForge Sprint 1 — EdOrg & Platform Smoke Test ║');
    console.log('╚══════════════════════════════════════════════════╝');

    const startTime = Date.now();

    try {
      await this.testEdOrgHierarchy();
      await this.testSchoolWithEdFiFields();
      await this.testSchoolScopedStaff();
      await this.testSchoolConfiguration();
      await this.cleanup();
    } catch (error) {
      console.error('\n💥 Unhandled error during test execution:', error);
    }

    const totalDuration = Date.now() - startTime;

    // Summary
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;

    console.log('\n' + '═'.repeat(55));
    console.log(`  Sprint 1 Smoke Test Results`);
    console.log('═'.repeat(55));
    console.log(`  Total:   ${this.results.length}`);
    console.log(`  Passed:  ${passed}`);
    console.log(`  Failed:  ${failed}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log('═'.repeat(55));

    if (failed > 0) {
      console.log('\n  Failed Tests:');
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`    ❌ [${r.module}] ${r.name}: ${r.error}`));
    }

    console.log('');
    process.exit(failed > 0 ? 1 : 0);
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  if (ID_TOKEN === 'PASTE_YOUR_TOKEN_HERE' && !process.env.ID_TOKEN) {
    console.error('❌ Please set ID_TOKEN environment variable or paste your Cognito JWT in the script.');
    process.exit(1);
  }

  const logFile = path.join(__dirname, '..', '..', 'logs', `sprint1-smoke-${Date.now()}.log`);
  const api = new ApiClient(BASE_URL, ID_TOKEN, logFile, LOG_LEVEL);

  try {
    const runner = new Sprint1TestRunner(api);
    await runner.run();
  } finally {
    api.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

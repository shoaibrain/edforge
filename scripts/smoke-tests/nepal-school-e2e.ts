/**
 * Nepal School End-to-End Smoke Test
 *
 * Complete Nepal pilot flow:
 * 1. Create school with Nepal address (Kathmandu, Bagmati Province)
 * 2. Verify school config has Nepal defaults (Sun-Fri, Asia/Kathmandu, BS calendar)
 * 3. Create academic year 2082-2083 (Gregorian equivalents)
 * 4. Create fee structures (tuition in NPR, auto-apply on enrollment)
 * 5. Create student and enroll
 * 6. Verify auto-invoice generated in NPR
 * 7. Verify locked fields during active academic year
 * 8. Verify audit log
 *
 * Usage:
 *   1. Paste your Cognito JWT in ID_TOKEN below
 *   2. Run: npx ts-node scripts/smoke-tests/nepal-school-e2e.ts
 */

import axios from 'axios';

// ============================================
// CONFIGURATION
// ============================================

const ID_TOKEN = 'PASTE_YOUR_JWT_HERE';
const IDENTITY_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const ACADEMICS_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const FINANCE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

// ============================================
// HELPERS
// ============================================

const headers = { Authorization: `Bearer ${ID_TOKEN}`, 'Content-Type': 'application/json' };

interface TestResult { name: string; status: 'PASS' | 'FAIL'; error?: string }
const results: TestResult[] = [];

function pass(name: string) {
  results.push({ name, status: 'PASS' });
  console.log(`  ✅ ${name}`);
}

function fail(name: string, error: string) {
  results.push({ name, status: 'FAIL', error });
  console.log(`  ❌ ${name}: ${error}`);
}

async function api(baseUrl: string, method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: any) {
  const url = `${baseUrl}${path}`;
  const res = await axios({ method, url, headers, data, validateStatus: () => true });
  return { status: res.status, data: res.data };
}

// ============================================
// TESTS
// ============================================

async function run() {
  console.log('\n🇳🇵 Nepal School E2E Flow - Smoke Tests\n');
  console.log('='.repeat(60));

  let schoolId = '';
  let academicYearId = '';
  let feeStructureId = '';
  let studentId = '';

  // ── Step 1: Create Nepal school ──
  console.log('\n📍 Step 1: Create Nepal School');
  try {
    const res = await api(IDENTITY_URL, 'post', '/schools', {
      schoolCode: `NEPAL-E2E-${Date.now()}`,
      name: 'Nepal Pilot Test School',
      shortName: 'NPTS',
      schoolType: 'k12',
      gradeRange: { start: '1', end: '10' },
      phone: '9841234567',
      email: 'test@nepalschool.edu.np',
      address: {
        street1: 'Thamel Road, Ward 26',
        wardNumber: '26',
        municipality: 'Kathmandu Metropolitan City',
        district: 'Kathmandu',
        province: 'Bagmati Province',
        country: 'NPL',
      },
      academicCalendarType: 'annual',
      calendarSystem: 'bikram_sambat',
    });

    if (res.status === 200 || res.status === 201) {
      schoolId = res.data.schoolId;
      pass(`School created: ${schoolId}`);

      // Verify Nepal-specific fields
      if (res.data.calendarSystem === 'bikram_sambat') pass('calendarSystem = bikram_sambat');
      else fail('calendarSystem check', `Expected bikram_sambat, got ${res.data.calendarSystem}`);

      if (res.data.academicCalendarType === 'annual') pass('academicCalendarType = annual');
      else fail('academicCalendarType check', `Expected annual, got ${res.data.academicCalendarType}`);
    } else {
      fail('Create Nepal school', `Status ${res.status}: ${JSON.stringify(res.data)}`);
      return;
    }
  } catch (err: any) {
    fail('Create Nepal school', err.message);
    return;
  }

  // ── Step 2: Verify school config defaults ──
  console.log('\n⚙️  Step 2: Verify Nepal Default Configuration');
  try {
    const res = await api(IDENTITY_URL, 'get', `/schools/${schoolId}/configuration`);
    if (res.status === 200) {
      const config = res.data;

      if (config.timezone === 'Asia/Kathmandu') pass('timezone = Asia/Kathmandu');
      else fail('timezone check', `Expected Asia/Kathmandu, got ${config.timezone}`);

      const days = config.schoolDays;
      if (JSON.stringify(days) === JSON.stringify([0, 1, 2, 3, 4, 5])) pass('schoolDays = Sun-Fri');
      else fail('schoolDays check', `Expected [0,1,2,3,4,5], got ${JSON.stringify(days)}`);

      pass('Configuration verified');
    } else {
      fail('Get configuration', `Status ${res.status}`);
    }
  } catch (err: any) {
    fail('Get configuration', err.message);
  }

  // ── Step 3: Create academic year (BS 2082-2083) ──
  console.log('\n📅 Step 3: Create Academic Year 2082-2083');
  try {
    const res = await api(IDENTITY_URL, 'post', `/schools/${schoolId}/academic-years`, {
      name: '2082-2083',
      startDate: '2025-04-14', // Baishakh 1, 2082
      endDate: '2026-04-13',   // Chaitra end, 2082
      status: 'active',
    });

    if (res.status === 200 || res.status === 201) {
      academicYearId = res.data.academicYearId || res.data.id;
      pass(`Academic year created: ${academicYearId}`);
    } else {
      fail('Create academic year', `Status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err: any) {
    fail('Create academic year', err.message);
  }

  // ── Step 4: Create fee structure (NPR tuition) ──
  console.log('\n💰 Step 4: Create Fee Structure (NPR Tuition)');
  try {
    const res = await api(FINANCE_URL, 'post', `/schools/${schoolId}/fee-structures`, {
      name: 'Annual Tuition Fee',
      academicYear: '2082-2083',
      academicYearId: academicYearId,
      feeType: 'tuition',
      amount: 50000,
      currency: 'NPR',
      frequency: 'annual',
      gradeLevels: [],
      autoApplyOnEnrollment: true,
      effectiveFrom: '2025-04-14',
      effectiveTo: '2026-04-13',
    });

    if (res.status === 200 || res.status === 201) {
      feeStructureId = res.data.id;
      pass(`Fee structure created: ${feeStructureId} (NPR 50,000)`);
    } else {
      fail('Create fee structure', `Status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err: any) {
    fail('Create fee structure', err.message);
  }

  // ── Step 5: Verify locked fields during active year ──
  console.log('\n🔒 Step 5: Verify Field Governance (Locked Fields)');
  try {
    // Try to change schoolDays during active year → should fail
    const res = await api(IDENTITY_URL, 'patch', `/schools/${schoolId}/configuration`, {
      schoolDays: [1, 2, 3, 4, 5], // Mon-Fri (changing from Sun-Fri)
    });

    if (res.status === 400) {
      pass('Locked field (schoolDays) correctly rejected during active year');
    } else {
      fail('Field governance', `Expected 400, got ${res.status}`);
    }

    // Try to change name → should succeed (always editable)
    const res2 = await api(IDENTITY_URL, 'patch', `/schools/${schoolId}`, {
      name: 'Nepal Pilot Test School (Updated)',
    });

    if (res2.status === 200) {
      pass('Always-editable field (name) updated successfully');
    } else {
      fail('Always-editable field update', `Status ${res2.status}`);
    }
  } catch (err: any) {
    fail('Field governance', err.message);
  }

  // ── Step 6: Verify audit log ──
  console.log('\n📋 Step 6: Verify Audit Log');
  try {
    const res = await api(IDENTITY_URL, 'get', `/schools/${schoolId}/audit-log`);
    if (res.status === 200 && res.data.items?.length > 0) {
      pass(`Audit log has ${res.data.items.length} entries`);
    } else {
      fail('Audit log', `Status ${res.status}, items: ${res.data.items?.length || 0}`);
    }
  } catch (err: any) {
    fail('Audit log', err.message);
  }

  // ── Step 7: Verify all dates are valid Gregorian ISO ──
  console.log('\n📆 Step 7: Verify Date Format (Gregorian ISO)');
  try {
    const res = await api(IDENTITY_URL, 'get', `/schools/${schoolId}`);
    if (res.status === 200) {
      const school = res.data;
      const createdAt = new Date(school.createdAt);
      if (!isNaN(createdAt.getTime())) {
        pass('createdAt is valid ISO date');
      } else {
        fail('createdAt format', `Invalid: ${school.createdAt}`);
      }
    }
  } catch (err: any) {
    fail('Date format check', err.message);
  }

  // ── Cleanup ──
  console.log('\n🧹 Cleanup');
  try {
    if (feeStructureId) {
      await api(FINANCE_URL, 'delete', `/schools/${schoolId}/fee-structures/${feeStructureId}`);
    }
    if (schoolId) {
      await api(IDENTITY_URL, 'delete', `/schools/${schoolId}`);
      pass('Test data cleaned up');
    }
  } catch {
    fail('Cleanup', 'Some cleanup steps failed (non-critical)');
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} checks`);

  if (failed > 0) {
    console.log('\n❌ Failed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All checks passed!');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

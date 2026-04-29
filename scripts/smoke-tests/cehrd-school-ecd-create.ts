/// <reference types="node" />
/**
 * Sprint C1.T6 — CEHRD school create with ECD/PPC starting bands.
 *
 * Locks the post-fix behaviour for BUG-S1/S2/S3:
 *   - POST /schools with gradeRange.start='ECD' must return 200/201, NOT a 400.
 *   - The persisted school's gradeLevels must contain BOTH the new descriptors:
 *     'EarlyChildhoodDevelopment' and 'PrePrimaryClass'.
 *   - The persisted gradeLevels list must be free of duplicates.
 *   - The buggy 0.36.0 string 'EarlyEducation' must NOT appear anywhere.
 *
 * Self-contained: provisions a school under the JWT's tenant; no cleanup
 * (the school stays for follow-up smokes).
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT>"
 *   export API_BASE="https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod"  # UAT
 *   #  or   https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod          # prod
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/cehrd-school-ecd-create.ts
 *
 * Exit 0 = green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
const BASE = process.env.API_BASE ?? 'https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod';

if (!TOKEN) {
  console.error('Missing ADMIN_TOKEN env var');
  process.exit(1);
}

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '\u2713' : '\u2717'} ${name}`);
  if (!ok) {
    console.log(`  \u2514\u2500 ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await axios({
    method,
    url: `${BASE}${path}`,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data as Record<string, unknown> };
}

const ok2xx = (s: number) => s >= 200 && s < 300;

async function main(): Promise<void> {
  const stamp = Date.now().toString().slice(-6);
  const schoolCode = `ECDS${stamp}`;
  const payload = {
    name: `ECD Smoke Test School ${stamp}`,
    schoolCode,
    emisSchoolCode: `9999${stamp}`,
    shortName: 'ECD Smoke',
    schoolType: 'private',
    gradeRange: { start: 'ECD', end: '10' },
    phone: '9819999999',
    email: `smoke-${stamp}@edforge.test`,
    website: 'https://example.com',
    address: {
      street1: 'Smoke Test Address',
      country: 'NPL',
      wardNumber: '1',
      municipality: 'Kathmandu',
      district: 'Kathmandu',
      province: 'Bagmati',
    },
    timezone: 'Asia/Kathmandu',
    locale: 'ne-NP',
    academicCalendarType: 'annual',
    calendarSystem: 'bikram_sambat',
    schoolTypeDescriptor: 'Regular',
    gradeLevels: [
      'EarlyChildhoodDevelopment',
      'PrePrimaryClass',
      'Prekindergarten',
      'Kindergarten',
      'FirstGrade',
      'SecondGrade',
      'ThirdGrade',
      'FourthGrade',
      'FifthGrade',
      'SixthGrade',
      'SeventhGrade',
      'EighthGrade',
      'NinthGrade',
      'TenthGrade',
    ],
  };

  console.log(`POST ${BASE}/schools  (start=ECD, end=10)`);
  const created = await call('POST', '/schools', payload);
  check('POST /schools returns 2xx for ECD-starting school', ok2xx(created.status), {
    status: created.status,
    body: created.body,
  });
  if (!ok2xx(created.status)) {
    console.error('\nFAIL: pre-fix code path returns 400 with "Invalid enum value" on EarlyEducation.');
    process.exit(1);
  }

  const schoolId = created.body.schoolId as string | undefined;
  check('Response carries a schoolId', typeof schoolId === 'string' && schoolId.length > 0, schoolId);
  if (!schoolId) process.exit(1);

  const fetched = await call('GET', `/schools/${schoolId}`);
  check('GET /schools/{id} returns 2xx', ok2xx(fetched.status), fetched.status);

  const gradeLevels = (fetched.body.gradeLevels as string[] | undefined) ?? [];
  check(
    'Persisted gradeLevels contains EarlyChildhoodDevelopment',
    gradeLevels.includes('EarlyChildhoodDevelopment'),
    gradeLevels,
  );
  check(
    'Persisted gradeLevels contains PrePrimaryClass',
    gradeLevels.includes('PrePrimaryClass'),
    gradeLevels,
  );
  check(
    'Persisted gradeLevels has no duplicates',
    new Set(gradeLevels).size === gradeLevels.length,
    gradeLevels,
  );
  check(
    'Persisted gradeLevels does NOT contain the buggy "EarlyEducation" string',
    !gradeLevels.includes('EarlyEducation'),
    gradeLevels,
  );
  check(
    'EarlyChildhoodDevelopment appears before PrePrimaryClass (ordering preserved)',
    gradeLevels.indexOf('EarlyChildhoodDevelopment') < gradeLevels.indexOf('PrePrimaryClass'),
    gradeLevels,
  );

  console.log(`\nResult: ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length} checks)`}`);
  console.log(`schoolId=${schoolId}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('FATAL:', (e as Error)?.message ?? e);
  process.exit(1);
});

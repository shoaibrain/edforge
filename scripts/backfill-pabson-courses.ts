/// <reference types="node" />
/**
 * Sprint A.2.5 — Backfill PABSON CDC NCF 2076 Course catalog on a target school.
 *
 * Targets the dev-pabson-primary tenant by default (per CEO 2026-05-22: prod
 * Saraswati school has NO Course data yet; backfill scope is internal-dev only
 * in V1). Operator-led: dry-run shows the diff, operator reviews, --apply
 * writes via authenticated POST/PATCH against the prod API.
 *
 * **Architecture: Edge layer (per `a2-sprint-plan.md` §1.5).**
 *   - Catalog data lives in `@aibrains/shared-types` `archetype/pabson-courses.ts`.
 *   - This script instantiates Edge templates into Core Course rows via the API.
 *   - Service code is archetype-blind — it persists whatever the script POSTs.
 *
 * **Diff logic (per template in `PABSON_COURSE_CATALOG`):**
 *
 *   1. Compute `derivedSubjectArea` = deriveSubjectAreaFromAcademicSubject(
 *        template.academicSubject).
 *   2. Find existing courses where:
 *        (a) at least one `gradeLevels` value is in template.gradeLevels, AND
 *        (b) `subjectArea` === derivedSubjectArea
 *   3. Branch:
 *        - 0 matches → queue **CREATE**
 *        - 1 match, missing `academicSubject` → queue **PATCH** (3 new fields)
 *        - 1 match with academicSubject already populated → queue **SKIP**
 *        - >1 matches → queue **WARN** (operator manual disambiguation)
 *
 * **Idempotency:** re-running with --apply after a successful apply produces
 * an all-SKIP diff. Conditional via the diff classification, not via DDB
 * conditional writes (the API does that for us).
 *
 * **JWT handling:** never hand-paste JWT into shell heredocs (per memory
 * `feedback_just_ask_for_a_prod_token` — Cognito tokens contain signatures
 * that line-wrap badly in shells). Path-based via `JWT_FILE` (defaults to
 * `/tmp/dev-jwt.txt`). Script reads the file once at startup.
 *
 * Usage
 * =====
 *
 *   # Dry-run (default — no writes):
 *   TENANT_ID=21aea5da-... SCHOOL_ID=<uuid> \
 *   JWT_FILE=/tmp/dev-jwt.txt \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/backfill-pabson-courses.ts
 *
 *   # Apply (writes via authenticated API):
 *   APPLY=true TENANT_ID=21aea5da-... SCHOOL_ID=<uuid> \
 *   JWT_FILE=/tmp/dev-jwt.txt \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/backfill-pabson-courses.ts
 *
 * Env
 * ===
 *   TENANT_ID     required — target tenant UUID
 *   SCHOOL_ID     required — target school UUID
 *   JWT_FILE      optional — path to Cognito id-token (default /tmp/dev-jwt.txt)
 *   API_BASE_URL  optional — prod API GW base (default per smoke convention)
 *   APPLY         optional — set "true" to actually write; default dry-run
 *
 * Exit codes
 * ==========
 *   0 — clean (dry-run or apply finished with no errors)
 *   1 — one or more API errors during apply
 *   2 — config error (missing env / JWT file / network)
 */

import axios, { AxiosInstance } from 'axios';
import { readFileSync } from 'fs';
import {
  PABSON_COURSE_CATALOG,
  type PabsonCourseTemplate,
} from '@aibrains/shared-types';
import { deriveSubjectAreaFromAcademicSubject } from '../server/application/microservices/academics/src/courses/subject-area-mapper';

// ============================================================================
// Configuration
// ============================================================================

const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const JWT_FILE = process.env.JWT_FILE ?? '/tmp/dev-jwt.txt';
const API_BASE_URL =
  process.env.API_BASE_URL ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const APPLY = process.env.APPLY === 'true';

// ============================================================================
// Types — minimal projections of the Course shape we read
// ============================================================================

interface ExistingCourse {
  courseId: string;
  courseCode: string;
  courseName: string;
  gradeLevels: string[];
  subjectArea: string;
  academicSubject?: string;
  curriculumRef?: string;
  stateSubjectCode?: string;
}

interface DiffEntry {
  action: 'CREATE' | 'PATCH' | 'SKIP' | 'WARN';
  template: PabsonCourseTemplate;
  match?: ExistingCourse;
  matches?: ExistingCourse[]; // for WARN (multi-match)
  reason: string;
}

// ============================================================================
// HTTP client
// ============================================================================

function loadJwt(): string {
  let token: string;
  try {
    token = readFileSync(JWT_FILE, 'utf8').trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Cannot read JWT_FILE=${JWT_FILE}: ${msg}`);
    process.exit(2);
  }
  if (!token) {
    console.error(`✗ JWT_FILE=${JWT_FILE} is empty`);
    process.exit(2);
  }
  if (token.split('.').length !== 3) {
    console.error(`✗ JWT_FILE=${JWT_FILE} does not look like a JWT (expected 3 segments)`);
    process.exit(2);
  }
  return token;
}

function makeClient(): AxiosInstance {
  const token = loadJwt();
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    validateStatus: () => true, // we'll branch on status manually
  });
}

// ============================================================================
// Catalog → Course CREATE payload
// ============================================================================

/**
 * Synthesise a CreateCourseDto from a catalog template. Caller adds schoolId.
 *
 * Required Course fields not in template are defaulted:
 *   - credits: 1 (CDC default)
 *   - courseType: 'required' if isCompulsory else 'elective'
 *   - typicalDuration: 'year' (CDC default; SEE/BLE = year-long)
 */
function buildCreateDto(template: PabsonCourseTemplate) {
  return {
    courseCode: template.code,
    courseName: template.name,
    schoolId: SCHOOL_ID,
    gradeLevels: [...template.gradeLevels],
    credits: 1,
    subjectArea: deriveSubjectAreaFromAcademicSubject(template.academicSubject),
    courseType: template.isCompulsory ? 'required' : 'elective',
    typicalDuration: 'year' as const,
    // A.2.1 fields
    academicSubject: template.academicSubject,
    curriculumRef: template.curriculumRef,
    // stateSubjectCode left undefined (V1 best-guess scope)
  };
}

/**
 * PATCH payload to populate the 3 new fields on a matched legacy course.
 */
function buildPatchDto(template: PabsonCourseTemplate) {
  return {
    academicSubject: template.academicSubject,
    curriculumRef: template.curriculumRef,
    // stateSubjectCode left undefined
  };
}

// ============================================================================
// Diff computation
// ============================================================================

function gradeLevelsOverlap(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.some((g) => b.includes(g));
}

export function computeDiff(
  templates: ReadonlyArray<PabsonCourseTemplate>,
  existing: ReadonlyArray<ExistingCourse>,
): DiffEntry[] {
  const diff: DiffEntry[] = [];
  for (const template of templates) {
    const derivedSubjectArea = deriveSubjectAreaFromAcademicSubject(
      template.academicSubject,
    );
    const candidates = existing.filter(
      (c) =>
        gradeLevelsOverlap(c.gradeLevels ?? [], template.gradeLevels) &&
        c.subjectArea === derivedSubjectArea,
    );

    if (candidates.length === 0) {
      diff.push({
        action: 'CREATE',
        template,
        reason: `no existing course matches gradeLevels=${template.gradeLevels.join(',')} + subjectArea=${derivedSubjectArea}`,
      });
    } else if (candidates.length === 1) {
      const match = candidates[0];
      if (!match.academicSubject) {
        diff.push({
          action: 'PATCH',
          template,
          match,
          reason: `legacy course ${match.courseId} (${match.courseCode}) lacks academicSubject — patching`,
        });
      } else {
        diff.push({
          action: 'SKIP',
          template,
          match,
          reason: `course ${match.courseId} (${match.courseCode}) already has academicSubject=${match.academicSubject}`,
        });
      }
    } else {
      diff.push({
        action: 'WARN',
        template,
        matches: candidates,
        reason: `${candidates.length} existing courses match — operator must disambiguate manually`,
      });
    }
  }
  return diff;
}

// ============================================================================
// Pretty-print diff
// ============================================================================

function printDiff(diff: DiffEntry[]): void {
  const counts = { CREATE: 0, PATCH: 0, SKIP: 0, WARN: 0 };
  console.log('\nDiff (catalog vs existing):\n');
  for (const e of diff) {
    counts[e.action]++;
    const tag = ({ CREATE: '+', PATCH: '~', SKIP: '=', WARN: '!' } as const)[e.action];
    console.log(
      `  ${tag} ${e.action.padEnd(6)} ${e.template.code.padEnd(20)} ${e.template.name}`,
    );
    console.log(`    └─ ${e.reason}`);
    if (e.matches) {
      for (const m of e.matches) {
        console.log(`        - ${m.courseId} (${m.courseCode}) ${m.courseName}`);
      }
    }
  }
  console.log(
    `\nSummary: ${counts.CREATE} create, ${counts.PATCH} patch, ${counts.SKIP} skip, ${counts.WARN} warn.\n`,
  );
}

// ============================================================================
// API operations
// ============================================================================

async function listCourses(client: AxiosInstance): Promise<ExistingCourse[]> {
  // GET /academics/courses?schoolId=...  (rproxy strips /academics prefix
  // before forwarding to the service). Use pagination if needed.
  const courses: ExistingCourse[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ schoolId: SCHOOL_ID, limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const r = await client.get(`/academics/courses?${params.toString()}`);
    if (r.status !== 200) {
      console.error(`✗ list courses returned ${r.status}: ${JSON.stringify(r.data)}`);
      process.exit(2);
    }
    const items: ExistingCourse[] = r.data.items ?? [];
    courses.push(...items);
    cursor = r.data.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(r.data.lastEvaluatedKey)).toString('base64')
      : undefined;
  } while (cursor);
  return courses;
}

async function createCourse(
  client: AxiosInstance,
  template: PabsonCourseTemplate,
): Promise<{ ok: boolean; detail: unknown }> {
  const body = buildCreateDto(template);
  const r = await client.post('/academics/courses', body);
  return { ok: r.status >= 200 && r.status < 300, detail: { status: r.status, data: r.data } };
}

async function patchCourse(
  client: AxiosInstance,
  courseId: string,
  template: PabsonCourseTemplate,
): Promise<{ ok: boolean; detail: unknown }> {
  const body = buildPatchDto(template);
  const r = await client.patch(
    `/academics/courses/${encodeURIComponent(courseId)}?schoolId=${encodeURIComponent(SCHOOL_ID)}`,
    body,
  );
  return { ok: r.status >= 200 && r.status < 300, detail: { status: r.status, data: r.data } };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`=== Sprint A.2.5 — PABSON Course Catalog Backfill ===`);
  console.log(`Tenant: ${TENANT_ID || '(MISSING)'}`);
  console.log(`School: ${SCHOOL_ID || '(MISSING)'}`);
  console.log(`API:    ${API_BASE_URL}`);
  console.log(`Mode:   ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (read-only)'}\n`);

  if (!TENANT_ID || !SCHOOL_ID) {
    console.error('✗ TENANT_ID and SCHOOL_ID env vars are required');
    process.exit(2);
  }

  const client = makeClient();
  console.log('Fetching existing courses...');
  const existing = await listCourses(client);
  console.log(`Found ${existing.length} existing courses on school ${SCHOOL_ID}.`);
  console.log(`Catalog has ${PABSON_COURSE_CATALOG.length} templates (Grades 4-10).`);

  const diff = computeDiff(PABSON_COURSE_CATALOG, existing);
  printDiff(diff);

  if (!APPLY) {
    console.log('Dry-run complete. Re-run with APPLY=true to write.');
    process.exit(0);
  }

  // ===== Apply =====
  let creates = 0;
  let patches = 0;
  let errors = 0;
  for (const e of diff) {
    if (e.action === 'CREATE') {
      const r = await createCourse(client, e.template);
      if (r.ok) {
        creates++;
        console.log(`  + CREATE  ${e.template.code} OK`);
      } else {
        errors++;
        console.log(`  ✗ CREATE  ${e.template.code} FAIL`, r.detail);
      }
    } else if (e.action === 'PATCH' && e.match) {
      const r = await patchCourse(client, e.match.courseId, e.template);
      if (r.ok) {
        patches++;
        console.log(`  ~ PATCH   ${e.match.courseId} (${e.template.code}) OK`);
      } else {
        errors++;
        console.log(`  ✗ PATCH   ${e.match.courseId} FAIL`, r.detail);
      }
    }
  }

  console.log(
    `\nApply summary: ${creates} created, ${patches} patched, ${errors} errored.\n`,
  );

  if (errors > 0) {
    console.log('✗ One or more API errors. Inspect log and retry (script is idempotent).');
    process.exit(1);
  }
  console.log('✓ Backfill complete.');
  process.exit(0);
}

// Only run main when invoked directly; allow importing computeDiff in specs.
if (require.main === module) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('crash:', msg);
    process.exit(2);
  });
}

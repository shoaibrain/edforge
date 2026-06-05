/**
 * Read-only persistence audit — Course curriculum data quality (Phase 0 of the
 * curriculum-standardization work).
 *
 * WRITES NOTHING. Ground-truth before standardizing the course-create flow on
 * the PABSON catalog. It answers, from real persistence rather than the UI's
 * page-derived summary:
 *
 *   1. How many Course rows actually exist per school (the authoritative `total`
 *      the list endpoint never returns — see Phase 1).
 *   2. How many carry the standardization fields the catalog would populate but
 *      the free-text form never sends: `academicSubject` (granular subject),
 *      `curriculumRef` (curriculum track), `stateSubjectCode` (CDC/NEB code).
 *   3. Semantic-duplicate course codes — codes that collapse to the same value
 *      once canonicalized (`MATH101` / `MATH-101` / `math101`), which the
 *      per-school exact-match uniqueness check lets through.
 *   4. The four card numbers the Curriculum page header shows (total / distinct
 *      subjectAreas / electives / specialized), computed here from the FULL set
 *      so they can be compared against the UI's loaded-pages estimate.
 *
 * Single-table (academics). Scans COURSE rows; optionally scoped to one tenant
 * or school. Tenant/school are printed by id (pass --tenant to focus on the
 * pilot); names live in the identity table and are intentionally not joined to
 * keep this audit single-table and bulletproof.
 *
 * Usage:
 *   AWS_PROFILE=prod npx ts-node scripts/audit-pabson-courses.ts
 *   AWS_PROFILE=prod npx ts-node scripts/audit-pabson-courses.ts --tenant <tenantId>
 *   AWS_PROFILE=prod npx ts-node scripts/audit-pabson-courses.ts --tenant <tid> --school <sid>
 *
 *   Env: AWS creds via your shell/profile; AWS_REGION (default ap-south-1);
 *        ACADEMICS_TABLE (default edforge-academics-basic).
 *
 * Per the deploy-log convention, tee output to
 *   docs/deploys/prod-audit-pabson-courses-<TS>.log
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const TABLE = process.env.ACADEMICS_TABLE ?? 'edforge-academics-basic';

const tenantArgIdx = process.argv.indexOf('--tenant');
const TENANT_FILTER = tenantArgIdx >= 0 ? process.argv[tenantArgIdx + 1] : undefined;
const schoolArgIdx = process.argv.indexOf('--school');
const SCHOOL_FILTER = schoolArgIdx >= 0 ? process.argv[schoolArgIdx + 1] : undefined;

// A flag with no value (or followed by another flag) must error, not silently
// fall back to an unfiltered full-table audit.
if (tenantArgIdx >= 0 && (!TENANT_FILTER || TENANT_FILTER.startsWith('--'))) {
  console.error('Missing value for --tenant');
  process.exit(1);
}
if (schoolArgIdx >= 0 && (!SCHOOL_FILTER || SCHOOL_FILTER.startsWith('--'))) {
  console.error('Missing value for --school');
  process.exit(1);
}

/** Course types that count as "specialized" in the Curriculum header card. */
const SPECIALIZED_TYPES = new Set(['honors', 'ap', 'ib', 'dual_enrollment']);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

interface CourseRow {
  tenantId?: string;
  entityKey?: string;
  courseId?: string;
  schoolId?: string;
  courseCode?: string;
  courseName?: string;
  subjectArea?: string;
  academicSubject?: string;
  stateSubjectCode?: string;
  curriculumRef?: string;
  courseType?: string;
  gradeLevels?: string[];
  isActive?: boolean;
}

/** Canonical form for duplicate detection: upper-case, strip non-alphanumerics. */
function canonicalCode(code: string | undefined): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function scanCourses(): Promise<CourseRow[]> {
  const out: CourseRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  const names: Record<string, string> = { '#et': 'entityType' };
  const values: Record<string, unknown> = { ':c': 'COURSE' };
  let filter = '#et = :c';
  if (TENANT_FILTER) {
    filter += ' AND tenantId = :tid';
    values[':tid'] = TENANT_FILTER;
  }
  if (SCHOOL_FILTER) {
    filter += ' AND schoolId = :sid';
    values[':sid'] = SCHOOL_FILTER;
  }
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: filter,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ProjectionExpression:
          'tenantId, entityKey, courseId, schoolId, courseCode, courseName, ' +
          'subjectArea, academicSubject, stateSubjectCode, curriculumRef, ' +
          'courseType, gradeLevels, isActive',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) out.push(it as CourseRow);
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

interface SchoolStats {
  total: number;
  missingAcademicSubject: number;
  missingCurriculumRef: number;
  missingStateSubjectCode: number;
  subjectAreas: Set<string>;
  electives: number;
  specialized: number;
  emptyOrMissingGradeLevels: number;
  codeGroups: Map<string, CourseRow[]>; // canonical code -> rows
}

function emptyStats(): SchoolStats {
  return {
    total: 0,
    missingAcademicSubject: 0,
    missingCurriculumRef: 0,
    missingStateSubjectCode: 0,
    subjectAreas: new Set(),
    electives: 0,
    specialized: 0,
    emptyOrMissingGradeLevels: 0,
    codeGroups: new Map(),
  };
}

function fold(stats: SchoolStats, c: CourseRow): void {
  stats.total++;
  if (!c.academicSubject) stats.missingAcademicSubject++;
  if (!c.curriculumRef) stats.missingCurriculumRef++;
  if (!c.stateSubjectCode) stats.missingStateSubjectCode++;
  if (c.subjectArea) stats.subjectAreas.add(c.subjectArea);
  if (c.courseType === 'elective') stats.electives++;
  if (c.courseType && SPECIALIZED_TYPES.has(c.courseType)) stats.specialized++;
  if (!Array.isArray(c.gradeLevels) || c.gradeLevels.length === 0) stats.emptyOrMissingGradeLevels++;
  // Skip blank codes: they all canonicalize to '' and would otherwise be
  // reported as one big false "duplicate" group.
  const key = canonicalCode(c.courseCode);
  if (key) {
    const group = stats.codeGroups.get(key) ?? [];
    group.push(c);
    stats.codeGroups.set(key, group);
  }
}

function printSchool(tenantId: string, schoolId: string, stats: SchoolStats): void {
  console.log(`   • school ${schoolId}`);
  console.log(
    `       TOTAL courses (authoritative) = ${stats.total}  ·  ` +
      `subjectAreas=${stats.subjectAreas.size}  ·  electives=${stats.electives}  ·  ` +
      `specialized=${stats.specialized}`,
  );
  console.log(
    `       standardization gaps:  ` +
      `no academicSubject=${stats.missingAcademicSubject}/${stats.total}  ·  ` +
      `no curriculumRef=${stats.missingCurriculumRef}/${stats.total}  ·  ` +
      `no stateSubjectCode=${stats.missingStateSubjectCode}/${stats.total}`,
  );
  if (stats.emptyOrMissingGradeLevels > 0) {
    console.log(`       ⚠️ ${stats.emptyOrMissingGradeLevels} course(s) with empty/missing gradeLevels`);
  }
  const dupes = [...stats.codeGroups.entries()].filter(([, rows]) => rows.length > 1);
  if (dupes.length > 0) {
    console.log(`       ⚠️ ${dupes.length} canonical-code collision group(s) (semantic duplicates):`);
    for (const [canon, rows] of dupes) {
      const raws = rows.map((r) => `${r.courseCode ?? '?'} (${r.courseId ?? '?'})`).join(', ');
      console.log(`           [${canon}] → ${raws}`);
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log(
    `\n🔎 Course curriculum audit (READ-ONLY) — table=${TABLE} region=${REGION}` +
      (TENANT_FILTER ? ` tenant=${TENANT_FILTER}` : '') +
      (SCHOOL_FILTER ? ` school=${SCHOOL_FILTER}` : '') +
      `\n`,
  );

  const courses = await scanCourses();
  if (courses.length === 0) {
    console.log('No COURSE rows in scope. (Check ACADEMICS_TABLE / --tenant.)\n');
    return;
  }

  // tenantId -> schoolId -> stats
  const byTenant = new Map<string, Map<string, SchoolStats>>();
  for (const c of courses) {
    const tid = c.tenantId ?? '?';
    const sid = c.schoolId ?? '?';
    const schools = byTenant.get(tid) ?? new Map<string, SchoolStats>();
    const stats = schools.get(sid) ?? emptyStats();
    fold(stats, c);
    schools.set(sid, stats);
    byTenant.set(tid, schools);
  }

  let grandTotal = 0;
  let grandMissingSubject = 0;
  let grandDupeGroups = 0;
  for (const [tid, schools] of byTenant) {
    console.log(`━━ tenant ${tid}`);
    for (const [sid, stats] of schools) {
      printSchool(tid, sid, stats);
      grandTotal += stats.total;
      grandMissingSubject += stats.missingAcademicSubject;
      grandDupeGroups += [...stats.codeGroups.values()].filter((r) => r.length > 1).length;
    }
  }

  console.log('────────────────────────────────────────────────────────');
  console.log(
    `📊 ${byTenant.size} tenant(s) · ${grandTotal} course(s) · ` +
      `${grandMissingSubject} without academicSubject · ` +
      `${grandDupeGroups} canonical-code collision group(s).`,
  );
  console.log('This audit wrote nothing. Use it to scope the standardization + backfill.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

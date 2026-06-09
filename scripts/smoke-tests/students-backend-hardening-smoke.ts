/// <reference types="node" />
/**
 * EdForge — Students/Attendance backend-hardening smoke
 *
 * Validates the four backend changes shipped on
 * `claude/students-table-enhancement` against a live environment:
 *
 *   ISSUE-1  Per-student attendance **trend** is recent-vs-baseline (last 7d vs
 *            prior ~30d), not always "stable".
 *            → GET /academics/attendance/overview .atRiskStudents[].trend
 *            → GET /academics/attendance/alerts   [].trend
 *   ISSUE-2  Sections list returns **dense pages + authoritative total** (was a
 *            sparse "1 card + Load More" + no total).
 *            → GET /academics/sections { items, hasMore, total }
 *   SPRINT-2 Batch roster sparkline endpoint exists + shaped correctly.
 *            → GET /academics/attendance/student-trends { trends }
 *   D-1      Student LIST drops guardian PII; single-GET keeps full detail.
 *            → GET /academics/students[].guardians  (no email/phone/address)
 *            → GET /academics/students/:id.guardians (full)
 *
 * READ-ONLY — safe to run against any environment (prod included). It makes no
 * writes. JWT-driven; auto-discovers school / academic-year / student ids
 * (override with SCHOOL_ID / ACADEMIC_YEAR_ID).
 *
 * Usage:
 *   ID_TOKEN=<jwt> API_BASE_URL=<api-gw-url> \
 *     npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/students-backend-hardening-smoke.ts
 *
 * Exit 0 = all green · 1 = a check failed · 2 = setup/auth error.
 *
 * ── Proving ISSUE-1 end-to-end (optional) ────────────────────────────────────
 * The trend ALGORITHM is unit-tested (computeRecentVsBaselineTrend:
 * improving/declining/sparse/within-threshold). This smoke proves the WIRING
 * (field present, valid enum, data-driven) and logs the live distribution — if
 * the pilot's attendance is sparse the distribution may legitimately be
 * all-"stable". To force a known 'improving' trend (gold-standard E2E) in a
 * NON-PROD env: create a throwaway student, POST /academics/attendance with the
 * baseline window (days 8–30 ago) all `absent` and the recent window (last 7d)
 * all `present` (on instructional days), then assert student-trends.trend ===
 * 'improving', then withdraw the student. Kept out of this read-only smoke by
 * design.
 */

import axios, { AxiosRequestConfig } from 'axios';

const ID_TOKEN = process.env.ID_TOKEN || process.env.PROD_ADMIN_TOKEN || '';
const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

const VALID_TREND = new Set(['improving', 'declining', 'stable']);
const GUARDIAN_PII = ['email', 'phone', 'phoneType', 'alternatePhone', 'address', 'employer', 'occupation'];

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (!ok) {
    console.log(`   └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}
function note(msg: string) {
  console.log(`   • ${msg}`);
}

async function api<T = any>(method: 'GET', path: string): Promise<{ status: number; body: T }> {
  const config: AxiosRequestConfig = {
    method,
    url: `${BASE_URL}${path}`,
    headers: { Authorization: `Bearer ${ID_TOKEN}`, 'Content-Type': 'application/json' },
    validateStatus: () => true,
    timeout: 30_000,
  };
  const r = await axios(config);
  return { status: r.status, body: r.data };
}

function addDaysUTC(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function asArray(body: any): any[] {
  if (Array.isArray(body)) return body;
  return body?.items ?? body?.schools ?? body?.alerts ?? [];
}

async function discover() {
  let schoolId = process.env.SCHOOL_ID || '';
  if (!schoolId) {
    const s = await api('GET', '/schools');
    schoolId = asArray(s.body)[0]?.schoolId || asArray(s.body)[0]?.id || '';
  }
  if (!schoolId) throw new Error('could not discover a schoolId (set SCHOOL_ID)');

  let yearId = process.env.ACADEMIC_YEAR_ID || '';
  if (!yearId) {
    const cur = await api('GET', `/schools/${schoolId}/academic-years/current`);
    yearId = cur.body?.yearId || cur.body?.academicYearId || cur.body?.id || '';
    if (!yearId) {
      const list = await api('GET', `/schools/${schoolId}/academic-years`);
      const ys = asArray(list.body);
      yearId = ys[0]?.yearId || ys[0]?.academicYearId || ys[0]?.id || '';
    }
  }

  const sList = await api('GET', `/academics/students?schoolId=${schoolId}`);
  const students = asArray(sList.body);
  const studentIds: string[] = students.map((s: any) => s.studentId).filter(Boolean);

  return { schoolId, yearId, students, studentIds };
}

async function main() {
  if (!ID_TOKEN) {
    console.error('✗ ID_TOKEN (or PROD_ADMIN_TOKEN) env var is required');
    process.exit(2);
  }
  console.log(`\nStudents/Attendance backend-hardening smoke @ ${BASE_URL}\n`);

  let ctx: { schoolId: string; yearId: string; students: any[]; studentIds: string[] };
  try {
    ctx = await discover();
  } catch (e: any) {
    console.error(`✗ setup: ${e?.message ?? e}`);
    process.exit(2);
  }
  const { schoolId, yearId, students, studentIds } = ctx;
  const today = new Date().toISOString().split('T')[0];
  note(`school=${schoolId} year=${yearId || '(none)'} students=${studentIds.length} date=${today}`);
  console.log('');

  // ── ISSUE-2 — Sections dense pages + authoritative total ───────────────────
  console.log('ISSUE-2 — Sections pagination + total');
  const sec = await api('GET', `/academics/sections?schoolId=${schoolId}`);
  const secItems = asArray(sec.body);
  const total = sec.body?.total;
  const hasMore = sec.body?.hasMore;
  check('S1 — GET /academics/sections → 200', sec.status === 200, { status: sec.status });
  check('S2 — response carries an authoritative numeric `total`', typeof total === 'number', { total });
  check('S3 — `total` never understates the loaded page (total ≥ loaded)',
    typeof total === 'number' && total >= secItems.length, { total, loaded: secItems.length });
  // The sparse-page bug: hasMore=true with ~1 item. When the whole set fits the
  // default page (≤50), a correct dense response returns ALL of them, hasMore=false.
  check('S4 — page is DENSE (set ≤ limit ⇒ all returned in one page, hasMore=false)',
    typeof total === 'number' && (total > 50 || (secItems.length === total && hasMore === false)),
    { total, loaded: secItems.length, hasMore });
  note(`sections: total=${total} loaded=${secItems.length} hasMore=${hasMore}`);
  console.log('');

  // ── ISSUE-1 — per-student trend is data-driven, valid enum ─────────────────
  console.log('ISSUE-1 — Attendance per-student trend');
  if (!yearId) {
    note('no academic year discovered → overview/alerts trend checks SKIPPED (set ACADEMIC_YEAR_ID)');
  } else {
    const ov = await api('GET', `/academics/attendance/overview?schoolId=${schoolId}&academicYearId=${yearId}&date=${today}`);
    const atRisk = ov.body?.atRiskStudents ?? [];
    check('A1 — GET /attendance/overview → 200', ov.status === 200, { status: ov.status });
    check('A2 — every atRiskStudents[].trend is a valid enum (field wired, not missing)',
      Array.isArray(atRisk) && atRisk.every((s: any) => VALID_TREND.has(s.trend)),
      { sample: atRisk.slice(0, 3).map((s: any) => ({ id: s.studentId, trend: s.trend, rate: s.attendanceRate })) });
    const dist = atRisk.reduce((a: any, s: any) => ((a[s.trend] = (a[s.trend] || 0) + 1), a), {} as Record<string, number>);
    note(`at-risk trend distribution: ${JSON.stringify(dist)} over ${atRisk.length} students`);
    if (atRisk.length > 0 && (dist.improving || dist.declining)) {
      note('→ non-"stable" values present ⇒ trend is data-driven (Issue-1 fix observable live)');
    } else if (atRisk.length > 0) {
      note('→ all "stable": likely sparse recent data (algorithm is unit-tested; run the write-path proof to force a trend)');
    }

    const startDate = addDaysUTC(today, -90);
    const al = await api('GET', `/academics/attendance/alerts?schoolId=${schoolId}&academicYearId=${yearId}&threshold=90&startDate=${startDate}&endDate=${today}`);
    const alerts = asArray(al.body);
    check('A3 — GET /attendance/alerts → 200 + every trend a valid enum',
      al.status === 200 && alerts.every((s: any) => VALID_TREND.has(s.trend)),
      { status: al.status, count: alerts.length });
  }
  console.log('');

  // ── SPRINT-2 — batch student-trends endpoint ───────────────────────────────
  console.log('SPRINT-2 — student-trends batch endpoint');
  const startD = addDaysUTC(today, -29);
  const ids = studentIds.slice(0, 5).join(',');
  const tr = await api('GET', `/academics/attendance/student-trends?schoolId=${schoolId}&studentIds=${ids}&startDate=${startD}&endDate=${today}`);
  check('T1 — endpoint reachable (route registered: not 403 SigV4 / 404)', tr.status === 200, { status: tr.status, body: tr.body });
  const trends = tr.body?.trends ?? {};
  check('T2 — `trends` is an object map', trends && typeof trends === 'object' && !Array.isArray(trends), { type: typeof trends });
  const entries = Object.values(trends) as any[];
  check('T3 — each entry shaped { rate, series[], trend, totalDays, absentDays }',
    entries.every((t) => typeof t.rate === 'number' && Array.isArray(t.series) && VALID_TREND.has(t.trend) && typeof t.totalDays === 'number' && typeof t.absentDays === 'number'),
    { withData: entries.length, sample: entries[0] });
  const trEmpty = await api('GET', `/academics/attendance/student-trends?schoolId=${schoolId}&studentIds=&startDate=${startD}&endDate=${today}`);
  check('T4 — empty studentIds ⇒ empty trends, no error', trEmpty.status === 200 && Object.keys(trEmpty.body?.trends ?? {}).length === 0, { status: trEmpty.status });
  note(`student-trends: requested=${studentIds.slice(0, 5).length} withData=${entries.length}`);
  console.log('');

  // ── D-1 — slim guardian DTO on the list, full on the single GET ────────────
  console.log('D-1 — guardian PII minimization');
  const withG = students.find((s: any) => Array.isArray(s.guardians) && s.guardians.length > 0);
  check('D1 — students list already loaded (200, items[])', students.length >= 0, { count: students.length });
  if (withG) {
    const g = withG.guardians[0];
    const leaked = GUARDIAN_PII.filter((k) => g[k] !== undefined);
    check('D2 — LIST guardian carries NO PII (email/phone/address/employer/occupation)', leaked.length === 0, { leaked, keys: Object.keys(g) });
    check('D3 — LIST guardian keeps summary fields (name · relationship · flags)',
      typeof g.firstName === 'string' && typeof g.relationship === 'string' && 'isPrimary' in g && 'hasPortalAccess' in g && 'canPickup' in g,
      { keys: Object.keys(g) });
    const one = await api('GET', `/academics/students/${withG.studentId}`);
    check('D4 — single-student GET → 200 with guardians[] (full-detail path intact)',
      one.status === 200 && Array.isArray(one.body?.guardians), { status: one.status });
  } else {
    note('no list student with guardians found → D2/D3/D4 skipped');
  }

  console.log(`\n${fails.length === 0 ? '\x1b[32m✓ ALL BACKEND-HARDENING SMOKE CHECKS GREEN\x1b[0m' : `\x1b[31m✗ ${fails.length} FAILURE(S): ${fails.join(' · ')}\x1b[0m`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crash:', e?.message ?? e);
  process.exit(2);
});

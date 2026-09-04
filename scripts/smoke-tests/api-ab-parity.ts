/// <reference types="node" />
/**
 * Cost-redesign C4.1 — API-A / API-B parity.
 *
 * Sends the same read-only requests to both REST APIs with one bearer token and
 * compares status, content type and body (canonical JSON, a short allow-list of
 * volatile keys removed). Nothing is written. Latency per API is recorded so the
 * run doubles as a before/after measurement.
 *
 *   ID_TOKEN=... API_A_URL=https://<api-a>/prod API_B_URL=https://<api-b>/prod \
 *   [SCHOOL_ID=...] [ROUTES=/users/me,/schools] npx tsx scripts/smoke-tests/api-ab-parity.ts
 *
 * Exit 0 when every route answers identically on both APIs; 1 otherwise. A route
 * that fails identically on both (same 4xx and body) is parity, not failure — the
 * summary line says how many routes answered 2xx so an all-4xx run is visible.
 */

const token = process.env.ID_TOKEN ?? '';
const apiA = (process.env.API_A_URL ?? '').replace(/\/$/, '');
const apiB = (process.env.API_B_URL ?? '').replace(/\/$/, '');

/** Keys whose values legitimately differ between two reads or two backends. */
const VOLATILE_KEYS = new Set(['requestId', 'traceId', 'generatedAt', 'serverTime', 'cachedAt', 'responseTime']);

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((k) => !VOLATILE_KEYS.has(k))
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** First differing JSON path between two canonical values, or null when equal. */
export function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    const missing = ka.filter((k) => !kb.includes(k)).concat(kb.filter((k) => !ka.includes(k)));
    if (missing.length) return `${path} keys differ: ${missing.join(', ')}`;
    for (const k of ka) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

function routesFor(schoolId: string | undefined): string[] {
  const s = schoolId ?? '';
  const tenantWide = [
    '/users/me',
    '/users/me/permissions',
    '/tenants/my/settings',
    '/schools',
    '/school-years/current',
    '/staff',
    '/users',
    '/archetype-defaults',
    '/holiday-seeds',
  ];
  const perSchool = s
    ? [
        `/schools/${s}`,
        `/schools/${s}/academic-years`,
        `/schools/${s}/academic-years/current`,
        `/schools/${s}/configuration`,
        `/schools/${s}/branding`,
        `/schools/${s}/staff`,
        `/schools/${s}/calendars`,
        `/academics/students?schoolId=${s}&limit=20`,
        `/academics/sections?schoolId=${s}`,
        `/academics/courses?schoolId=${s}`,
        `/academics/enrollments?schoolId=${s}&limit=20`,
        `/academics/exams?schoolId=${s}`,
        `/academics/grading-policies?schoolId=${s}`,
        `/academics/dashboard/overview?schoolId=${s}`,
        `/finance/schools/${s}/fee-structures`,
        `/finance/schools/${s}/invoices?limit=20`,
        `/finance/schools/${s}/payments?limit=20`,
        `/finance/schools/${s}/student-accounts`,
        `/finance/schools/${s}/dashboard/summary`,
        `/finance/schools/${s}/discount-rules`,
        `/finance/schools/${s}/payment-gateways`,
      ]
    : [];
  return [...tenantWide, ...perSchool];
}

interface Answer { status: number; type: string; body: string; ms: number }

async function get(base: string, route: string): Promise<Answer> {
  const t0 = Date.now();
  const res = await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await res.text();
  return { status: res.status, type: (res.headers.get('content-type') ?? '').split(';')[0], body, ms: Date.now() - t0 };
}

function compare(a: Answer, b: Answer): string | null {
  if (a.status !== b.status) return `status ${a.status} vs ${b.status}`;
  if (a.type !== b.type) return `content-type ${a.type} vs ${b.type}`;
  if (a.type === 'application/json') {
    let ja: unknown;
    let jb: unknown;
    try { ja = JSON.parse(a.body); jb = JSON.parse(b.body); } catch { return 'unparseable JSON on one side'; }
    return firstDifference(canonical(ja), canonical(jb));
  }
  return a.body === b.body ? null : `body differs (${a.body.length} vs ${b.body.length} bytes)`;
}

function p50(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
}

async function main(): Promise<void> {
  if (!token || !apiA || !apiB) {
    console.error('ID_TOKEN, API_A_URL and API_B_URL are required');
    process.exit(2);
  }
  let schoolId = process.env.SCHOOL_ID;
  if (!schoolId) {
    const first = await get(apiB, '/schools');
    try {
      const parsed = JSON.parse(first.body) as { items?: { schoolId?: string; id?: string }[] } | { schoolId?: string; id?: string }[];
      const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
      schoolId = items[0]?.schoolId ?? items[0]?.id;
    } catch { /* no school: tenant-wide routes only */ }
  }
  const routes = process.env.ROUTES ? process.env.ROUTES.split(',').map((r) => r.trim()).filter(Boolean) : routesFor(schoolId);

  const failures: string[] = [];
  const msA: number[] = [];
  const msB: number[] = [];
  let ok2xx = 0;
  for (const route of routes) {
    const [a, b] = await Promise.all([get(apiA, route), get(apiB, route)]);
    msA.push(a.ms);
    msB.push(b.ms);
    const diff = compare(a, b);
    if (a.status < 300) ok2xx++;
    const shown = route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
    console.log(`${diff ? '✗' : '✓'} ${String(a.status).padEnd(3)} A ${String(a.ms).padStart(5)} ms  B ${String(b.ms).padStart(5)} ms  ${shown}${diff ? `\n    └─ ${diff}` : ''}`);
    if (diff) failures.push(`${shown}: ${diff}`);
  }
  console.log(`\n${routes.length} routes, ${ok2xx} answered 2xx, ${failures.length} differ; latency p50 A ${p50(msA)} ms / B ${p50(msB)} ms`);
  process.exit(failures.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

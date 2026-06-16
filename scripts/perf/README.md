# Attendance perf harness — Sprint 1 / S1.T4 (AC verification)

Verifies the **already-shipped** bulk-scan for the two heaviest attendance reads
holds its p95 targets at pilot scale. This is **not** a CI gate — it runs with
[k6](https://k6.io) against a deployed, seeded environment.

> The repo ignores all `.js` (TypeScript-everywhere; see root `.gitignore`), so
> the k6 script lives here as a snippet. Copy it into a local
> `scripts/perf/attendance-perf.k6.js` (gitignored) to run.

## Acceptance criteria

From [`docs/pilot-greenlight/c3-1-attendance-perf-diagnosis.md` §6](../../docs/pilot-greenlight/c3-1-attendance-perf-diagnosis.md):

| Endpoint | Target | Scale |
|---|---|---|
| `GET /academics/attendance/alerts` | p95 < **500ms** | ~1,000 active students |
| `GET /academics/attendance/overview` | p95 < **1s** | ~1,000 students × ~30 sections |

## Prepare data

Seed a ~1,000-student school first (idempotent):

```bash
TABLE_NAME=edforge-academics-basic \
TENANT_ID=<tid> SCHOOL_ID=<sid> ACADEMIC_YEAR_ID=<ayid> \
START_DATE=2026-03-01 END_DATE=2026-06-16 \
npx ts-node scripts/seed-attendance.ts
```

## Run

```bash
k6 run \
  -e BASE_URL=https://<tenant-host> \
  -e TOKEN=<cognito-jwt> \
  -e SCHOOL_ID=<sid> \
  -e ACADEMIC_YEAR_ID=<ayid> \
  scripts/perf/attendance-perf.k6.js
```

Capture the per-endpoint p95 summary into `docs/deploys/` per CLAUDE.md.

## k6 script

```js
import http from 'k6/http';
import { check, group } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const TOKEN = __ENV.TOKEN;
const SCHOOL_ID = __ENV.SCHOOL_ID;
const ACADEMIC_YEAR_ID = __ENV.ACADEMIC_YEAR_ID;

export const options = {
  scenarios: {
    dashboards: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{endpoint:alerts}': ['p(95)<500'],
    'http_req_duration{endpoint:overview}': ['p(95)<1000'],
    'http_req_failed': ['rate<0.01'],
  },
};

function authGet(path, tags) {
  return http.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    tags,
  });
}

export default function () {
  const yearQ = ACADEMIC_YEAR_ID ? `&academicYearId=${ACADEMIC_YEAR_ID}` : '';

  group('alerts', () => {
    const res = authGet(`/api/academics/attendance/alerts?schoolId=${SCHOOL_ID}${yearQ}`, { endpoint: 'alerts' });
    check(res, { 'alerts 200': (r) => r.status === 200 });
  });

  group('overview', () => {
    const res = authGet(`/api/academics/attendance/overview?schoolId=${SCHOOL_ID}${yearQ}`, { endpoint: 'overview' });
    check(res, { 'overview 200': (r) => r.status === 200 });
  });
}
```

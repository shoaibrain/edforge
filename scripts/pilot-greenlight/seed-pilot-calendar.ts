/// <reference types="node" />
/**
 * Pilot calendar seed — operator helper.
 *
 * Re-generates the calendar for a school's active AY using the pilot
 * fixture's canonical holiday set, instead of the backend's locale-default
 * holiday list (`server/application/microservices/identity/src/data/holidays/`).
 *
 * Context (Sprint C2.1)
 * =====================
 * The C2.1 instructional-days read-path smoke surfaced a divergence between
 * the pilot fixture's holidays-consolidated dossier and the backend's seed:
 * the backend's NPL locale defaults include extra Hindu festivals (Janai
 * Purnima, Gaijatra, Krishna Janmashtami, expanded Dashain) that Pabson
 * Saraswati does NOT observe per the dossier. This script reseeds the
 * backend with the dossier-canonical set so C2.1 passes.
 *
 * Why a script (and not a backend code change)
 * --------------------------------------------
 * `POST /schools/:id/academic-years/:yearId/generate-calendar` already
 * accepts `dto.holidays` from the caller — the AdminWeb UI's "Generate"
 * button just happens to default to the locale-default list. We don't
 * need to change the backend; we just need to call the existing endpoint
 * with the right `dto.holidays`.
 *
 * The eventual C3.2 backend work (make `generate-calendar` consume the
 * pilot fixture by default) becomes a future enhancement, not a blocker.
 *
 * Pilot-agnostic per invariant 13: `PILOT_ID` is required env-var; no
 * default. Works for any registered pilot fixture.
 *
 * What it does
 * ============
 * 1. Load the pilot fixture via `@edforge/pilot-fixtures`
 * 2. Expand the fixture's `holidaysConsolidated` to per-day entries (block
 *    days + single-day holidays)
 * 3. Convert each BS date → AD via shared-types
 * 4. Map fixture weekday tokens (`sun..sat`) → backend tokens (`sunday..`)
 * 5. Map category (`national | religious | school_specific`) → backend
 *    eventType (`holiday` for national/religious; `break` for school-specific
 *    vacation blocks)
 * 6. POST the request and print results
 *
 * Side-effects
 * ============
 * Backend `generateCalendar` DELETES existing CalendarDate rows for the AY
 * before re-generating. Idempotent in the sense that re-running produces
 * the same final state, but in-flight read traffic against the AY's
 * CalendarDate rows will briefly see "no rows" during regeneration.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   export PILOT_ID=pabson-saraswati-bs-2083
 *   export TENANT_ID=<dev tenant uuid>
 *   export SCHOOL_ID=<school uuid in the tenant>
 *   export ACADEMIC_YEAR_ID=<active AY uuid>
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/pilot-greenlight/seed-pilot-calendar.ts
 *
 *   # Then re-run C2.1 — expect ✓
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-greenlight-c2-1.ts
 */

import * as fs from 'fs';
import axios from 'axios';

import {
  loadPilotFixture,
  expandHolidays,
  type HolidayCategory,
  type WeekdayToken,
} from '@edforge/pilot-fixtures';
import { bsToGregorian } from '@aibrains/shared-types';

// ── config ─────────────────────────────────────────────────────────────────

const PILOT_ID = process.env.PILOT_ID ?? '';
const JWT_FILE = process.env.JWT_FILE ?? '/private/tmp/c0-c-3-prod-jwt.txt';

const RAW_TOKEN = fs.existsSync(JWT_FILE)
  ? fs.readFileSync(JWT_FILE, 'utf8').replace(/[\n\r ]+/g, '')
  : '';
const TOKEN = RAW_TOKEN.startsWith('Bearer ') ? RAW_TOKEN : `Bearer ${RAW_TOKEN}`;

const BASE =
  process.env.API_BASE ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID ?? '';

// Optional dry-run: print what we'd POST without actually calling.
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

// ── env validation ─────────────────────────────────────────────────────────

const required = {
  PILOT_ID,
  ADMIN_TOKEN: RAW_TOKEN,
  TENANT_ID,
  SCHOOL_ID,
  ACADEMIC_YEAR_ID,
};
for (const [k, v] of Object.entries(required)) {
  if (!v) {
    console.error(`Missing required: ${k}`);
    if (k === 'ADMIN_TOKEN') {
      console.error(
        `  — JWT file not found or empty at ${JWT_FILE}. ` +
          `Operator: place a fresh prod TenantAdmin JWT there.`,
      );
    }
    if (k === 'PILOT_ID') {
      console.error(`  — e.g. PILOT_ID=pabson-saraswati-bs-2083`);
    }
    process.exit(2);
  }
}

// ── mappers ────────────────────────────────────────────────────────────────

const WEEKDAY_FIXTURE_TO_BACKEND: Record<WeekdayToken, string> = {
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};

/**
 * Map fixture holiday category → backend CalendarEventDescriptor.
 *
 * `school_specific` covers school-curated vacation blocks (summer break,
 * winter break) — these are `break` in the backend taxonomy.
 *
 * `national` + `religious` are public holidays — `holiday` in the backend.
 */
function categoryToEventType(c: HolidayCategory): 'holiday' | 'break' {
  return c === 'school_specific' ? 'break' : 'holiday';
}

function bsToAd(bsDate: string): string {
  const [y, m, d] = bsDate.split('/').map(Number);
  return bsToGregorian(y, m, d);
}

// ── http ───────────────────────────────────────────────────────────────────

async function postGenerateCalendar(dto: object): Promise<{
  status: number;
  body: any;
}> {
  const url =
    `${BASE}/schools/${SCHOOL_ID}/academic-years/${ACADEMIC_YEAR_ID}` +
    `/generate-calendar`;
  const r = await axios({
    method: 'POST',
    url,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    data: dto,
    validateStatus: () => true,
    timeout: 60_000,
  });
  return { status: r.status, body: r.data };
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Pilot calendar seed`);
  console.log(`  pilot:   ${PILOT_ID}`);
  console.log(`  base:    ${BASE}`);
  console.log(`  tenant:  ${TENANT_ID}`);
  console.log(`  school:  ${SCHOOL_ID}`);
  console.log(`  ayId:    ${ACADEMIC_YEAR_ID}`);
  console.log(`  dry-run: ${DRY_RUN}`);
  console.log('');

  // 1. Load fixture
  console.log('── 1. Load fixture ────────────────────────');
  const fixture = loadPilotFixture(PILOT_ID);
  console.log(
    `   ✓ ${fixture.metadata.archetype} fixture; AY ${fixture.academicStructure.academicYearId}` +
      ` (${fixture.academicStructure.startBsDate} → ${fixture.academicStructure.endBsDate})`,
  );

  // 2. AY start/end → AD
  const ayStartBs = fixture.academicStructure.startBsDate;
  const ayEndBs = fixture.academicStructure.endBsDate;
  const ayStartAd = bsToAd(ayStartBs);
  const ayEndAd = bsToAd(ayEndBs);
  console.log(`   ✓ AY AD window: ${ayStartAd} → ${ayEndAd}`);

  // 3. Holidays → per-day { date, name, eventType }
  console.log('');
  console.log('── 2. Build holidays array ────────────────');
  const expanded = expandHolidays(fixture);
  const holidays = expanded.map((h) => ({
    date: bsToAd(h.bsDate),
    name: h.name,
    eventType: categoryToEventType(h.category),
  }));
  // Stats by eventType
  const byType = holidays.reduce<Record<string, number>>((acc, h) => {
    acc[h.eventType] = (acc[h.eventType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`   ✓ ${holidays.length} holiday-day entries`);
  for (const [t, n] of Object.entries(byType)) {
    console.log(`     ${t}: ${n}`);
  }

  // 4. schoolDays mapping
  const schoolDays = fixture.metadata.schoolDays.map(
    (t) => WEEKDAY_FIXTURE_TO_BACKEND[t],
  );
  console.log(`   ✓ schoolDays: [${schoolDays.join(', ')}]`);

  // 5. Build dto
  const dto = {
    academicYearId: ACADEMIC_YEAR_ID,
    startDate: ayStartAd,
    endDate: ayEndAd,
    schoolDays,
    includeWeekends: false,
    holidays,
  };

  if (DRY_RUN) {
    console.log('');
    console.log('── 3. DRY RUN — DTO that would be POSTed ─');
    console.log(JSON.stringify(dto, null, 2));
    console.log('');
    console.log('(no HTTP request made)');
    process.exit(0);
  }

  // 6. POST
  console.log('');
  console.log('── 3. POST /generate-calendar ─────────────');
  console.log(`   ⚠ this will DELETE and REGENERATE all CalendarDate rows for the AY`);
  const res = await postGenerateCalendar(dto);
  if (res.status < 200 || res.status >= 300) {
    console.error(`   ✗ failed: status=${res.status}`);
    console.error(JSON.stringify(res.body, null, 2));
    process.exit(1);
  }

  // 7. Report
  console.log(`   ✓ status=${res.status}`);
  const body = res.body ?? {};
  console.log('');
  console.log('── 4. Summary ─────────────────────────────');
  if (body.totalDates !== undefined) {
    console.log(`   totalDates:        ${body.totalDates}`);
  }
  if (body.instructionalDays !== undefined) {
    console.log(`   instructionalDays: ${body.instructionalDays}`);
  }
  if (body.holidayDays !== undefined) {
    console.log(`   holidayDays:       ${body.holidayDays}`);
  }
  if (body.weekendDays !== undefined) {
    console.log(`   weekendDays:       ${body.weekendDays}`);
  }
  if (Array.isArray(body.sessions) && body.sessions.length > 0) {
    console.log(`   sessions:`);
    for (const s of body.sessions) {
      console.log(`     - ${s.sessionName ?? s.sessionId}: ${s.instructionalDays} instr days`);
    }
  }
  if (Array.isArray(body.warnings) && body.warnings.length > 0) {
    console.log(`   warnings:`);
    for (const w of body.warnings) {
      console.log(`     ! ${w}`);
    }
  }
  console.log('');
  console.log('Next step: re-run C2.1 smoke');
  console.log(
    `  AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \\`,
  );
  console.log(`    scripts/smoke-tests/pilot-greenlight-c2-1.ts`);
}

main().catch((err) => {
  console.error('FATAL:', err?.stack ?? err);
  process.exit(1);
});

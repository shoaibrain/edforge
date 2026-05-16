/**
 * C1.2 — First pilot's per-month calendar data contract.
 *
 * Pinned facts (per the dossier at docs/pilots/pabson-saraswati-bs-2083/dossier.md):
 *   - 12 monthly files exist (baisakh.json … chait.json)
 *   - Each file passes the C1.1 calendar-fixture JSON schema (AJV strict-mode)
 *   - Each file's month field matches its filename
 *   - Each event's bsDate prefix matches the file's month (catches misplaced entries)
 *   - Per-month event counts match the dossier (the AC)
 *   - Each event's bsDate has a day component within that month's BS 2083 length
 *     (cross-checked against shared-types' getBsMonthDays — proves the fixture
 *     and the canonical BS calendar table agree)
 *   - The 6 multi-day blocks the dossier declares all materialize as the
 *     expected count of per-day events under their blockId
 *
 * The spec is parametric where useful; future pilots get the same coverage
 * by registering their metadata + dropping their calendar/ files.
 *
 * Pilot-agnostic invariants live in the spec; pilot-specific expected
 * counts are declared via a small lookup keyed on pilotId.
 */

import * as fs from 'fs';
import * as path from 'path';

import Ajv2020 from 'ajv';
import { getBsMonthDays } from '@aibrains/shared-types';

const PILOT_ID = 'pabson-saraswati-bs-2083';
const CALENDAR_DIR = path.resolve(
  __dirname,
  '..',
  'pilots',
  PILOT_ID,
  'calendar',
);
const SCHEMA_PATH = path.resolve(
  __dirname,
  'schema',
  'calendar-fixture.schema.json',
);

/**
 * Per the dossier, the BS month slug → expected event count for the
 * first pilot. Sum across all 12 = 109. Recount sources:
 *
 *   baisakh (5): Jud-Sital, AY start, T1 start, School Re-opens, Buddha Jayanti
 *   jeth (2): Gantantra Diwas, Quiz Contest
 *   asar (10): 9 exam_window days + T1 end
 *   saun (13): 10 Summer-vacation days + T2 start + School Re-opens + Spelling Contest
 *   bhadau (4): Raksha Bandhan, Speech Contest, Teej, Chaudachan
 *   asoj (13): Sarbidhan Diwas, Jitiya, 9 exam_window days, Ghatasthapana, T2 end
 *   kartik (19): 9 Dashain + T3 start + School Re-opens + 6 Tihar + 2 Chhath
 *   mangsir (2): Game, Bibah Panchami
 *   pus (12): Gregorian NY, 10 exam_window days, T3 end (per the corrected Pus 30)
 *   magh (9): 5 Winter-vacation + T4 start + School Re-opens + 2 Saraswati Puja
 *   fagun (2): Democracy Day, Maha Shivaratri
 *   chait (18): 4 Holi + 12 exam_window + T4 end + AY end
 *
 * Total: 5+2+10+13+4+13+19+2+12+9+2+18 = 109
 */
const EXPECTED_COUNTS: Record<string, number> = {
  baisakh: 5,
  jeth: 2,
  asar: 10,
  saun: 13,
  bhadau: 4,
  asoj: 13,
  kartik: 19,
  mangsir: 2,
  pus: 12,
  magh: 9,
  fagun: 2,
  chait: 18,
};

const EXPECTED_TOTAL = Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0);

/** BS month name → 1-indexed number (Baisakh=1 … Chait=12). */
const MONTH_TO_NUMBER: Record<string, number> = {
  baisakh: 1,
  jeth: 2,
  asar: 3,
  saun: 4,
  bhadau: 5,
  asoj: 6,
  kartik: 7,
  mangsir: 8,
  pus: 9,
  magh: 10,
  fagun: 11,
  chait: 12,
};

/**
 * Expected multi-day blocks for the first pilot. Each entry's day-count
 * MUST match the number of per-day holiday events carrying that blockId
 * in the corresponding monthly file(s).
 */
const EXPECTED_BLOCKS: Record<string, { months: string[]; dayCount: number }> = {
  'dashain-2083': { months: ['kartik'], dayCount: 9 },
  'tihar-2083': { months: ['kartik'], dayCount: 6 },
  'chhath-2083': { months: ['kartik'], dayCount: 2 },
  'summer-vacation-2083': { months: ['saun'], dayCount: 10 },
  'winter-vacation-2083': { months: ['magh'], dayCount: 5 },
  'holi-2083': { months: ['chait'], dayCount: 4 },
};

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

function makeAjv() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  return ajv;
}

function loadMonth(month: string): unknown {
  const p = path.join(CALENDAR_DIR, `${month}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe(`${PILOT_ID} — calendar/ fixture set`, () => {
  describe('file presence', () => {
    it('has exactly 12 monthly JSON files', () => {
      const files = fs
        .readdirSync(CALENDAR_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort();
      expect(files).toEqual(
        Object.keys(EXPECTED_COUNTS)
          .map((m) => `${m}.json`)
          .sort(),
      );
    });
  });

  describe('schema conformance (every file passes C1.1 AJV strict-mode)', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(schema);

    it.each(Object.keys(EXPECTED_COUNTS))(
      '%s.json passes calendar-fixture.schema.json',
      (month) => {
        const doc = loadMonth(month);
        const ok = validate(doc);
        if (!ok) {
          throw new Error(
            `${month}.json failed schema:\n` +
              JSON.stringify(validate.errors, null, 2),
          );
        }
        expect(ok).toBe(true);
      },
    );
  });

  describe('per-month event counts match dossier (the AC)', () => {
    it.each(Object.entries(EXPECTED_COUNTS))(
      '%s.json contains exactly %i events',
      (month, expected) => {
        const doc = loadMonth(month) as { events: unknown[] };
        expect(doc.events.length).toBe(expected);
      },
    );

    it(`total event count across all 12 months equals ${EXPECTED_TOTAL}`, () => {
      const total = Object.keys(EXPECTED_COUNTS).reduce((sum, month) => {
        const doc = loadMonth(month) as { events: unknown[] };
        return sum + doc.events.length;
      }, 0);
      expect(total).toBe(EXPECTED_TOTAL);
    });
  });

  describe('intra-file consistency', () => {
    it.each(Object.keys(EXPECTED_COUNTS))(
      '%s.json: month field matches filename',
      (month) => {
        const doc = loadMonth(month) as { month: string };
        expect(doc.month).toBe(month);
      },
    );

    it.each(Object.keys(EXPECTED_COUNTS))(
      '%s.json: every event.bsDate has the correct month component',
      (month) => {
        const doc = loadMonth(month) as {
          events: { bsDate: string; eventName: string }[];
        };
        const expectedMonth = MONTH_TO_NUMBER[month];
        const expectedMonthStr = String(expectedMonth).padStart(2, '0');
        for (const ev of doc.events) {
          const [, mm] = ev.bsDate.split('/');
          if (mm !== expectedMonthStr) {
            throw new Error(
              `${month}.json: event "${ev.eventName}" has bsDate ${ev.bsDate} ` +
                `but the file's month is ${month} (expected MM=${expectedMonthStr}).`,
            );
          }
        }
      },
    );

    it.each(Object.keys(EXPECTED_COUNTS))(
      '%s.json: every event.bsDate.day is within the month length per shared-types',
      (month) => {
        const monthNum = MONTH_TO_NUMBER[month];
        const monthLen = getBsMonthDays(2083, monthNum);
        const doc = loadMonth(month) as {
          events: { bsDate: string; eventName: string }[];
        };
        for (const ev of doc.events) {
          const [, , dd] = ev.bsDate.split('/');
          const day = parseInt(dd, 10);
          if (day < 1 || day > monthLen) {
            throw new Error(
              `${month}.json: event "${ev.eventName}" has bsDate ${ev.bsDate} ` +
                `but ${month} 2083 has ${monthLen} days (per shared-types BS table). ` +
                `Either the fixture is wrong or the BS table is wrong; investigate.`,
            );
          }
        }
      },
    );
  });

  describe('multi-day block consistency', () => {
    // Use object rows so the test title can reference both blockId and
    // dayCount by name via jest's `$name` interpolation.
    const BLOCK_ROWS = Object.entries(EXPECTED_BLOCKS).map(
      ([blockId, spec]) => ({ blockId, months: spec.months, dayCount: spec.dayCount }),
    );

    it.each(BLOCK_ROWS)(
      'block $blockId has $dayCount day-events across its declared months',
      ({ blockId, months, dayCount }) => {
        const seen = new Set<string>();
        for (const month of months) {
          const doc = loadMonth(month) as {
            events: {
              bsDate: string;
              eventType: string;
              metadata?: { blockId?: string };
            }[];
          };
          for (const ev of doc.events) {
            if (ev.metadata?.blockId === blockId) {
              if (ev.eventType !== 'holiday') {
                throw new Error(
                  `Block ${blockId}: event on ${ev.bsDate} has eventType=${ev.eventType}, expected holiday`,
                );
              }
              if (seen.has(ev.bsDate)) {
                throw new Error(
                  `Block ${blockId}: duplicate day ${ev.bsDate}`,
                );
              }
              seen.add(ev.bsDate);
            }
          }
        }
        expect(seen.size).toBe(dayCount);
      },
    );
  });

  describe('boundary events present', () => {
    /**
     * Anchor checks: specific dossier facts must be present in the data.
     * These catch the kind of mistake where the AY start gets accidentally
     * omitted on a refactor.
     */
    it('AY 2083 start event on Baisakh 3', () => {
      const doc = loadMonth('baisakh') as {
        events: {
          bsDate: string;
          eventType: string;
          metadata?: { boundary?: string };
        }[];
      };
      const ayStart = doc.events.find(
        (e) =>
          e.eventType === 'ay_boundary' &&
          e.bsDate === '2083/01/03' &&
          e.metadata?.boundary === 'start',
      );
      expect(ayStart).toBeDefined();
    });

    it('AY 2083 end event on Chait 30', () => {
      const doc = loadMonth('chait') as {
        events: {
          bsDate: string;
          eventType: string;
          metadata?: { boundary?: string };
        }[];
      };
      const ayEnd = doc.events.find(
        (e) =>
          e.eventType === 'ay_boundary' &&
          e.bsDate === '2083/12/30' &&
          e.metadata?.boundary === 'end',
      );
      expect(ayEnd).toBeDefined();
    });

    it('Term 3 ends on Pus 30 (the corrected boundary)', () => {
      // Regression anchor: the pre-fix shared-types table said Pus had
      // 29 days, which would have forced Pus 29 here. The PR #82 fix
      // restored the canonical Pus 30; this test pins that we used the
      // corrected value in the fixture.
      const doc = loadMonth('pus') as {
        events: {
          bsDate: string;
          eventType: string;
          metadata?: { boundary?: string; termId?: string };
        }[];
      };
      const t3End = doc.events.find(
        (e) =>
          e.eventType === 'term_boundary' &&
          e.bsDate === '2083/09/30' &&
          e.metadata?.boundary === 'end' &&
          e.metadata?.termId === 'term-3',
      );
      expect(t3End).toBeDefined();
    });
  });
});

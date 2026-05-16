/**
 * C1.5 — Holidays consolidated fixture contract.
 *
 * Locks each pilot's holidays-consolidated.json against:
 *   - C1.5 schema (AJV strict-mode)
 *   - Date-arithmetic invariants:
 *       * every block has start <= end (same year)
 *       * blocks don't overlap one another
 *       * single-day holidays are unique by bsDate
 *       * single-day holiday dates don't fall inside any block
 *         (would double-count the day)
 *       * AY year matches the YYYY prefix on every block/holiday date
 *   - Cross-reference with calendar/*.json (C1.2):
 *       * every block expands to exactly N per-day events with the
 *         block's id as metadata.blockId in the calendar files
 *       * every single-day holiday appears as a holiday event in
 *         calendar/*.json with NO blockId
 *       * every blockId in calendar/*.json is declared in
 *         holidays-consolidated.json (no orphan blockIds — drift catch)
 *   - First pilot dossier anchors:
 *       * 6 blocks summing to 36 days
 *       * 13 single-day (4 national + 9 religious)
 *       * 49 total holiday-days
 *
 * Pilot-agnostic invariants in the first block; pilot-specific
 * dossier facts in the second.
 */

import * as fs from 'fs';
import * as path from 'path';

import Ajv2020 from 'ajv';
import { getBsMonthDays } from '@aibrains/shared-types';
import { listPilots } from './pilot-registry';

const SCHEMA_PATH = path.resolve(
  __dirname,
  'schema',
  'holidays-consolidated.schema.json',
);
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

type Category = 'national' | 'religious' | 'school_specific';

interface HolidayBlock {
  id: string;
  name: string;
  category: Category;
  startBsDate: string;
  endBsDate: string;
  source?: string;
}

interface SingleDayHoliday {
  bsDate: string;
  name: string;
  category: Category;
  source?: string;
}

interface HolidaysConsolidated {
  academicYearId: string;
  blocks: HolidayBlock[];
  singleDayHolidays: SingleDayHoliday[];
  notes?: string;
}

interface CalendarEvent {
  bsDate: string;
  eventType: string;
  eventName: string;
  metadata?: { category?: string; blockId?: string };
}

function parseBs(s: string): { year: number; month: number; day: number } {
  const [y, m, d] = s.split('/').map(Number);
  return { year: y, month: m, day: d };
}

function cmpBs(a: string, b: string): number {
  const pa = parseBs(a);
  const pb = parseBs(b);
  if (pa.year !== pb.year) return pa.year < pb.year ? -1 : 1;
  if (pa.month !== pb.month) return pa.month < pb.month ? -1 : 1;
  if (pa.day !== pb.day) return pa.day < pb.day ? -1 : 1;
  return 0;
}

/**
 * Inclusive list of BS dates from start to end (same year only).
 * Walks the BS calendar via getBsMonthDays so day-overflow at month
 * boundaries is canonical.
 */
function expandBlock(startBs: string, endBs: string): string[] {
  const s = parseBs(startBs);
  const e = parseBs(endBs);
  if (s.year !== e.year) {
    throw new Error(`expandBlock cross-year not supported: ${startBs} → ${endBs}`);
  }
  const out: string[] = [];
  let { month, day } = s;
  while (true) {
    out.push(
      `${s.year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    );
    if (month === e.month && day === e.day) break;
    day++;
    if (day > getBsMonthDays(s.year, month)) {
      month++;
      day = 1;
    }
  }
  return out;
}

function makeAjv() {
  return new Ajv2020({ strict: true, allErrors: true });
}

function loadHolidays(pilotId: string): HolidaysConsolidated {
  const p = path.resolve(
    __dirname,
    '..',
    'pilots',
    pilotId,
    'holidays-consolidated.json',
  );
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadAllCalendarEvents(pilotId: string): CalendarEvent[] {
  const months = [
    'baisakh', 'jeth', 'asar', 'saun', 'bhadau', 'asoj',
    'kartik', 'mangsir', 'pus', 'magh', 'fagun', 'chait',
  ];
  const events: CalendarEvent[] = [];
  for (const m of months) {
    const p = path.resolve(
      __dirname,
      '..',
      'pilots',
      pilotId,
      'calendar',
      `${m}.json`,
    );
    if (!fs.existsSync(p)) continue;
    const doc = JSON.parse(fs.readFileSync(p, 'utf8')) as { events: CalendarEvent[] };
    events.push(...doc.events);
  }
  return events;
}

describe('holidays-consolidated.schema.json — AJV strict-mode AC', () => {
  it('schema compiles under AJV strict-mode', () => {
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe('holidays-consolidated.schema.json — happy + sad path', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);

  it('accepts a minimal valid doc (empty arrays)', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        blocks: [],
        singleDayHolidays: [],
      }),
    ).toBe(true);
  });

  it('accepts blocks of each category', () => {
    const doc = {
      academicYearId: 'ay-test',
      blocks: [
        {
          id: 'b-national',
          name: 'National Block',
          category: 'national',
          startBsDate: '2080/01/01',
          endBsDate: '2080/01/03',
        },
        {
          id: 'b-religious',
          name: 'Religious Block',
          category: 'religious',
          startBsDate: '2080/02/01',
          endBsDate: '2080/02/03',
        },
        {
          id: 'b-school',
          name: 'School Block',
          category: 'school_specific',
          startBsDate: '2080/03/01',
          endBsDate: '2080/03/05',
        },
      ],
      singleDayHolidays: [],
    };
    expect(validate(doc)).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        blocks: [{ id: 'b', name: 'B', category: 'religious' }],
        singleDayHolidays: [],
      }),
    ).toBe(false);
  });

  it('rejects unknown category', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        blocks: [
          {
            id: 'b',
            name: 'B',
            category: 'made-up',
            startBsDate: '2080/01/01',
            endBsDate: '2080/01/03',
          },
        ],
        singleDayHolidays: [],
      }),
    ).toBe(false);
  });

  it('rejects malformed BS date', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        blocks: [],
        singleDayHolidays: [
          { bsDate: '2080-01-01', name: 'Wrong sep', category: 'national' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects extra top-level properties', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        blocks: [],
        singleDayHolidays: [],
        sneaky: 'no',
      }),
    ).toBe(false);
  });
});

describe('date-arithmetic invariants (per-pilot, schema-orthogonal)', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: holidays-consolidated.json passes the C1.5 schema',
    ({ pilotId }) => {
      const ajv = makeAjv();
      const validate = ajv.compile(schema);
      const h = loadHolidays(pilotId);
      if (!validate(h)) {
        throw new Error(
          `${pilotId} holidays-consolidated.json failed schema:\n` +
            JSON.stringify(validate.errors, null, 2),
        );
      }
      expect(validate(h)).toBe(true);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every block has start <= end (same year)',
    ({ pilotId }) => {
      const h = loadHolidays(pilotId);
      for (const b of h.blocks) {
        if (cmpBs(b.startBsDate, b.endBsDate) > 0) {
          throw new Error(`${pilotId} block ${b.id}: start > end`);
        }
        const sy = parseBs(b.startBsDate).year;
        const ey = parseBs(b.endBsDate).year;
        if (sy !== ey) {
          throw new Error(
            `${pilotId} block ${b.id}: spans years ${sy} → ${ey} (same-year required)`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: blockIds are unique',
    ({ pilotId }) => {
      const ids = loadHolidays(pilotId).blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: blocks do not overlap one another',
    ({ pilotId }) => {
      const blocks = loadHolidays(pilotId).blocks
        .map((b) => ({ ...b }))
        .sort((a, b) => cmpBs(a.startBsDate, b.startBsDate));
      for (let i = 1; i < blocks.length; i++) {
        const prev = blocks[i - 1];
        const curr = blocks[i];
        if (cmpBs(prev.endBsDate, curr.startBsDate) >= 0) {
          throw new Error(
            `${pilotId} blocks ${prev.id} (ends ${prev.endBsDate}) and ${curr.id} (starts ${curr.startBsDate}) overlap`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: single-day holidays are unique by bsDate',
    ({ pilotId }) => {
      const dates = loadHolidays(pilotId).singleDayHolidays.map((h) => h.bsDate);
      expect(new Set(dates).size).toBe(dates.length);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: no single-day holiday falls inside a multi-day block',
    ({ pilotId }) => {
      const h = loadHolidays(pilotId);
      const blockDates = new Set<string>();
      for (const b of h.blocks) {
        for (const d of expandBlock(b.startBsDate, b.endBsDate)) {
          blockDates.add(d);
        }
      }
      for (const sd of h.singleDayHolidays) {
        if (blockDates.has(sd.bsDate)) {
          throw new Error(
            `${pilotId} single-day '${sd.name}' on ${sd.bsDate} overlaps a multi-day block — would double-count the day`,
          );
        }
      }
    },
  );
});

describe('cross-reference: holidays-consolidated.json ↔ calendar/*.json', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every block expands to exactly N per-day events with matching blockId in calendar/*.json',
    ({ pilotId }) => {
      const h = loadHolidays(pilotId);
      const events = loadAllCalendarEvents(pilotId);

      for (const b of h.blocks) {
        const expectedDates = expandBlock(b.startBsDate, b.endBsDate).sort();
        const calendarDates = events
          .filter(
            (e) => e.eventType === 'holiday' && e.metadata?.blockId === b.id,
          )
          .map((e) => e.bsDate)
          .sort();
        if (JSON.stringify(expectedDates) !== JSON.stringify(calendarDates)) {
          throw new Error(
            `${pilotId} block ${b.id}: declared days ${JSON.stringify(expectedDates)} ` +
              `but calendar/*.json carries blockId-tagged events on ${JSON.stringify(calendarDates)}`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every calendar blockId is declared in holidays-consolidated.json (orphan catch)',
    ({ pilotId }) => {
      const declaredIds = new Set(
        loadHolidays(pilotId).blocks.map((b) => b.id),
      );
      const events = loadAllCalendarEvents(pilotId);
      const calendarIds = new Set<string>();
      for (const e of events) {
        if (e.metadata?.blockId) calendarIds.add(e.metadata.blockId);
      }
      for (const id of calendarIds) {
        if (!declaredIds.has(id)) {
          throw new Error(
            `${pilotId} calendar/*.json references blockId ${id} but it's NOT declared in holidays-consolidated.json`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every single-day holiday appears as a calendar holiday event WITHOUT a blockId',
    ({ pilotId }) => {
      const h = loadHolidays(pilotId);
      const events = loadAllCalendarEvents(pilotId);

      for (const sd of h.singleDayHolidays) {
        const match = events.find(
          (e) =>
            e.bsDate === sd.bsDate &&
            e.eventType === 'holiday' &&
            !e.metadata?.blockId,
        );
        if (!match) {
          throw new Error(
            `${pilotId} single-day holiday '${sd.name}' on ${sd.bsDate} not found in calendar/*.json as a blockId-less holiday event`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: category in holidays-consolidated.json matches category in calendar/*.json events',
    ({ pilotId }) => {
      const h = loadHolidays(pilotId);
      const events = loadAllCalendarEvents(pilotId);

      // For blocks: pick the first day-event with matching blockId, compare categories
      for (const b of h.blocks) {
        const firstEvent = events.find(
          (e) => e.metadata?.blockId === b.id,
        );
        if (firstEvent && firstEvent.metadata?.category !== b.category) {
          throw new Error(
            `${pilotId} block ${b.id}: holidays-consolidated says category=${b.category} ` +
              `but calendar event on ${firstEvent.bsDate} says category=${firstEvent.metadata?.category}`,
          );
        }
      }

      // For single-day: find the calendar event by bsDate, compare categories
      for (const sd of h.singleDayHolidays) {
        const ev = events.find(
          (e) => e.bsDate === sd.bsDate && e.eventType === 'holiday' && !e.metadata?.blockId,
        );
        if (ev && ev.metadata?.category !== sd.category) {
          throw new Error(
            `${pilotId} single-day '${sd.name}' on ${sd.bsDate}: holidays-consolidated says category=${sd.category} ` +
              `but calendar event says category=${ev.metadata?.category}`,
          );
        }
      }
    },
  );
});

describe('pabson-saraswati-bs-2083 dossier anchors', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';

  it('has exactly 6 multi-day blocks', () => {
    expect(loadHolidays(PILOT_ID).blocks.length).toBe(6);
  });

  it('has exactly 13 single-day holidays', () => {
    expect(loadHolidays(PILOT_ID).singleDayHolidays.length).toBe(13);
  });

  it.each([
    ['dashain-2083', 'religious', '2083/07/01', '2083/07/09', 9],
    ['tihar-2083', 'religious', '2083/07/22', '2083/07/27', 6],
    ['chhath-2083', 'religious', '2083/07/29', '2083/07/30', 2],
    ['summer-vacation-2083', 'school_specific', '2083/04/01', '2083/04/10', 10],
    ['winter-vacation-2083', 'school_specific', '2083/10/01', '2083/10/05', 5],
    ['holi-2083', 'religious', '2083/12/07', '2083/12/10', 4],
  ])(
    'block %s (%s) spans %s → %s = %i days',
    (id, category, startBs, endBs, dayCount) => {
      const b = loadHolidays(PILOT_ID).blocks.find((bl) => bl.id === id);
      expect(b).toBeDefined();
      if (!b) return;
      expect(b.category).toBe(category);
      expect(b.startBsDate).toBe(startBs);
      expect(b.endBsDate).toBe(endBs);
      expect(expandBlock(b.startBsDate, b.endBsDate).length).toBe(dayCount);
    },
  );

  it('multi-day block total = 36 days', () => {
    const h = loadHolidays(PILOT_ID);
    const total = h.blocks.reduce(
      (sum, b) => sum + expandBlock(b.startBsDate, b.endBsDate).length,
      0,
    );
    expect(total).toBe(36);
  });

  it('single-day holidays: 4 national + 9 religious', () => {
    const h = loadHolidays(PILOT_ID);
    const byCategory = h.singleDayHolidays.reduce<Record<string, number>>(
      (acc, sd) => {
        acc[sd.category] = (acc[sd.category] || 0) + 1;
        return acc;
      },
      {},
    );
    expect(byCategory['national']).toBe(4);
    expect(byCategory['religious']).toBe(9);
    expect(byCategory['school_specific']).toBeUndefined();
  });

  it('total holiday-day count = 49 (36 block + 13 single)', () => {
    const h = loadHolidays(PILOT_ID);
    const blockTotal = h.blocks.reduce(
      (sum, b) => sum + expandBlock(b.startBsDate, b.endBsDate).length,
      0,
    );
    const singleTotal = h.singleDayHolidays.length;
    expect(blockTotal + singleTotal).toBe(49);
  });
});

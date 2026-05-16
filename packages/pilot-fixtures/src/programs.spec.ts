/**
 * C1.6 — Programs fixture contract.
 *
 * Locks each pilot's programs.json against:
 *   - C1.6 schema (AJV strict-mode)
 *   - Date-arithmetic invariants:
 *       * program startBsDate <= endBsDate (same year)
 *       * program ids unique
 *       * programs don't overlap each other on the same day
 *         (multiple programs on the same date are allowed only if
 *         that's intentional — strict-uniqueness is too tight; we
 *         only enforce id uniqueness)
 *   - Cross-reference with calendar/*.json (C1.2):
 *       * every program expands to exactly N per-day events with
 *         eventType=program in calendar/*.json
 *       * every program's sourceTermId matches calendar events'
 *         metadata.sourceTermId on the same date
 *       * every calendar program event's date is covered by a
 *         declaration in programs.json (orphan catch)
 *   - First pilot dossier anchors:
 *       * 9 programs total
 *       * Saraswati Puja is 2 days (Magh 28-29); all others single-day
 *       * 4 "School Re-opens" entries, one per term
 *
 * Pilot-agnostic invariants first; pilot-specific dossier anchors second.
 */

import * as fs from 'fs';
import * as path from 'path';

import Ajv2020 from 'ajv';
import { getBsMonthDays } from '@aibrains/shared-types';
import { listPilots } from './pilot-registry';

const SCHEMA_PATH = path.resolve(
  __dirname,
  'schema',
  'programs.schema.json',
);
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

type Category = 'school_specific' | 'academic';

interface Program {
  id: string;
  name: string;
  category: Category;
  startBsDate: string;
  endBsDate: string;
  sourceTermId?: string;
  subcategory?: string;
}

interface Programs {
  academicYearId: string;
  programs: Program[];
  notes?: string;
}

interface CalendarEvent {
  bsDate: string;
  eventType: string;
  eventName: string;
  metadata?: { category?: string; sourceTermId?: string; blockId?: string };
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

function expandProgram(startBs: string, endBs: string): string[] {
  const s = parseBs(startBs);
  const e = parseBs(endBs);
  if (s.year !== e.year) {
    throw new Error(`expandProgram cross-year not supported: ${startBs} → ${endBs}`);
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

function loadPrograms(pilotId: string): Programs {
  const p = path.resolve(
    __dirname,
    '..',
    'pilots',
    pilotId,
    'programs.json',
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

describe('programs.schema.json — AJV strict-mode AC', () => {
  it('schema compiles under AJV strict-mode', () => {
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe('programs.schema.json — happy + sad path', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);

  it('accepts a minimal valid doc (empty programs)', () => {
    expect(validate({ academicYearId: 'ay-test', programs: [] })).toBe(true);
  });

  it('accepts a single-day program (start == end)', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [
          {
            id: 'p1',
            name: 'Program 1',
            category: 'school_specific',
            startBsDate: '2083/01/01',
            endBsDate: '2083/01/01',
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts a multi-day program with sourceTermId + subcategory', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [
          {
            id: 'p1',
            name: 'Celebration',
            category: 'school_specific',
            startBsDate: '2083/01/01',
            endBsDate: '2083/01/03',
            sourceTermId: 'term-1',
            subcategory: 'celebration',
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [{ id: 'p1', name: 'X', category: 'school_specific' }],
      }),
    ).toBe(false);
  });

  it('rejects unknown category', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [
          {
            id: 'p1',
            name: 'X',
            category: 'national',
            startBsDate: '2083/01/01',
            endBsDate: '2083/01/01',
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects unknown subcategory', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [
          {
            id: 'p1',
            name: 'X',
            category: 'school_specific',
            startBsDate: '2083/01/01',
            endBsDate: '2083/01/01',
            subcategory: 'mystery',
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects malformed BS date', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [
          {
            id: 'p1',
            name: 'X',
            category: 'school_specific',
            startBsDate: '2083-01-01',
            endBsDate: '2083-01-01',
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects extra top-level properties', () => {
    expect(
      validate({
        academicYearId: 'ay-test',
        programs: [],
        sneaky: 'no',
      }),
    ).toBe(false);
  });
});

describe('date-arithmetic invariants (per-pilot, schema-orthogonal)', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: programs.json passes the C1.6 schema',
    ({ pilotId }) => {
      const ajv = makeAjv();
      const validate = ajv.compile(schema);
      const docs = loadPrograms(pilotId);
      const ok = validate(docs);
      if (!ok) {
        throw new Error(
          `${pilotId} programs.json failed schema:\n` +
            JSON.stringify(validate.errors, null, 2),
        );
      }
      expect(ok).toBe(true);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every program has startBsDate <= endBsDate (same year)',
    ({ pilotId }) => {
      const docs = loadPrograms(pilotId);
      for (const p of docs.programs) {
        if (cmpBs(p.startBsDate, p.endBsDate) > 0) {
          throw new Error(`${pilotId} program ${p.id}: start > end`);
        }
        const sy = parseBs(p.startBsDate).year;
        const ey = parseBs(p.endBsDate).year;
        if (sy !== ey) {
          throw new Error(
            `${pilotId} program ${p.id}: spans years ${sy} → ${ey} (same-year required)`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: program ids are unique',
    ({ pilotId }) => {
      const ids = loadPrograms(pilotId).programs.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

describe('cross-reference: programs.json ↔ calendar/*.json', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every program expands to exactly N per-day events with eventType=program in calendar/*.json',
    ({ pilotId }) => {
      const docs = loadPrograms(pilotId);
      const events = loadAllCalendarEvents(pilotId);

      for (const prog of docs.programs) {
        const expectedDates = expandProgram(prog.startBsDate, prog.endBsDate);
        for (const date of expectedDates) {
          const match = events.find(
            (e) =>
              e.bsDate === date &&
              e.eventType === 'program' &&
              (!prog.sourceTermId || e.metadata?.sourceTermId === prog.sourceTermId),
          );
          if (!match) {
            throw new Error(
              `${pilotId} program ${prog.id}: expected a calendar program event on ${date}` +
                (prog.sourceTermId ? ` with sourceTermId=${prog.sourceTermId}` : '') +
                ` but none found`,
            );
          }
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every calendar program event is accounted for by a declaration in programs.json',
    ({ pilotId }) => {
      // Build the set of (date, sourceTermId) tuples covered by programs.json
      const docs = loadPrograms(pilotId);
      const declared = new Set<string>();
      for (const prog of docs.programs) {
        for (const date of expandProgram(prog.startBsDate, prog.endBsDate)) {
          declared.add(`${date}::${prog.sourceTermId ?? ''}`);
        }
      }

      const events = loadAllCalendarEvents(pilotId);
      const programEvents = events.filter((e) => e.eventType === 'program');
      for (const ev of programEvents) {
        const key = `${ev.bsDate}::${ev.metadata?.sourceTermId ?? ''}`;
        if (!declared.has(key)) {
          throw new Error(
            `${pilotId} calendar program event '${ev.eventName}' on ${ev.bsDate} (sourceTermId=${ev.metadata?.sourceTermId ?? '<none>'}) is NOT covered by a programs.json entry`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: program.category matches calendar event metadata.category',
    ({ pilotId }) => {
      const docs = loadPrograms(pilotId);
      const events = loadAllCalendarEvents(pilotId);

      for (const prog of docs.programs) {
        for (const date of expandProgram(prog.startBsDate, prog.endBsDate)) {
          const ev = events.find(
            (e) => e.bsDate === date && e.eventType === 'program',
          );
          if (ev && ev.metadata?.category && ev.metadata.category !== prog.category) {
            throw new Error(
              `${pilotId} program ${prog.id} on ${date}: programs.json says category=${prog.category} but calendar event says category=${ev.metadata.category}`,
            );
          }
        }
      }
    },
  );
});

describe('cross-reference: programs.json sourceTermId ↔ academic-structure.json', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every sourceTermId is declared in academic-structure.json',
    ({ pilotId }) => {
      // Load academic-structure to get declared termIds
      const apath = path.resolve(
        __dirname,
        '..',
        'pilots',
        pilotId,
        'academic-structure.json',
      );
      if (!fs.existsSync(apath)) return; // skip if pilot has no academic-structure yet
      const structure = JSON.parse(fs.readFileSync(apath, 'utf8')) as {
        terms: { id: string }[];
      };
      const declaredTermIds = new Set(structure.terms.map((t) => t.id));

      const docs = loadPrograms(pilotId);
      for (const prog of docs.programs) {
        if (prog.sourceTermId && !declaredTermIds.has(prog.sourceTermId)) {
          throw new Error(
            `${pilotId} program ${prog.id} references sourceTermId=${prog.sourceTermId} not declared in academic-structure.json`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every program with sourceTermId falls within that term\'s date range',
    ({ pilotId }) => {
      const apath = path.resolve(
        __dirname,
        '..',
        'pilots',
        pilotId,
        'academic-structure.json',
      );
      if (!fs.existsSync(apath)) return;
      const structure = JSON.parse(fs.readFileSync(apath, 'utf8')) as {
        terms: { id: string; startBsDate: string; endBsDate: string }[];
      };
      const termById = new Map(structure.terms.map((t) => [t.id, t]));

      const docs = loadPrograms(pilotId);
      for (const prog of docs.programs) {
        if (!prog.sourceTermId) continue;
        const term = termById.get(prog.sourceTermId);
        if (!term) continue; // covered by prior test
        if (
          cmpBs(prog.startBsDate, term.startBsDate) < 0 ||
          cmpBs(prog.endBsDate, term.endBsDate) > 0
        ) {
          throw new Error(
            `${pilotId} program ${prog.id} (${prog.startBsDate}-${prog.endBsDate}) ` +
              `claims sourceTermId=${prog.sourceTermId} (${term.startBsDate}-${term.endBsDate}) ` +
              `but the program's dates fall outside the term range`,
          );
        }
      }
    },
  );
});

describe('pabson-saraswati-bs-2083 dossier anchors', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';

  it('has exactly 9 programs', () => {
    expect(loadPrograms(PILOT_ID).programs.length).toBe(9);
  });

  it('has exactly one multi-day program (Saraswati Puja, 2 days)', () => {
    const docs = loadPrograms(PILOT_ID);
    const multiDay = docs.programs.filter(
      (p) => cmpBs(p.startBsDate, p.endBsDate) < 0,
    );
    expect(multiDay.length).toBe(1);
    expect(multiDay[0].id).toBe('saraswati-puja-2083');
    expect(multiDay[0].startBsDate).toBe('2083/10/28');
    expect(multiDay[0].endBsDate).toBe('2083/10/29');
    expect(expandProgram(multiDay[0].startBsDate, multiDay[0].endBsDate).length).toBe(2);
  });

  it('has exactly 4 "School Re-opens" programs (one per term)', () => {
    const docs = loadPrograms(PILOT_ID);
    const reopens = docs.programs.filter((p) => p.subcategory === 'reopen');
    expect(reopens.length).toBe(4);
    const termIds = reopens.map((r) => r.sourceTermId).sort();
    expect(termIds).toEqual(['term-1', 'term-2', 'term-3', 'term-4']);
  });

  it('every program has a sourceTermId (per dossier — all 9 are term-scoped)', () => {
    const docs = loadPrograms(PILOT_ID);
    for (const p of docs.programs) {
      expect(p.sourceTermId).toBeDefined();
      expect(p.sourceTermId).toMatch(/^term-[1-4]$/);
    }
  });

  it('total program-day count = 10 (9 programs, Saraswati Puja contributes 2)', () => {
    const docs = loadPrograms(PILOT_ID);
    const total = docs.programs.reduce(
      (sum, p) => sum + expandProgram(p.startBsDate, p.endBsDate).length,
      0,
    );
    expect(total).toBe(10);
  });

  it.each([
    ['school-reopens-term-1', '2083/01/03', 'term-1', 'reopen'],
    ['quiz-contest', '2083/02/22', 'term-1', 'contest'],
    ['school-reopens-term-2', '2083/04/11', 'term-2', 'reopen'],
    ['spelling-contest', '2083/04/22', 'term-2', 'contest'],
    ['speech-contest', '2083/05/19', 'term-2', 'contest'],
    ['school-reopens-term-3', '2083/07/10', 'term-3', 'reopen'],
    ['game', '2083/08/18', 'term-3', 'game'],
    ['school-reopens-term-4', '2083/10/06', 'term-4', 'reopen'],
  ])(
    'single-day program %s on %s (sourceTermId=%s, subcategory=%s)',
    (id, bsDate, termId, subcat) => {
      const prog = loadPrograms(PILOT_ID).programs.find((p) => p.id === id);
      expect(prog).toBeDefined();
      if (!prog) return;
      expect(prog.startBsDate).toBe(bsDate);
      expect(prog.endBsDate).toBe(bsDate); // single-day → start == end
      expect(prog.sourceTermId).toBe(termId);
      expect(prog.subcategory).toBe(subcat);
    },
  );
});

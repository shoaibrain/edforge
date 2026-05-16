/**
 * C1.4 — Academic structure fixture contract.
 *
 * Locks each pilot's academic-structure.json against:
 *   - C1.4 schema (AJV strict-mode)
 *   - Date-arithmetic invariants the schema can't express:
 *       * AY.startBsDate < AY.endBsDate
 *       * each term's startBsDate < endBsDate
 *       * terms are ordered by startBsDate ascending; no overlap
 *       * each term's examWindow falls within the term's date range
 *       * cross-year markers all fall in the declared nextAcademicYear
 *       * provisional window startBsDate < endBsDate
 *       * resultPublish is within or at the end of provisional window
 *       * newSessionBegin >= resultPublish
 *   - Per-term inclusive day counts match dossier (the AC)
 *   - Cross-reference: every termId in academic-structure.json is also
 *     referenced by at least one event in calendar/*.json (catches drift)
 *   - First pilot dossier anchors (AY boundary, term/exam-window dates,
 *     cross-year markers)
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
  'academic-structure.schema.json',
);

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

interface ExamWindow {
  id: string;
  name?: string;
  examType: string;
  startBsDate: string;
  endBsDate: string;
}

interface Term {
  id: string;
  name: string;
  startBsDate: string;
  endBsDate: string;
  examWindow: ExamWindow;
}

interface AcademicStructure {
  academicYearId: string;
  name: string;
  calendarSystem: string;
  startBsDate: string;
  endBsDate: string;
  terms: Term[];
  crossYearMarkers: {
    nextAcademicYearId: string;
    resultPublishBsDate: string;
    newSessionBeginBsDate: string;
    provisionalWindow: {
      startBsDate: string;
      endBsDate: string;
    };
  };
  notes?: string;
}

/** Parse BS YYYY/MM/DD → comparable tuple. */
function parseBs(s: string): { year: number; month: number; day: number } {
  const [y, m, d] = s.split('/').map(Number);
  return { year: y, month: m, day: d };
}

/** Lexicographic compare on (year, month, day). Returns -1/0/1. */
function cmpBs(a: string, b: string): number {
  const pa = parseBs(a);
  const pb = parseBs(b);
  if (pa.year !== pb.year) return pa.year - pb.year < 0 ? -1 : 1;
  if (pa.month !== pb.month) return pa.month - pb.month < 0 ? -1 : 1;
  if (pa.day !== pb.day) return pa.day - pb.day < 0 ? -1 : 1;
  return 0;
}

/**
 * Inclusive BS day count between two dates in the same year. Uses
 * `getBsMonthDays` from shared-types so the canonical BS table is the
 * source of truth (BS 2083 fix in PR #82 lands here too).
 */
function inclusiveDayCountSameYear(startBs: string, endBs: string): number {
  const s = parseBs(startBs);
  const e = parseBs(endBs);
  if (s.year !== e.year) {
    throw new Error(
      `inclusiveDayCountSameYear: cross-year not supported (${startBs} → ${endBs})`,
    );
  }
  if (cmpBs(startBs, endBs) > 0) {
    throw new Error(`inclusiveDayCountSameYear: start > end (${startBs} → ${endBs})`);
  }

  let total = 0;
  if (s.month === e.month) {
    return e.day - s.day + 1;
  }
  // start-month partial
  total += getBsMonthDays(s.year, s.month) - s.day + 1;
  // full months between
  for (let m = s.month + 1; m < e.month; m++) {
    total += getBsMonthDays(s.year, m);
  }
  // end-month partial
  total += e.day;
  return total;
}

function makeAjv() {
  return new Ajv2020({ strict: true, allErrors: true });
}

function loadStructure(pilotId: string): AcademicStructure {
  const p = path.resolve(
    __dirname,
    '..',
    'pilots',
    pilotId,
    'academic-structure.json',
  );
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadCalendarMonth(pilotId: string, month: string): { events: { metadata?: { termId?: string } }[] } | null {
  const p = path.resolve(
    __dirname,
    '..',
    'pilots',
    pilotId,
    'calendar',
    `${month}.json`,
  );
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('academic-structure.schema.json — AJV strict-mode AC', () => {
  it('schema compiles under AJV strict-mode', () => {
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe('academic-structure.schema.json — happy + sad path', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);

  it('accepts a minimal valid doc (1 term, full cross-year markers)', () => {
    const doc = {
      academicYearId: 'ay-test',
      name: 'AY Test',
      calendarSystem: 'gregorian',
      startBsDate: '2080/01/01',
      endBsDate: '2080/12/30',
      terms: [
        {
          id: 'term-1',
          name: 'Term 1',
          startBsDate: '2080/01/01',
          endBsDate: '2080/12/30',
          examWindow: {
            id: 'term-1-exam',
            examType: 'terminal',
            startBsDate: '2080/12/20',
            endBsDate: '2080/12/30',
          },
        },
      ],
      crossYearMarkers: {
        nextAcademicYearId: 'ay-test-next',
        resultPublishBsDate: '2081/01/05',
        newSessionBeginBsDate: '2081/01/10',
        provisionalWindow: {
          startBsDate: '2081/01/01',
          endBsDate: '2081/01/05',
        },
      },
    };
    expect(validate(doc)).toBe(true);
  });

  it('rejects empty terms array', () => {
    const doc = {
      academicYearId: 'ay-test',
      name: 'AY Test',
      calendarSystem: 'gregorian',
      startBsDate: '2080/01/01',
      endBsDate: '2080/12/30',
      terms: [],
      crossYearMarkers: {
        nextAcademicYearId: 'ay-test-next',
        resultPublishBsDate: '2081/01/05',
        newSessionBeginBsDate: '2081/01/10',
        provisionalWindow: {
          startBsDate: '2081/01/01',
          endBsDate: '2081/01/05',
        },
      },
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects malformed BS date (missing zero-pad)', () => {
    const doc = {
      academicYearId: 'ay-test',
      name: 'AY Test',
      calendarSystem: 'gregorian',
      startBsDate: '2080/1/1',
      endBsDate: '2080/12/30',
      terms: [
        {
          id: 'term-1',
          name: 'Term 1',
          startBsDate: '2080/1/1',
          endBsDate: '2080/12/30',
          examWindow: {
            id: 'term-1-exam',
            examType: 'terminal',
            startBsDate: '2080/12/20',
            endBsDate: '2080/12/30',
          },
        },
      ],
      crossYearMarkers: {
        nextAcademicYearId: 'ay-test-next',
        resultPublishBsDate: '2081/01/05',
        newSessionBeginBsDate: '2081/01/10',
        provisionalWindow: {
          startBsDate: '2081/01/01',
          endBsDate: '2081/01/05',
        },
      },
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects unknown examType', () => {
    const doc = {
      academicYearId: 'ay-test',
      name: 'AY Test',
      calendarSystem: 'gregorian',
      startBsDate: '2080/01/01',
      endBsDate: '2080/12/30',
      terms: [
        {
          id: 'term-1',
          name: 'Term 1',
          startBsDate: '2080/01/01',
          endBsDate: '2080/12/30',
          examWindow: {
            id: 'term-1-exam',
            examType: 'pop-quiz',
            startBsDate: '2080/12/20',
            endBsDate: '2080/12/30',
          },
        },
      ],
      crossYearMarkers: {
        nextAcademicYearId: 'ay-test-next',
        resultPublishBsDate: '2081/01/05',
        newSessionBeginBsDate: '2081/01/10',
        provisionalWindow: {
          startBsDate: '2081/01/01',
          endBsDate: '2081/01/05',
        },
      },
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects extra top-level properties', () => {
    const doc = {
      academicYearId: 'ay-test',
      name: 'AY Test',
      calendarSystem: 'gregorian',
      startBsDate: '2080/01/01',
      endBsDate: '2080/12/30',
      terms: [
        {
          id: 'term-1',
          name: 'Term 1',
          startBsDate: '2080/01/01',
          endBsDate: '2080/12/30',
          examWindow: {
            id: 'term-1-exam',
            examType: 'terminal',
            startBsDate: '2080/12/20',
            endBsDate: '2080/12/30',
          },
        },
      ],
      crossYearMarkers: {
        nextAcademicYearId: 'ay-test-next',
        resultPublishBsDate: '2081/01/05',
        newSessionBeginBsDate: '2081/01/10',
        provisionalWindow: {
          startBsDate: '2081/01/01',
          endBsDate: '2081/01/05',
        },
      },
      mystery_field: 'sneaky',
    };
    expect(validate(doc)).toBe(false);
  });
});

describe('date-arithmetic invariants (per-pilot, schema-orthogonal)', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every academic-structure.json passes the C1.4 schema',
    ({ pilotId }) => {
      const ajv = makeAjv();
      const validate = ajv.compile(schema);
      const structure = loadStructure(pilotId);
      const ok = validate(structure);
      if (!ok) {
        throw new Error(
          `${pilotId} academic-structure.json failed schema:\n` +
            JSON.stringify(validate.errors, null, 2),
        );
      }
      expect(ok).toBe(true);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: AY startBsDate < endBsDate',
    ({ pilotId }) => {
      const s = loadStructure(pilotId);
      expect(cmpBs(s.startBsDate, s.endBsDate)).toBeLessThan(0);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every term has start < end',
    ({ pilotId }) => {
      const s = loadStructure(pilotId);
      for (const t of s.terms) {
        if (cmpBs(t.startBsDate, t.endBsDate) >= 0) {
          throw new Error(
            `${pilotId} term ${t.id}: start ${t.startBsDate} >= end ${t.endBsDate}`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: terms are ordered by startBsDate ascending + non-overlapping',
    ({ pilotId }) => {
      const s = loadStructure(pilotId);
      for (let i = 1; i < s.terms.length; i++) {
        const prev = s.terms[i - 1];
        const curr = s.terms[i];
        if (cmpBs(prev.startBsDate, curr.startBsDate) >= 0) {
          throw new Error(
            `${pilotId} terms not ordered: ${prev.id} (${prev.startBsDate}) before ${curr.id} (${curr.startBsDate})`,
          );
        }
        // Non-overlap: prev.endBsDate < curr.startBsDate
        if (cmpBs(prev.endBsDate, curr.startBsDate) >= 0) {
          throw new Error(
            `${pilotId} terms overlap: ${prev.id} ends ${prev.endBsDate}, ${curr.id} starts ${curr.startBsDate}`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every termId is unique',
    ({ pilotId }) => {
      const s = loadStructure(pilotId);
      const ids = s.terms.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every examWindow falls within its term date range (inclusive)',
    ({ pilotId }) => {
      const s = loadStructure(pilotId);
      for (const t of s.terms) {
        if (cmpBs(t.examWindow.startBsDate, t.startBsDate) < 0) {
          throw new Error(
            `${pilotId} term ${t.id}: examWindow starts ${t.examWindow.startBsDate} before term starts ${t.startBsDate}`,
          );
        }
        if (cmpBs(t.examWindow.endBsDate, t.endBsDate) > 0) {
          throw new Error(
            `${pilotId} term ${t.id}: examWindow ends ${t.examWindow.endBsDate} after term ends ${t.endBsDate}`,
          );
        }
        if (cmpBs(t.examWindow.startBsDate, t.examWindow.endBsDate) > 0) {
          throw new Error(
            `${pilotId} term ${t.id}: examWindow start ${t.examWindow.startBsDate} > end ${t.examWindow.endBsDate}`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: cross-year markers fall in the declared next AY (BS year > AY end year)',
    ({ pilotId }) => {
      const s = loadStructure(pilotId);
      const ayEndYear = parseBs(s.endBsDate).year;
      const xy = s.crossYearMarkers;
      const dates = [
        ['resultPublishBsDate', xy.resultPublishBsDate],
        ['newSessionBeginBsDate', xy.newSessionBeginBsDate],
        ['provisionalWindow.startBsDate', xy.provisionalWindow.startBsDate],
        ['provisionalWindow.endBsDate', xy.provisionalWindow.endBsDate],
      ];
      for (const [label, d] of dates) {
        const y = parseBs(d).year;
        if (y <= ayEndYear) {
          throw new Error(
            `${pilotId} crossYearMarkers.${label}=${d} is in BS year ${y}, expected > AY end year ${ayEndYear}`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: provisional window start <= end',
    ({ pilotId }) => {
      const xy = loadStructure(pilotId).crossYearMarkers;
      expect(cmpBs(xy.provisionalWindow.startBsDate, xy.provisionalWindow.endBsDate)).toBeLessThanOrEqual(0);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: resultPublish falls inside the provisional window (inclusive)',
    ({ pilotId }) => {
      const xy = loadStructure(pilotId).crossYearMarkers;
      expect(cmpBs(xy.provisionalWindow.startBsDate, xy.resultPublishBsDate)).toBeLessThanOrEqual(0);
      expect(cmpBs(xy.resultPublishBsDate, xy.provisionalWindow.endBsDate)).toBeLessThanOrEqual(0);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: newSessionBegin >= resultPublish',
    ({ pilotId }) => {
      const xy = loadStructure(pilotId).crossYearMarkers;
      expect(cmpBs(xy.resultPublishBsDate, xy.newSessionBeginBsDate)).toBeLessThanOrEqual(0);
    },
  );
});

describe('cross-reference: termIds match calendar/*.json', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every termId in academic-structure.json appears in calendar/*.json',
    ({ pilotId }) => {
      const structure = loadStructure(pilotId);
      const termIdsInStructure = new Set(structure.terms.map((t) => t.id));

      const termIdsInCalendar = new Set<string>();
      const months = [
        'baisakh', 'jeth', 'asar', 'saun', 'bhadau', 'asoj',
        'kartik', 'mangsir', 'pus', 'magh', 'fagun', 'chait',
      ];
      for (const m of months) {
        const doc = loadCalendarMonth(pilotId, m);
        if (!doc) continue;
        for (const ev of doc.events) {
          if (ev.metadata?.termId) {
            termIdsInCalendar.add(ev.metadata.termId);
          }
        }
      }

      // Every termId declared in academic-structure should appear in at
      // least one calendar event. (Conversely, calendar termIds that
      // don't appear in academic-structure would be drift — checked too.)
      for (const id of termIdsInStructure) {
        if (!termIdsInCalendar.has(id)) {
          throw new Error(
            `${pilotId} termId ${id} declared in academic-structure but not referenced by any calendar event`,
          );
        }
      }
      for (const id of termIdsInCalendar) {
        if (!termIdsInStructure.has(id)) {
          throw new Error(
            `${pilotId} calendar event references unknown termId ${id} (not declared in academic-structure.json)`,
          );
        }
      }
    },
  );
});

describe('pabson-saraswati-bs-2083 dossier anchors', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';

  it('AY boundary: Baisakh 3 2083 → Chait 30 2083', () => {
    const s = loadStructure(PILOT_ID);
    expect(s.academicYearId).toBe('ay-2083');
    expect(s.startBsDate).toBe('2083/01/03');
    expect(s.endBsDate).toBe('2083/12/30');
  });

  it('has exactly 4 terms', () => {
    expect(loadStructure(PILOT_ID).terms.length).toBe(4);
  });

  it.each([
    ['term-1', '2083/01/03', '2083/03/32', '2083/03/24', '2083/03/32', 92],
    ['term-2', '2083/04/11', '2083/06/30', '2083/06/22', '2083/06/30', 82],
    ['term-3', '2083/07/10', '2083/09/30', '2083/09/21', '2083/09/30', 81],
    ['term-4', '2083/10/06', '2083/12/29', '2083/12/18', '2083/12/29', 84],
  ])(
    '%s: %s → %s (exam %s → %s, %i inclusive days)',
    (termId, expStart, expEnd, expExamStart, expExamEnd, expDayCount) => {
      const s = loadStructure(PILOT_ID);
      const term = s.terms.find((t) => t.id === termId);
      expect(term).toBeDefined();
      if (!term) return;
      expect(term.startBsDate).toBe(expStart);
      expect(term.endBsDate).toBe(expEnd);
      expect(term.examWindow.startBsDate).toBe(expExamStart);
      expect(term.examWindow.endBsDate).toBe(expExamEnd);
      expect(term.examWindow.examType).toBe('terminal');
      // Per-term inclusive day count is the AC check
      expect(inclusiveDayCountSameYear(term.startBsDate, term.endBsDate)).toBe(expDayCount);
    },
  );

  it('cross-year markers: resultPublish Baisakh 8 2084, newSessionBegin Baisakh 12 2084', () => {
    const xy = loadStructure(PILOT_ID).crossYearMarkers;
    expect(xy.nextAcademicYearId).toBe('ay-2084');
    expect(xy.resultPublishBsDate).toBe('2084/01/08');
    expect(xy.newSessionBeginBsDate).toBe('2084/01/12');
  });

  it('provisional window: Baisakh 1 2084 → Baisakh 8 2084 (8 inclusive days)', () => {
    const xy = loadStructure(PILOT_ID).crossYearMarkers;
    expect(xy.provisionalWindow.startBsDate).toBe('2084/01/01');
    expect(xy.provisionalWindow.endBsDate).toBe('2084/01/08');
    expect(
      inclusiveDayCountSameYear(
        xy.provisionalWindow.startBsDate,
        xy.provisionalWindow.endBsDate,
      ),
    ).toBe(8);
  });

  it('total of all 4 inclusive term day counts is 339', () => {
    // Anchor for the C2.1 read-path test that asserts instructional-days
    // queries return exact term sums.
    const s = loadStructure(PILOT_ID);
    const total = s.terms.reduce(
      (sum, t) => sum + inclusiveDayCountSameYear(t.startBsDate, t.endBsDate),
      0,
    );
    expect(total).toBe(339);
  });
});

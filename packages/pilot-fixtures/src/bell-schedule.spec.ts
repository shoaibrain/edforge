/**
 * C1.3 — Bell schedule fixture contract.
 *
 * Locks the per-pilot bell-schedule.json against:
 *   - C1.3 schema (AJV strict-mode)
 *   - Time-arithmetic invariants the schema can't express:
 *       * shift.endTime > shift.startTime
 *       * period.endTime > period.startTime
 *       * periods within a shift do not overlap and are contiguous
 *         within the shift's start/end bounds
 *   - First pilot's specific dossier facts (3 shifts: morning-routine
 *     non-academic, day-academic 8x45, exam-day-academic 4x90)
 *
 * The spec is parametric where useful. Future pilots' bell-schedules
 * pick up the schema + invariant checks automatically just by registering
 * a metadata.json + dropping a bell-schedule.json.
 *
 * Pilot-agnostic invariants in the first block; pilot-specific
 * fixtures in the second.
 */

import * as fs from 'fs';
import * as path from 'path';

import Ajv2020 from 'ajv';
import { listPilots } from './pilot-registry';

const SCHEMA_PATH = path.resolve(
  __dirname,
  'schema',
  'bell-schedule.schema.json',
);

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

interface PeriodLike {
  id: string;
  name?: string;
  startTime: string;
  endTime: string;
  kind?: string;
}

interface ShiftLike {
  id: string;
  name: string;
  scope: 'academic' | 'non-academic';
  startTime: string;
  endTime: string;
  periods?: PeriodLike[];
}

interface BellScheduleLike {
  shifts: ShiftLike[];
  examDayShifts?: ShiftLike[];
  notes?: string;
}

/** Parse HH:MM → minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function makeAjv() {
  return new Ajv2020({ strict: true, allErrors: true });
}

function loadBellSchedule(pilotId: string): BellScheduleLike {
  const p = path.resolve(
    __dirname,
    '..',
    'pilots',
    pilotId,
    'bell-schedule.json',
  );
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('bell-schedule.schema.json — AJV strict-mode AC', () => {
  it('schema compiles under AJV strict-mode', () => {
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe('bell-schedule.schema.json — happy + sad path', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);

  it('accepts a minimal valid doc (one shift, no periods)', () => {
    const doc = {
      shifts: [
        {
          id: 'only-shift',
          name: 'Only Shift',
          scope: 'academic',
          startTime: '09:00',
          endTime: '15:00',
        },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  it('accepts a doc with a non-academic shift (no periods required)', () => {
    const doc = {
      shifts: [
        {
          id: 'morning',
          name: 'Morning',
          scope: 'non-academic',
          startTime: '05:30',
          endTime: '09:00',
        },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  it('rejects shifts array with zero entries', () => {
    expect(validate({ shifts: [] })).toBe(false);
  });

  it('rejects a shift missing required fields', () => {
    const doc = {
      shifts: [{ id: 'x', name: 'X', scope: 'academic' }],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects unknown scope', () => {
    const doc = {
      shifts: [
        {
          id: 'x',
          name: 'X',
          scope: 'after-school',
          startTime: '09:00',
          endTime: '10:00',
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects malformed HH:MM time (single-digit hour)', () => {
    const doc = {
      shifts: [
        {
          id: 'x',
          name: 'X',
          scope: 'academic',
          startTime: '9:00',
          endTime: '10:00',
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects extra top-level properties (additionalProperties: false)', () => {
    const doc = {
      shifts: [
        {
          id: 'x',
          name: 'X',
          scope: 'academic',
          startTime: '09:00',
          endTime: '10:00',
        },
      ],
      mystery_field: 'sneaky',
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects extra shift-level properties', () => {
    const doc = {
      shifts: [
        {
          id: 'x',
          name: 'X',
          scope: 'academic',
          startTime: '09:00',
          endTime: '10:00',
          extra: 'no',
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown period.kind', () => {
    const doc = {
      shifts: [
        {
          id: 'x',
          name: 'X',
          scope: 'academic',
          startTime: '09:00',
          endTime: '10:00',
          periods: [
            {
              id: 'p1',
              startTime: '09:00',
              endTime: '10:00',
              kind: 'mystery',
            },
          ],
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });
});

describe('time-arithmetic invariants (per-pilot, schema-orthogonal)', () => {
  // Parametric over every registered pilot. Each pilot's bell-schedule.json
  // is loaded once; we then assert the time-math invariants the schema
  // can't express. Adding pilot 2 = add metadata + bell-schedule.json;
  // these tests automatically cover them.

  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every shift has endTime > startTime',
    ({ pilotId }) => {
      const bs = loadBellSchedule(pilotId);
      const allShifts = [...bs.shifts, ...(bs.examDayShifts ?? [])];
      for (const shift of allShifts) {
        const startMin = toMinutes(shift.startTime);
        const endMin = toMinutes(shift.endTime);
        if (endMin <= startMin) {
          throw new Error(
            `${pilotId} shift ${shift.id}: startTime=${shift.startTime} >= endTime=${shift.endTime}`,
          );
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every period has endTime > startTime',
    ({ pilotId }) => {
      const bs = loadBellSchedule(pilotId);
      const allShifts = [...bs.shifts, ...(bs.examDayShifts ?? [])];
      for (const shift of allShifts) {
        for (const period of shift.periods ?? []) {
          const startMin = toMinutes(period.startTime);
          const endMin = toMinutes(period.endTime);
          if (endMin <= startMin) {
            throw new Error(
              `${pilotId} shift ${shift.id} period ${period.id}: startTime=${period.startTime} >= endTime=${period.endTime}`,
            );
          }
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: periods within a shift do not overlap',
    ({ pilotId }) => {
      const bs = loadBellSchedule(pilotId);
      const allShifts = [...bs.shifts, ...(bs.examDayShifts ?? [])];
      for (const shift of allShifts) {
        const periods = (shift.periods ?? [])
          .map((p) => ({
            ...p,
            startMin: toMinutes(p.startTime),
            endMin: toMinutes(p.endTime),
          }))
          .sort((a, b) => a.startMin - b.startMin);
        for (let i = 1; i < periods.length; i++) {
          const prev = periods[i - 1];
          const curr = periods[i];
          if (curr.startMin < prev.endMin) {
            throw new Error(
              `${pilotId} shift ${shift.id}: period ${curr.id} starts at ${curr.startTime} which overlaps prior period ${prev.id} ending at ${prev.endTime}`,
            );
          }
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every period fits within its parent shift\'s time bounds',
    ({ pilotId }) => {
      const bs = loadBellSchedule(pilotId);
      const allShifts = [...bs.shifts, ...(bs.examDayShifts ?? [])];
      for (const shift of allShifts) {
        const shiftStart = toMinutes(shift.startTime);
        const shiftEnd = toMinutes(shift.endTime);
        for (const period of shift.periods ?? []) {
          const pStart = toMinutes(period.startTime);
          const pEnd = toMinutes(period.endTime);
          if (pStart < shiftStart || pEnd > shiftEnd) {
            throw new Error(
              `${pilotId} shift ${shift.id} period ${period.id}: period ${period.startTime}-${period.endTime} not within shift bounds ${shift.startTime}-${shift.endTime}`,
            );
          }
        }
      }
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: shift ids are unique within the file',
    ({ pilotId }) => {
      const bs = loadBellSchedule(pilotId);
      const ids = [...bs.shifts, ...(bs.examDayShifts ?? [])].map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: every bell-schedule.json passes the C1.3 schema',
    ({ pilotId }) => {
      const ajv = makeAjv();
      const validate = ajv.compile(schema);
      const bs = loadBellSchedule(pilotId);
      const ok = validate(bs);
      if (!ok) {
        throw new Error(
          `${pilotId} bell-schedule.json failed schema:\n` +
            JSON.stringify(validate.errors, null, 2),
        );
      }
      expect(ok).toBe(true);
    },
  );
});

describe('pabson-saraswati-bs-2083 dossier anchors', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';

  it('has exactly 2 regular-day shifts (Morning Routine + Day Academic)', () => {
    const bs = loadBellSchedule(PILOT_ID);
    expect(bs.shifts.length).toBe(2);
  });

  it('Morning Routine: non-academic, 05:30–09:00, no periods', () => {
    const bs = loadBellSchedule(PILOT_ID);
    const morning = bs.shifts.find((s) => s.id === 'morning-routine');
    expect(morning).toBeDefined();
    if (!morning) return; // type guard
    expect(morning.scope).toBe('non-academic');
    expect(morning.startTime).toBe('05:30');
    expect(morning.endTime).toBe('09:00');
    expect(morning.periods).toBeUndefined();
  });

  it('Day Academic: academic, 10:00–16:00, 8 periods × 45 min', () => {
    const bs = loadBellSchedule(PILOT_ID);
    const day = bs.shifts.find((s) => s.id === 'day-academic');
    expect(day).toBeDefined();
    if (!day) return;
    expect(day.scope).toBe('academic');
    expect(day.startTime).toBe('10:00');
    expect(day.endTime).toBe('16:00');
    expect(day.periods).toBeDefined();
    expect(day.periods!.length).toBe(8);
    for (const period of day.periods!) {
      const len = toMinutes(period.endTime) - toMinutes(period.startTime);
      expect(len).toBe(45);
    }
  });

  it('Exam-day variant: 4 blocks × 90 min, 10:00–16:00', () => {
    const bs = loadBellSchedule(PILOT_ID);
    expect(bs.examDayShifts).toBeDefined();
    expect(bs.examDayShifts!.length).toBe(1);
    const exam = bs.examDayShifts![0];
    expect(exam.scope).toBe('academic');
    expect(exam.startTime).toBe('10:00');
    expect(exam.endTime).toBe('16:00');
    expect(exam.periods).toBeDefined();
    expect(exam.periods!.length).toBe(4);
    for (const block of exam.periods!) {
      const len = toMinutes(block.endTime) - toMinutes(block.startTime);
      expect(len).toBe(90);
    }
  });

  it('Day Academic periods are contiguous (no gaps)', () => {
    const bs = loadBellSchedule(PILOT_ID);
    const day = bs.shifts.find((s) => s.id === 'day-academic');
    if (!day || !day.periods) return;
    const sorted = [...day.periods].sort(
      (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
    );
    for (let i = 1; i < sorted.length; i++) {
      expect(toMinutes(sorted[i].startTime)).toBe(toMinutes(sorted[i - 1].endTime));
    }
  });
});

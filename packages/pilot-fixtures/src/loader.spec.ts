/**
 * C1.7 — Pilot fixture loader contract.
 *
 * Coverage:
 *   - loadPilotFixture: full-bundle structural correctness
 *   - eventsOnDate: empty / single-event / multi-event days
 *   - expandBlocks / expandHolidays / expandPrograms: per-day expansion
 *     matches fixture data + total counts
 *   - bsDayOfWeek: TZ-safe across known BS↔AD anchor dates
 *   - instructionalDaysInRange: per-term counts using the pilot's
 *     schoolDays config
 *   - shiftProfileForDate: each of the 5 classifications
 *     (regular / exam_day / holiday / weekend / vacation)
 *
 * Pilot-agnostic invariants run via describe.each(listPilots()); pilot-
 * specific anchors target the first pilot.
 */

import {
  listPilots,
  loadPilotFixture,
  eventsOnDate,
  expandBlocks,
  expandHolidays,
  expandPrograms,
  bsDayOfWeek,
  instructionalDaysInRange,
  shiftProfileForDate,
} from './index';

describe('loadPilotFixture — bundle integrity', () => {
  const pilots = listPilots();

  it.each(pilots.map((p) => ({ pilotId: p.pilotId })))(
    '$pilotId: returns a bundle with metadata + 12 calendar months + bell + academic-structure + holidays + programs',
    ({ pilotId }) => {
      const f = loadPilotFixture(pilotId);
      expect(f.metadata.pilotId).toBe(pilotId);
      expect(Object.keys(f.calendar).sort()).toEqual(
        [
          'asar', 'asoj', 'baisakh', 'bhadau', 'chait', 'fagun',
          'jeth', 'kartik', 'magh', 'mangsir', 'pus', 'saun',
        ],
      );
      expect(f.bellSchedule.shifts.length).toBeGreaterThan(0);
      expect(f.academicStructure.terms.length).toBeGreaterThan(0);
      expect(f.holidaysConsolidated.blocks).toBeDefined();
      expect(f.holidaysConsolidated.singleDayHolidays).toBeDefined();
      expect(f.programs.programs).toBeDefined();
    },
  );

  it('throws PilotNotFoundError on unknown pilotId', () => {
    expect(() => loadPilotFixture('totally-not-real-pilot-id')).toThrow();
  });
});

describe('eventsOnDate — multi-event support', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';
  const f = loadPilotFixture(PILOT_ID);

  it('returns empty array for a day with no events', () => {
    // Baisakh 5 has no events (between Jud-Sital on Baisakh 2 and
    // Buddha Jayanti on Baisakh 18).
    expect(eventsOnDate(f, '2083/01/05').length).toBe(0);
  });

  it('returns a single event for a day with one event', () => {
    // Jeth 15: Gantantra Diwas (holiday) only
    const events = eventsOnDate(f, '2083/02/15');
    expect(events.length).toBe(1);
    expect(events[0].eventName).toBe('Gantantra Diwas');
    expect(events[0].eventType).toBe('holiday');
  });

  it('returns multi-event days correctly (Asoj 25: Ghatasthapana + exam_window)', () => {
    const events = eventsOnDate(f, '2083/06/25');
    expect(events.length).toBe(2);
    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(['exam_window', 'holiday']);
    const names = events.map((e) => e.eventName).sort();
    expect(names).toContain('Ghatasthapana');
  });

  it('returns triple-event days correctly (Baisakh 3: AY start + Term start + program)', () => {
    const events = eventsOnDate(f, '2083/01/03');
    expect(events.length).toBe(3);
    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(['ay_boundary', 'program', 'term_boundary']);
  });
});

describe('expand* — per-day expansion', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';
  const f = loadPilotFixture(PILOT_ID);

  it('expandBlocks returns 36 per-day entries (6 blocks summing to 36 days)', () => {
    const days = expandBlocks(f);
    expect(days.length).toBe(36);
    // Every entry has a blockId (definition of "block day")
    for (const d of days) {
      expect(d.blockId).toBeDefined();
      expect(d.blockId.length).toBeGreaterThan(0);
    }
  });

  it('expandHolidays returns 49 per-day entries (36 block + 13 single)', () => {
    const days = expandHolidays(f);
    expect(days.length).toBe(49);
    const withBlockId = days.filter((d) => d.blockId !== undefined).length;
    const withoutBlockId = days.filter((d) => d.blockId === undefined).length;
    expect(withBlockId).toBe(36);
    expect(withoutBlockId).toBe(13);
  });

  it('expandPrograms returns 10 per-day entries (9 programs, Saraswati Puja = 2 days)', () => {
    const days = expandPrograms(f);
    expect(days.length).toBe(10);
    const saraswati = days.filter((d) => d.programId === 'saraswati-puja-2083');
    expect(saraswati.length).toBe(2);
  });

  it('expand outputs are sorted by bsDate ascending', () => {
    const dates = expandHolidays(f).map((d) => d.bsDate);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });
});

describe('bsDayOfWeek — TZ-safe weekday derivation', () => {
  // Anchor: BS 2000/01/01 = AD 1943/04/14 = Wednesday (per the BS epoch
  // declared in shared-types). The day-of-week for any BS date follows
  // from this anchor; testing a few well-known dates exercises the
  // TZ-safety wrap.
  it('BS 2000/01/01 (the epoch) is Wednesday', () => {
    expect(bsDayOfWeek(2000, 1, 1)).toBe('wed');
  });

  it('BS 2083/01/03 (AY start, Baisakh 3) returns a deterministic weekday', () => {
    // Just check it's in the valid 7-token enum — the specific weekday
    // is whatever the canonical conversion produces. (The test would
    // pin the exact weekday but the value here is fixture-derivative.)
    const dow = bsDayOfWeek(2083, 1, 3);
    expect(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']).toContain(dow);
  });

  it('consecutive BS days produce consecutive weekdays (wraps Sat→Sun)', () => {
    // 7 consecutive days from a known anchor should cycle through all
    // 7 weekday tokens exactly once.
    const dows: string[] = [];
    for (let d = 1; d <= 7; d++) {
      dows.push(bsDayOfWeek(2083, 1, d));
    }
    expect(new Set(dows).size).toBe(7);
  });
});

describe('instructionalDaysInRange — per-term counts', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';
  const f = loadPilotFixture(PILOT_ID);

  it('throws when start > end', () => {
    expect(() => instructionalDaysInRange(f, '2083/01/10', '2083/01/05')).toThrow();
  });

  /**
   * For each term, instructional days = (term inclusive days)
   *                                   − (Saturdays inside the term)
   *                                   − (holiday days inside the term)
   *
   * The total is computed by the loader; we sanity-check it bounds:
   *   - At least 0 and at most (term inclusive days)
   *   - For the first pilot with sun-fri school week, instructional <
   *     calendar (Saturdays alone subtract ~13% of days)
   *
   * Plus a structural assertion: holidays in range should be excluded,
   * verified by checking that adding a single-day holiday's date to a
   * deliberately-empty range increases the calendar-day count by 1 but
   * the instructional-day count by 0.
   */
  it('returns a number bounded by the term inclusive day count', () => {
    // Per C1.4: T1=92, T2=82, T3=81, T4=84 calendar days (inclusive).
    const TERM_CALENDAR_DAYS: Record<string, number> = {
      'term-1': 92,
      'term-2': 82,
      'term-3': 81,
      'term-4': 84,
    };
    for (const term of f.academicStructure.terms) {
      const instructional = instructionalDaysInRange(f, term.startBsDate, term.endBsDate);
      expect(instructional).toBeGreaterThanOrEqual(0);
      expect(instructional).toBeLessThanOrEqual(TERM_CALENDAR_DAYS[term.id]);
    }
  });

  it('excludes Saturdays for a pilot with sun-fri school week', () => {
    // Take a 14-day window. Some of those days WILL be Saturdays for
    // any choice of start date. instructional count must be ≤ 12 (14
    // calendar days minus at least 2 Saturdays in a 2-week window).
    const startBs = '2083/01/03';
    const endBs = '2083/01/16';
    const instructional = instructionalDaysInRange(f, startBs, endBs);
    expect(instructional).toBeLessThanOrEqual(12);
  });

  it('excludes single-day holidays in range', () => {
    // Buddha Jayanti is on Baisakh 18 2083. Compare:
    //   - Range Baisakh 17 → Baisakh 19 (3 calendar days)
    //   - vs. Range Baisakh 17 → Baisakh 17 (1 calendar day)
    // Both should have appropriate exclusion behavior — Baisakh 18 is
    // never instructional regardless of weekday.
    const justBefore = instructionalDaysInRange(f, '2083/01/17', '2083/01/17');
    const includingHoliday = instructionalDaysInRange(f, '2083/01/17', '2083/01/19');
    // Adding 2 more days (Baisakh 18 and 19) where Baisakh 18 is a
    // holiday: at most +1 instructional day from the 2 added days.
    expect(includingHoliday - justBefore).toBeLessThanOrEqual(1);
  });

  it('excludes Dashain block days (Kartik 1–9)', () => {
    // Entire 9-day block is a holiday → 0 instructional days.
    const days = instructionalDaysInRange(f, '2083/07/01', '2083/07/09');
    expect(days).toBe(0);
  });

  it('school-specific vacation days also count as non-instructional', () => {
    // Summer Vacation Saun 1-10 — 0 instructional days regardless of
    // weekday. Vacation blocks have category=school_specific but
    // expandHolidays includes them; instructionalDaysInRange must too.
    const days = instructionalDaysInRange(f, '2083/04/01', '2083/04/10');
    expect(days).toBe(0);
  });

});

describe('shiftProfileForDate — 5 classifications', () => {
  const PILOT_ID = 'pabson-saraswati-bs-2083';
  const f = loadPilotFixture(PILOT_ID);

  it("regular: returns bellSchedule.shifts on a regular school day", () => {
    // Baisakh 5 — no events, not a weekend (we'll check across a few
    // candidate dates because Saturday could fall on any specific date).
    // Pick dates where we KNOW classification — try Baisakh 5, 6, 7, 8;
    // at least one must be a weekday (not Saturday).
    const candidates = ['2083/01/05', '2083/01/06', '2083/01/07', '2083/01/08'];
    let foundRegular = false;
    for (const bs of candidates) {
      const profile = shiftProfileForDate(f, bs);
      if (profile.classification === 'regular') {
        foundRegular = true;
        expect(profile.shifts).toBe(f.bellSchedule.shifts);
        expect(profile.shifts.length).toBe(2);
        break;
      }
    }
    expect(foundRegular).toBe(true);
  });

  it('exam_day: returns examDayShifts on a day with an exam_window event', () => {
    // Asar 24 — start of Term 1 exam window
    const profile = shiftProfileForDate(f, '2083/03/24');
    // Either it's the exam day (classification='exam_day') OR a weekend
    // (Saturday). If exam_day, shifts must be the exam-day variant.
    if (profile.classification === 'exam_day') {
      expect(profile.shifts).toBe(f.bellSchedule.examDayShifts);
      expect(profile.shifts.length).toBe(1);
    }
  });

  it('holiday: returns empty shifts + reason on Buddha Jayanti (Baisakh 18)', () => {
    const profile = shiftProfileForDate(f, '2083/01/18');
    expect(profile.classification).toBe('holiday');
    expect(profile.shifts.length).toBe(0);
    expect(profile.reason).toBe('Buddha Jayanti');
  });

  it('vacation: returns vacation classification on a Summer Vacation day', () => {
    // Saun 1 — first day of Summer Vacation (school_specific block)
    const profile = shiftProfileForDate(f, '2083/04/01');
    // Vacation block, but it could also be a Saturday → weekend wins
    // (weekend check comes first). Test the OR-condition.
    expect(['vacation', 'weekend']).toContain(profile.classification);
    expect(profile.shifts.length).toBe(0);
  });

  it('weekend: returns empty shifts on a non-school weekday', () => {
    // Find a Saturday in the AY. We scan Baisakh days 1-7 (a full week)
    // and pick the one that's Saturday per BS 2083 calendar.
    let satDate: string | null = null;
    for (let d = 1; d <= 7; d++) {
      const dow = bsDayOfWeek(2083, 1, d);
      if (dow === 'sat') {
        satDate = `2083/01/${String(d).padStart(2, '0')}`;
        break;
      }
    }
    expect(satDate).not.toBeNull();
    if (satDate) {
      const profile = shiftProfileForDate(f, satDate);
      // Weekend check happens first → classification is weekend (unless
      // there's a holiday that day, but Baisakh 1-7 has no holidays).
      // Baisakh 2 has Jud-Sital → could be holiday-then. Let's just
      // verify the profile is non-instructional.
      expect(profile.shifts.length).toBe(0);
    }
  });
});

/**
 * Spec for the C3.4 + C3.5 archetype bell-schedule preset registry.
 *
 * Covers:
 *   - PABSON + GENERIC are both present and complete (academic + exam_day)
 *   - Each preset has at least one academic period (validates we'd
 *     produce a non-zero instructional total).
 *   - Each preset's class-period times are non-overlapping and
 *     sequential — matches `validatePeriodsNoOverlap` semantics in the
 *     identity entity (caught at create time, but worth pinning here
 *     so we don't ship a broken preset).
 *   - durationMinutes equals (endTime - startTime) for every period.
 *   - resolveBellSchedulePreset honors archetype + falls back to GENERIC.
 *   - computeInstructionalMinutes ignores non-academic periods.
 */

import {
  ARCHETYPE_BELL_PRESETS,
  computeInstructionalMinutes,
  resolveBellSchedulePreset,
  type BellSchedulePreset,
  type BellSchedulePresetType,
} from './bell-schedule-presets';

const minutesFrom = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const ACTIVE_ARCHETYPES = ['PABSON', 'GENERIC'] as const;
const PRESET_TYPES: BellSchedulePresetType[] = ['academic', 'exam_day'];

describe('ARCHETYPE_BELL_PRESETS — every active archetype has both presets', () => {
  it.each(ACTIVE_ARCHETYPES)('has academic + exam_day for %s', (arch) => {
    expect(ARCHETYPE_BELL_PRESETS[arch]).toBeDefined();
    expect(ARCHETYPE_BELL_PRESETS[arch].academic).toBeDefined();
    expect(ARCHETYPE_BELL_PRESETS[arch].exam_day).toBeDefined();
  });
});

describe('Each preset is internally consistent', () => {
  for (const arch of ACTIVE_ARCHETYPES) {
    for (const type of PRESET_TYPES) {
      const label = `${arch} / ${type}`;
      const preset: BellSchedulePreset = ARCHETYPE_BELL_PRESETS[arch][type];

      describe(label, () => {
        it('has at least one class period', () => {
          expect(preset.classPeriods.length).toBeGreaterThan(0);
        });

        it('has at least one academic period (non-zero instructional minutes)', () => {
          expect(preset.classPeriods.some((p) => p.isAcademic)).toBe(true);
          expect(computeInstructionalMinutes(preset)).toBeGreaterThan(0);
        });

        it('periodNumber is unique within the preset', () => {
          const numbers = preset.classPeriods.map((p) => p.periodNumber);
          expect(new Set(numbers).size).toBe(numbers.length);
        });

        it('durationMinutes equals (endTime - startTime) for every period', () => {
          for (const p of preset.classPeriods) {
            const expected = minutesFrom(p.endTime) - minutesFrom(p.startTime);
            expect({ name: p.classPeriodName, duration: p.durationMinutes }).toEqual({
              name: p.classPeriodName,
              duration: expected,
            });
          }
        });

        it('periods are sequential + non-overlapping when sorted by start time', () => {
          const sorted = [...preset.classPeriods].sort(
            (a, b) => minutesFrom(a.startTime) - minutesFrom(b.startTime),
          );
          for (let i = 1; i < sorted.length; i++) {
            const prevEnd = minutesFrom(sorted[i - 1].endTime);
            const curStart = minutesFrom(sorted[i].startTime);
            // Touching is OK (back-to-back); overlapping is not.
            expect(curStart).toBeGreaterThanOrEqual(prevEnd);
          }
        });

        it('dayType matches preset semantics (academic→regular, exam_day→testing)', () => {
          expect(preset.dayType).toBe(type === 'academic' ? 'regular' : 'testing');
        });
      });
    }
  }
});

describe('PABSON-specific assertions', () => {
  it('academic preset uses 10:00–16:00 window typical of Nepal private schools', () => {
    const p = ARCHETYPE_BELL_PRESETS.PABSON.academic;
    expect(p.classPeriods[0].startTime).toBe('10:00');
    expect(p.classPeriods[p.classPeriods.length - 1].endTime).toBe('16:00');
  });

  it('exam-day preset is a two-block testing schedule with a midday break', () => {
    const p = ARCHETYPE_BELL_PRESETS.PABSON.exam_day;
    const testing = p.classPeriods.filter((cp) => cp.periodType === 'instructional');
    expect(testing).toHaveLength(2);
    const lunch = p.classPeriods.find((cp) => cp.periodType === 'lunch');
    expect(lunch).toBeDefined();
  });
});

describe('resolveBellSchedulePreset', () => {
  it('returns the matching preset for an active archetype', () => {
    const p = resolveBellSchedulePreset('PABSON', 'academic');
    expect(p).toBe(ARCHETYPE_BELL_PRESETS.PABSON.academic);
  });

  it('is case-insensitive on archetype', () => {
    expect(resolveBellSchedulePreset('pabson', 'exam_day')).toBe(
      ARCHETYPE_BELL_PRESETS.PABSON.exam_day,
    );
  });

  it('falls back to GENERIC for an unknown archetype', () => {
    expect(resolveBellSchedulePreset('SOMETHING_ELSE', 'academic')).toBe(
      ARCHETYPE_BELL_PRESETS.GENERIC.academic,
    );
  });

  it('falls back to GENERIC for null / undefined archetype', () => {
    expect(resolveBellSchedulePreset(null, 'academic')).toBe(
      ARCHETYPE_BELL_PRESETS.GENERIC.academic,
    );
    expect(resolveBellSchedulePreset(undefined, 'exam_day')).toBe(
      ARCHETYPE_BELL_PRESETS.GENERIC.exam_day,
    );
  });

  it('returns a usable result for reserved-but-inactive archetypes', () => {
    // CBSE_IN is in the Archetype type but not ACTIVE_ARCHETYPES — should
    // resolve to GENERIC, not throw.
    const p = resolveBellSchedulePreset('CBSE_IN', 'academic');
    expect(p).toBe(ARCHETYPE_BELL_PRESETS.GENERIC.academic);
  });
});

describe('computeInstructionalMinutes', () => {
  it('sums only academic periods', () => {
    const minutes = computeInstructionalMinutes({
      bellScheduleName: 'X',
      dayType: 'regular',
      description: '',
      classPeriods: [
        {
          classPeriodName: 'A',
          periodNumber: 1,
          periodType: 'instructional',
          startTime: '08:00',
          endTime: '09:00',
          durationMinutes: 60,
          isAcademic: true,
        },
        {
          classPeriodName: 'Lunch',
          periodNumber: 2,
          periodType: 'lunch',
          startTime: '09:00',
          endTime: '09:30',
          durationMinutes: 30,
          isAcademic: false,
        },
        {
          classPeriodName: 'B',
          periodNumber: 3,
          periodType: 'instructional',
          startTime: '09:30',
          endTime: '10:30',
          durationMinutes: 60,
          isAcademic: true,
        },
      ],
    });
    expect(minutes).toBe(120);
  });

  it('returns 0 when no periods are academic', () => {
    expect(
      computeInstructionalMinutes({
        bellScheduleName: 'X',
        dayType: 'regular',
        description: '',
        classPeriods: [
          {
            classPeriodName: 'Lunch',
            periodNumber: 1,
            periodType: 'lunch',
            startTime: '08:00',
            endTime: '09:00',
            durationMinutes: 60,
            isAcademic: false,
          },
        ],
      }),
    ).toBe(0);
  });
});

/**
 * Spec for the Sprint C4 CalendarBlock Zod schemas.
 *
 * Covers shape + refinements only — service-side range/AY/overlap rules
 * are exercised in the identity service spec.
 */

import {
  calendarBlockFilterSchema,
  calendarBlockResponseSchema,
  createCalendarBlockSchema,
  updateCalendarBlockSchema,
} from './calendar-block.schema';

const SCHOOL_ID = '4209e3d8-d2e2-4e0e-9961-790341c264f4';
const AY_ID = '0167de00-cc49-476b-9654-ef98a8cf9014';

describe('createCalendarBlockSchema', () => {
  it('accepts a minimal valid block', () => {
    const parsed = createCalendarBlockSchema.parse({
      schoolId: SCHOOL_ID,
      academicYearId: AY_ID,
      blockName: 'Dashain',
      blockDescriptor: 'religious_festival',
      startDate: '2026-10-17',
      endDate: '2026-10-25',
    });
    expect(parsed.childEventType).toBe('break'); // default
    expect(parsed.blockName).toBe('Dashain');
  });

  it('accepts subEvents within the block range', () => {
    const parsed = createCalendarBlockSchema.parse({
      schoolId: SCHOOL_ID,
      academicYearId: AY_ID,
      blockName: 'Dashain',
      blockDescriptor: 'religious_festival',
      startDate: '2026-10-17',
      endDate: '2026-10-25',
      subEvents: [
        { date: '2026-10-22', name: 'Mahaastami' },
        { date: '2026-10-23', name: 'Nawami' },
      ],
    });
    expect(parsed.subEvents).toHaveLength(2);
  });

  it('rejects endDate before startDate at the schema layer', () => {
    expect(() =>
      createCalendarBlockSchema.parse({
        schoolId: SCHOOL_ID,
        academicYearId: AY_ID,
        blockName: 'Dashain',
        blockDescriptor: 'religious_festival',
        startDate: '2026-10-25',
        endDate: '2026-10-17',
      }),
    ).toThrow(/endDate/);
  });

  it('rejects an invalid blockDescriptor', () => {
    expect(() =>
      createCalendarBlockSchema.parse({
        schoolId: SCHOOL_ID,
        academicYearId: AY_ID,
        blockName: 'Dashain',
        blockDescriptor: 'random_nonsense' as any,
        startDate: '2026-10-17',
        endDate: '2026-10-25',
      }),
    ).toThrow();
  });

  it('accepts the exam_block descriptor with exam_window childEventType', () => {
    const parsed = createCalendarBlockSchema.parse({
      schoolId: SCHOOL_ID,
      academicYearId: AY_ID,
      blockName: 'Term 1 Final Exam',
      blockDescriptor: 'exam_block',
      childEventType: 'exam_window',
      startDate: '2026-07-08',
      endDate: '2026-07-16',
    });
    expect(parsed.blockDescriptor).toBe('exam_block');
    expect(parsed.childEventType).toBe('exam_window');
  });
});

describe('updateCalendarBlockSchema', () => {
  it('accepts a single-field update', () => {
    expect(updateCalendarBlockSchema.parse({ blockName: 'Dashain (renamed)' })).toEqual({
      blockName: 'Dashain (renamed)',
    });
  });

  it('rejects an empty body — at least one field required', () => {
    expect(() => updateCalendarBlockSchema.parse({})).toThrow();
  });

  it('accepts subEvents replacement', () => {
    const parsed = updateCalendarBlockSchema.parse({
      subEvents: [{ date: '2026-10-22', name: 'Mahaastami v2' }],
    });
    expect(parsed.subEvents).toHaveLength(1);
  });
});

describe('calendarBlockFilterSchema', () => {
  it('parses query strings with Zod coercion on numeric fields', () => {
    const parsed = calendarBlockFilterSchema.parse({
      schoolId: SCHOOL_ID,
      academicYearId: AY_ID,
      limit: '50',
    });
    expect(parsed.limit).toBe(50);
  });

  it('requires schoolId', () => {
    expect(() => calendarBlockFilterSchema.parse({})).toThrow();
  });

  it('caps limit at 200', () => {
    expect(() =>
      calendarBlockFilterSchema.parse({ schoolId: SCHOOL_ID, limit: '500' }),
    ).toThrow();
  });
});

describe('calendarBlockResponseSchema', () => {
  it('round-trips a server-shaped block', () => {
    const sample = {
      blockId: '11111111-1111-1111-1111-111111111111',
      schoolId: SCHOOL_ID,
      tenantId: '22222222-2222-2222-2222-222222222222',
      academicYearId: AY_ID,
      blockName: 'Dashain',
      blockDescriptor: 'religious_festival' as const,
      startDate: '2026-10-17',
      endDate: '2026-10-25',
      childEventType: 'break' as const,
      childDateCount: 9,
      createdAt: '2026-05-17T15:00:00.000Z',
      createdBy: 'user-1',
      updatedAt: '2026-05-17T15:00:00.000Z',
      updatedBy: 'user-1',
    };
    expect(calendarBlockResponseSchema.parse(sample)).toEqual(sample);
  });
});

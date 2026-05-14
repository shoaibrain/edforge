/**
 * GradingPeriod — Sprint S1 exam-date field tests.
 *
 * Schema-layer assertions only. Server-side range validation
 * (examStartDate inside [startDate, endDate] and examEndDate >= examStartDate)
 * is enforced in identity service (S1.2), not at the schema layer, because
 * cross-field date-range refinement on optional partial-update DTOs gets
 * messy and the server has more context (existing term state) to validate against.
 */

import {
  createGradingPeriodSchema,
  updateGradingPeriodSchema,
  gradingPeriodResponseSchema,
} from './academic-year.schema';

describe('createGradingPeriodSchema — S1 exam dates', () => {
  const base = {
    name: 'Term 1',
    termType: 'quarter' as const,
    sequence: 1,
    startDate: '2026-04-14',
    endDate: '2026-07-14',
  };

  it('accepts a create payload with exam dates inside term range', () => {
    const parsed = createGradingPeriodSchema.parse({
      ...base,
      examStartDate: '2026-07-01',
      examEndDate: '2026-07-07',
    });
    expect(parsed.examStartDate).toBe('2026-07-01');
    expect(parsed.examEndDate).toBe('2026-07-07');
  });

  it('accepts a create payload without exam dates (backward-compat)', () => {
    const parsed = createGradingPeriodSchema.parse(base);
    expect(parsed.examStartDate).toBeUndefined();
    expect(parsed.examEndDate).toBeUndefined();
  });

  it('rejects exam dates with malformed ISO format', () => {
    expect(() =>
      createGradingPeriodSchema.parse({
        ...base,
        examStartDate: '07/01/2026',
        examEndDate: '2026-07-07',
      }),
    ).toThrow();
  });
});

describe('updateGradingPeriodSchema — S1 exam dates', () => {
  it('accepts setting only the exam dates (partial update)', () => {
    const parsed = updateGradingPeriodSchema.parse({
      examStartDate: '2026-07-01',
      examEndDate: '2026-07-07',
    });
    expect(parsed.examStartDate).toBe('2026-07-01');
  });

  it('accepts clearing exam dates by omitting them', () => {
    const parsed = updateGradingPeriodSchema.parse({ name: 'Term 1 (rev)' });
    expect(parsed.examStartDate).toBeUndefined();
  });
});

describe('gradingPeriodResponseSchema — S1 exam dates', () => {
  it('preserves exam dates in the response shape', () => {
    const parsed = gradingPeriodResponseSchema.parse({
      termId: 'term-1',
      yearId: 'year-1',
      schoolId: 'school-1',
      name: 'Term 1',
      termType: 'quarter',
      sequence: 1,
      startDate: '2026-04-14',
      endDate: '2026-07-14',
      isActive: true,
      examStartDate: '2026-07-01',
      examEndDate: '2026-07-07',
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });
    expect(parsed.examStartDate).toBe('2026-07-01');
    expect(parsed.examEndDate).toBe('2026-07-07');
  });
});

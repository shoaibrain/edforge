/**
 * External Exam Shared schemas — Sprint D.3
 *
 * Coverage:
 *   - `examTypeSchema` — 4 accepted values; raw string rejected
 *   - `externalExamRegistrationStatusSchema` — 4 accepted values; raw string rejected
 *   - `bsYearSchema` — bounds from `bikram-sambat.ts` MIN/MAX_BS_YEAR; non-int rejected
 *
 * Total: 18 assertions (≥10 per `d3-sprint-plan.md` §1.4).
 */

import { describe, expect, it } from '@jest/globals';
import {
  examTypeSchema,
  EXAM_TYPES,
  externalExamRegistrationStatusSchema,
  EXTERNAL_EXAM_REGISTRATION_STATUSES,
  bsYearSchema,
} from './external-exam-shared.schema';
import { MIN_BS_YEAR, MAX_BS_YEAR } from '../../utils/bikram-sambat';

describe('examTypeSchema', () => {
  it.each(EXAM_TYPES)('accepts %s', (t) => {
    expect(examTypeSchema.parse(t)).toBe(t);
  });

  it('rejects raw string outside the enum', () => {
    expect(() => examTypeSchema.parse('ABE')).toThrow();
    expect(() => examTypeSchema.parse('ble')).toThrow();
    expect(() => examTypeSchema.parse('NEB-11')).toThrow();
    expect(() => examTypeSchema.parse('')).toThrow();
  });

  it('rejects non-string', () => {
    expect(() => examTypeSchema.parse(42)).toThrow();
    expect(() => examTypeSchema.parse(null)).toThrow();
    expect(() => examTypeSchema.parse(undefined)).toThrow();
  });

  it('EXAM_TYPES has exactly 4 entries', () => {
    expect(EXAM_TYPES).toHaveLength(4);
  });
});

describe('externalExamRegistrationStatusSchema', () => {
  it.each(EXTERNAL_EXAM_REGISTRATION_STATUSES)('accepts %s', (s) => {
    expect(externalExamRegistrationStatusSchema.parse(s)).toBe(s);
  });

  it('rejects raw string outside the enum', () => {
    expect(() => externalExamRegistrationStatusSchema.parse('draft')).toThrow();
    expect(() => externalExamRegistrationStatusSchema.parse('Submitted')).toThrow();
    expect(() => externalExamRegistrationStatusSchema.parse('')).toThrow();
  });

  it('EXTERNAL_EXAM_REGISTRATION_STATUSES has exactly 4 entries', () => {
    expect(EXTERNAL_EXAM_REGISTRATION_STATUSES).toHaveLength(4);
  });
});

describe('bsYearSchema', () => {
  it('accepts the BS epoch year (MIN_BS_YEAR)', () => {
    expect(bsYearSchema.parse(MIN_BS_YEAR)).toBe(MIN_BS_YEAR);
  });

  it('accepts the BS upper bound (MAX_BS_YEAR)', () => {
    expect(bsYearSchema.parse(MAX_BS_YEAR)).toBe(MAX_BS_YEAR);
  });

  it('accepts the PABSON pilot year (BS 2083)', () => {
    expect(bsYearSchema.parse(2083)).toBe(2083);
  });

  it('rejects below MIN_BS_YEAR', () => {
    expect(() => bsYearSchema.parse(MIN_BS_YEAR - 1)).toThrow();
  });

  it('rejects above MAX_BS_YEAR', () => {
    expect(() => bsYearSchema.parse(MAX_BS_YEAR + 1)).toThrow();
  });

  it('rejects negative', () => {
    expect(() => bsYearSchema.parse(-1)).toThrow();
  });

  it('rejects non-integer', () => {
    expect(() => bsYearSchema.parse(2083.5)).toThrow();
  });

  it('rejects non-number', () => {
    expect(() => bsYearSchema.parse('2083')).toThrow();
    expect(() => bsYearSchema.parse(null)).toThrow();
    expect(() => bsYearSchema.parse(undefined)).toThrow();
  });

  it('MIN/MAX_BS_YEAR exports match converter data table', () => {
    expect(MIN_BS_YEAR).toBe(2000);
    expect(MAX_BS_YEAR).toBe(2090);
  });
});

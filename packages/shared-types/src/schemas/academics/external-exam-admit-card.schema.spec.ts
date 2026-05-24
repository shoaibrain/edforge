/**
 * ExternalExamAdmitCard schema spec — Sprint D.3.3
 *
 * Per `d3-sprint-plan.md` §4 D.3.3. Total: 12 assertions.
 */

import { describe, expect, it } from '@jest/globals';
import {
  createExternalExamAdmitCardSchema,
  updateExternalExamAdmitCardSchema,
  externalExamAdmitCardResponseSchema,
} from './external-exam-admit-card.schema';

const REG = '11111111-1111-1111-1111-111111111111';
const STU = '22222222-2222-2222-2222-222222222222';
const SCH = '33333333-3333-3333-3333-333333333333';
const TEN = '44444444-4444-4444-4444-444444444444';
const CARD = '55555555-5555-5555-5555-555555555555';

const valid = {
  registrationId: REG,
  studentId: STU,
  schoolId: SCH,
  externalRollNumber: 'SYM-31012345-007',
  examCenterName: 'KMC Test Center 7',
  examCenterAddress: 'Putalisadak, Kathmandu',
  examDates: ['2026-12-01', '2026-12-03', '2026-12-05'],
  issuedAt: '2026-11-20T00:00:00.000Z',
};

describe('createExternalExamAdmitCardSchema', () => {
  it('accepts a well-formed row', () => {
    expect(createExternalExamAdmitCardSchema.parse(valid)).toMatchObject(valid);
  });

  it('rejects empty examDates[]', () => {
    expect(() =>
      createExternalExamAdmitCardSchema.parse({ ...valid, examDates: [] }),
    ).toThrow();
  });

  it("rejects examCenterName=''", () => {
    expect(() =>
      createExternalExamAdmitCardSchema.parse({ ...valid, examCenterName: '' }),
    ).toThrow();
  });

  it("rejects externalRollNumber=''", () => {
    expect(() =>
      createExternalExamAdmitCardSchema.parse({ ...valid, externalRollNumber: '' }),
    ).toThrow();
  });

  it('rejects examDates[] longer than 20', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    expect(() =>
      createExternalExamAdmitCardSchema.parse({ ...valid, examDates: tooMany }),
    ).toThrow();
  });

  it('rejects registrationId not UUID', () => {
    expect(() =>
      createExternalExamAdmitCardSchema.parse({ ...valid, registrationId: 'not-uuid' }),
    ).toThrow();
  });
});

describe('updateExternalExamAdmitCardSchema', () => {
  it('accepts pdfS3Url populated by C.4.3 renderer', () => {
    expect(
      updateExternalExamAdmitCardSchema.parse({
        pdfS3Url: 's3://edforge-renders/admit-cards/SYM-31012345-007.pdf',
      }),
    ).toBeTruthy();
  });

  it('accepts empty body (no-op)', () => {
    expect(updateExternalExamAdmitCardSchema.parse({})).toEqual({});
  });

  it("rejects pdfS3Url=''", () => {
    expect(() => updateExternalExamAdmitCardSchema.parse({ pdfS3Url: '' })).toThrow();
  });
});

describe('externalExamAdmitCardResponseSchema', () => {
  const baseResponse = {
    admitCardId: CARD,
    registrationId: REG,
    studentId: STU,
    schoolId: SCH,
    tenantId: TEN,
    externalRollNumber: 'SYM-31012345-007',
    examCenterName: 'KMC Test Center 7',
    examCenterAddress: 'Putalisadak, Kathmandu',
    examDates: ['2026-12-01', '2026-12-03'],
    issuedAt: '2026-11-20T00:00:00.000Z',
    createdAt: '2026-11-20T00:00:00.000Z',
    createdBy: 'u1',
    updatedAt: '2026-11-20T00:00:00.000Z',
    updatedBy: 'u1',
  };

  it('accepts pre-render response (pdfS3Url omitted)', () => {
    expect(externalExamAdmitCardResponseSchema.parse(baseResponse)).toBeTruthy();
  });

  it('accepts post-render response with pdfS3Url populated', () => {
    expect(
      externalExamAdmitCardResponseSchema.parse({
        ...baseResponse,
        pdfS3Url: 's3://edforge-renders/admit-cards/SYM-31012345-007.pdf',
      }),
    ).toBeTruthy();
  });

  it('accepts pdfS3Url=null (DDB-serialized form of "not yet rendered")', () => {
    expect(
      externalExamAdmitCardResponseSchema.parse({ ...baseResponse, pdfS3Url: null }),
    ).toBeTruthy();
  });
});

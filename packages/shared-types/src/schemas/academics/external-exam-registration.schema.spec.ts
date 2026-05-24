/**
 * ExternalExamRegistration schema spec — Sprint D.3.1
 *
 * Per `d3-sprint-plan.md` §4 D.3.1. Covers:
 *   - shape, range, enum membership (Zod-layer per §1.6 split)
 *   - cross-field refinements (`examType='BLE'` requires `municipalityId`;
 *     `examType ∈ {'SEE','NEB_11','NEB_12'}` requires `examAuthority='NEB'`)
 *   - update + response round-trip
 *
 * Total: 22 assertions (≥10 per §1.4 invariant gate).
 */

import { describe, expect, it } from '@jest/globals';
import {
  createExternalExamRegistrationSchema,
  updateExternalExamRegistrationSchema,
  externalExamRegistrationResponseSchema,
} from './external-exam-registration.schema';

const STUDENT = '11111111-1111-1111-1111-111111111111';
const ENROLL = '22222222-2222-2222-2222-222222222222';
const SCHOOL = '33333333-3333-3333-3333-333333333333';
const MUNI = '44444444-4444-4444-4444-444444444444';
const COURSE_A = '55555555-5555-5555-5555-555555555555';
const COURSE_B = '66666666-6666-6666-6666-666666666666';
const REG = '77777777-7777-7777-7777-777777777777';
const TENANT = '88888888-8888-8888-8888-888888888888';

const validBleBase = {
  studentId: STUDENT,
  enrollmentId: ENROLL,
  schoolId: SCHOOL,
  examType: 'BLE' as const,
  examYear: 2083,
  examAuthority: 'KMC_001',
  municipalityId: MUNI,
  courses: [COURSE_A, COURSE_B],
  registrationDate: '2026-04-15',
};

const validSeeBase = {
  studentId: STUDENT,
  enrollmentId: ENROLL,
  schoolId: SCHOOL,
  examType: 'SEE' as const,
  examYear: 2083,
  examAuthority: 'NEB',
  courses: [COURSE_A, COURSE_B],
  registrationDate: '2026-04-15',
};

describe('createExternalExamRegistrationSchema — shape', () => {
  it('accepts a well-formed BLE row', () => {
    expect(createExternalExamRegistrationSchema.parse(validBleBase)).toMatchObject(validBleBase);
  });

  it('accepts a well-formed SEE row with examAuthority=NEB and no municipalityId', () => {
    expect(createExternalExamRegistrationSchema.parse(validSeeBase)).toMatchObject(validSeeBase);
  });

  it('accepts NEB_11', () => {
    expect(
      createExternalExamRegistrationSchema.parse({
        ...validSeeBase,
        examType: 'NEB_11',
      }),
    ).toBeTruthy();
  });

  it('accepts NEB_12', () => {
    expect(
      createExternalExamRegistrationSchema.parse({
        ...validSeeBase,
        examType: 'NEB_12',
      }),
    ).toBeTruthy();
  });

  it('rejects examType outside the 4-enum', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({ ...validBleBase, examType: 'AP' }),
    ).toThrow();
  });

  it('rejects examYear below MIN_BS_YEAR', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({ ...validBleBase, examYear: 1999 }),
    ).toThrow();
  });

  it('rejects examYear above MAX_BS_YEAR', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({ ...validBleBase, examYear: 2091 }),
    ).toThrow();
  });

  it('rejects non-integer examYear', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({ ...validBleBase, examYear: 2083.5 }),
    ).toThrow();
  });

  it('rejects courses[] longer than 15', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
    );
    expect(() =>
      createExternalExamRegistrationSchema.parse({ ...validBleBase, courses: sixteen }),
    ).toThrow();
  });

  it('accepts empty courses[] at schema layer (service-layer rejects)', () => {
    expect(
      createExternalExamRegistrationSchema.parse({ ...validBleBase, courses: [] }),
    ).toBeTruthy();
  });

  it('rejects courses[] containing a non-UUID', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({ ...validBleBase, courses: ['not-a-uuid'] }),
    ).toThrow();
  });
});

describe('createExternalExamRegistrationSchema — cross-field refinements', () => {
  it('rejects BLE without municipalityId', () => {
    const { municipalityId: _drop, ...withoutMuni } = validBleBase;
    expect(() => createExternalExamRegistrationSchema.parse(withoutMuni)).toThrow(
      /municipalityId/,
    );
  });

  it('rejects SEE with examAuthority != "NEB"', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({
        ...validSeeBase,
        examAuthority: 'KMC_001',
      }),
    ).toThrow(/NEB/);
  });

  it('rejects NEB_11 with examAuthority != "NEB"', () => {
    expect(() =>
      createExternalExamRegistrationSchema.parse({
        ...validSeeBase,
        examType: 'NEB_11',
        examAuthority: 'BUMC_002',
      }),
    ).toThrow(/NEB/);
  });

  it('accepts BLE with any municipality CEHRD code as examAuthority', () => {
    expect(
      createExternalExamRegistrationSchema.parse({
        ...validBleBase,
        examAuthority: 'BUMC_002',
      }),
    ).toBeTruthy();
  });
});

describe('updateExternalExamRegistrationSchema', () => {
  it('accepts status-only update', () => {
    expect(updateExternalExamRegistrationSchema.parse({ status: 'SUBMITTED_TO_IEMIS' })).toEqual({
      status: 'SUBMITTED_TO_IEMIS',
    });
  });

  it('accepts symbolNumber + examCenter (the SYMBOL_ASSIGNED transition payload)', () => {
    expect(
      updateExternalExamRegistrationSchema.parse({
        status: 'SYMBOL_ASSIGNED',
        symbolNumber: 'SYM-31012345-007',
        examCenter: 'KMC Test Center 7',
      }),
    ).toBeTruthy();
  });

  it("rejects symbolNumber=''", () => {
    expect(() =>
      updateExternalExamRegistrationSchema.parse({ symbolNumber: '' }),
    ).toThrow();
  });

  it('rejects status outside the 4-enum', () => {
    expect(() =>
      updateExternalExamRegistrationSchema.parse({ status: 'submitted' }),
    ).toThrow();
  });
});

describe('externalExamRegistrationResponseSchema', () => {
  const baseResponse = {
    registrationId: REG,
    studentId: STUDENT,
    enrollmentId: ENROLL,
    schoolId: SCHOOL,
    tenantId: TENANT,
    examType: 'BLE' as const,
    examYear: 2083,
    examAuthority: 'KMC_001',
    municipalityId: MUNI,
    courses: [COURSE_A, COURSE_B],
    registrationDate: '2026-04-15',
    status: 'DRAFT' as const,
    createdAt: '2026-05-24T00:00:00.000Z',
    createdBy: 'u1',
    updatedAt: '2026-05-24T00:00:00.000Z',
    updatedBy: 'u1',
  };

  it('accepts DRAFT-state response with symbolNumber + examCenter omitted', () => {
    expect(externalExamRegistrationResponseSchema.parse(baseResponse)).toBeTruthy();
  });

  it('accepts SYMBOL_ASSIGNED response with sparse fields populated', () => {
    expect(
      externalExamRegistrationResponseSchema.parse({
        ...baseResponse,
        status: 'SYMBOL_ASSIGNED',
        symbolNumber: 'SYM-31012345-007',
        examCenter: 'KMC Test Center 7',
      }),
    ).toBeTruthy();
  });

  it('accepts CANCELLED response (terminal)', () => {
    expect(
      externalExamRegistrationResponseSchema.parse({ ...baseResponse, status: 'CANCELLED' }),
    ).toBeTruthy();
  });
});

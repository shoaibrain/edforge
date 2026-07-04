/**
 * BillingAgreement schema spec — EPIC-FB Sprint FB-2.1
 *
 * Coverage:
 *   - agreementStatusEnum / agreementTypeEnum (closed enums)
 *   - terms discriminated union (fixed_total | per_student)
 *   - EVERY superRefine branch, valid + invalid:
 *       · terms.agreementType ↔ top-level agreementType consistency
 *       · fixed_total: allocation sum (±0.01), distinctness, set-equality
 *       · per_student: line membership in studentIds
 *       · effectiveFrom < effectiveTo
 *   - create (server-assigned fields absent) / update (version required,
 *     type+terms travel together) / filter
 *   - P1d: isActive never in the response contract
 */

import {
  agreementStatusEnum,
  agreementTypeEnum,
  billingAgreementResponseSchema,
  createBillingAgreementSchema,
  updateBillingAgreementSchema,
  billingAgreementFilterSchema,
  type BillingAgreement,
} from './billing-agreement.schema';

const AGREEMENT_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUDENT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const FIXED_TERMS = {
  agreementType: 'fixed_total' as const,
  totalAmount: 40_000,
  allocation: [
    { studentId: STUDENT_A, amount: 25_000 },
    { studentId: STUDENT_B, amount: 15_000 },
  ],
};

const PER_STUDENT_TERMS = {
  agreementType: 'per_student' as const,
  lines: [
    { studentId: STUDENT_A, feeType: 'tuition' as const, amount: 30_000 },
    { studentId: STUDENT_A, feeType: 'admission' as const, amount: 5_000 },
  ],
};

const VALID_RESPONSE: Record<string, unknown> = {
  id: AGREEMENT_ID,
  schoolId: SCHOOL_ID,
  familyId: FAMILY_ID,
  title: 'Adhikari family deal — BS 2083',
  payer: { name: 'Ram Adhikari', phone: '+9779812345678' },
  studentIds: [STUDENT_A, STUDENT_B],
  agreementType: 'fixed_total',
  terms: FIXED_TERMS,
  coveredFeeTypes: ['tuition', 'admission'],
  billingFrequency: 'annual',
  currency: 'NPR',
  effectiveFrom: '2026-04-14',
  effectiveTo: '2027-04-13',
  status: 'draft',
  version: 1,
  statusHistory: [
    { from: '', to: 'draft', changedAt: '2026-07-04T10:00:00Z', changedBy: 'operator-1' },
  ],
  createdBy: 'operator-1',
  createdAt: '2026-07-04T10:00:00Z',
  updatedAt: '2026-07-04T10:00:00Z',
};

const VALID_CREATE: Record<string, unknown> = {
  familyId: FAMILY_ID,
  title: 'Adhikari family deal — BS 2083',
  payer: { name: 'Ram Adhikari' },
  studentIds: [STUDENT_A, STUDENT_B],
  agreementType: 'fixed_total',
  terms: FIXED_TERMS,
  coveredFeeTypes: ['tuition', 'admission'],
  billingFrequency: 'annual',
  currency: 'NPR',
  effectiveFrom: '2026-04-14',
  effectiveTo: '2027-04-13',
};

describe('agreement enums', () => {
  it('agreementStatusEnum has exactly the 5 lifecycle values', () => {
    expect(new Set(agreementStatusEnum.options)).toEqual(
      new Set(['draft', 'active', 'expired', 'cancelled', 'superseded']),
    );
    expect(agreementStatusEnum.safeParse('voided').success).toBe(false);
  });

  it('agreementTypeEnum has exactly fixed_total + per_student', () => {
    expect(new Set(agreementTypeEnum.options)).toEqual(new Set(['fixed_total', 'per_student']));
    expect(agreementTypeEnum.safeParse('discount_percent').success).toBe(false);
  });
});

describe('billingAgreementResponseSchema', () => {
  it('accepts a valid fixed_total family agreement', () => {
    const parsed: BillingAgreement = billingAgreementResponseSchema.parse(VALID_RESPONSE);
    expect(parsed.agreementType).toBe('fixed_total');
    expect(parsed.statusHistory).toHaveLength(1);
  });

  it('accepts the PR-CA per-student case: per_student type, one student, NO familyId', () => {
    const { familyId: _f, ...noFamily } = VALID_RESPONSE;
    const parsed = billingAgreementResponseSchema.parse({
      ...noFamily,
      studentIds: [STUDENT_A],
      agreementType: 'per_student',
      terms: PER_STUDENT_TERMS,
    });
    expect(parsed.familyId).toBeUndefined();
    expect(parsed.terms.agreementType).toBe('per_student');
  });

  it('P1d — isActive is NOT part of the response contract (stripped, never required)', () => {
    const parsed = billingAgreementResponseSchema.parse({ ...VALID_RESPONSE, isActive: true });
    expect('isActive' in parsed).toBe(false);
  });

  it('requires statusHistory (agreements are post-schema rows — no legacy sparse shape)', () => {
    const { statusHistory: _h, ...noHistory } = VALID_RESPONSE;
    expect(billingAgreementResponseSchema.safeParse(noHistory).success).toBe(false);
  });

  it('rejects title out of bounds (empty / >160) and version < 1 / non-int', () => {
    expect(billingAgreementResponseSchema.safeParse({ ...VALID_RESPONSE, title: '' }).success).toBe(false);
    expect(
      billingAgreementResponseSchema.safeParse({ ...VALID_RESPONSE, title: 'x'.repeat(161) }).success,
    ).toBe(false);
    expect(billingAgreementResponseSchema.safeParse({ ...VALID_RESPONSE, version: 0 }).success).toBe(false);
    expect(billingAgreementResponseSchema.safeParse({ ...VALID_RESPONSE, version: 1.5 }).success).toBe(false);
  });

  describe('studentIds bounds', () => {
    it('rejects duplicate studentIds', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          studentIds: [STUDENT_A, STUDENT_A],
        }).success,
      ).toBe(false);
    });

    it('rejects empty studentIds and >30 studentIds (R8 transactWrite bound)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({ ...VALID_RESPONSE, studentIds: [] }).success,
      ).toBe(false);

      const thirtyOne = Array.from(
        { length: 31 },
        (_, i) => `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
      );
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          studentIds: thirtyOne,
          agreementType: 'per_student',
          terms: { agreementType: 'per_student', lines: [{ studentId: thirtyOne[0], amount: 100 }] },
        }).success,
      ).toBe(false);
    });
  });

  describe('coveredFeeTypes', () => {
    it('rejects empty, duplicate, and unknown feeType values', () => {
      expect(
        billingAgreementResponseSchema.safeParse({ ...VALID_RESPONSE, coveredFeeTypes: [] }).success,
      ).toBe(false);
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          coveredFeeTypes: ['tuition', 'tuition'],
        }).success,
      ).toBe(false);
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          coveredFeeTypes: ['registration'],
        }).success,
      ).toBe(false);
    });
  });

  describe('superRefine — term dates', () => {
    it('rejects effectiveFrom === effectiveTo (strict <)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          effectiveFrom: '2026-04-14',
          effectiveTo: '2026-04-14',
        }).success,
      ).toBe(false);
    });

    it('rejects effectiveFrom after effectiveTo', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        effectiveFrom: '2027-04-14',
        effectiveTo: '2026-04-13',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(/strictly before/);
      }
    });
  });

  describe('superRefine — agreementType ↔ terms consistency', () => {
    it('rejects top-level fixed_total with per_student terms', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        studentIds: [STUDENT_A],
        agreementType: 'fixed_total',
        terms: PER_STUDENT_TERMS,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(
          /terms\.agreementType.*must match/,
        );
      }
    });

    it('rejects top-level per_student with fixed_total terms', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          agreementType: 'per_student',
          terms: FIXED_TERMS,
        }).success,
      ).toBe(false);
    });
  });

  describe('superRefine — fixed_total allocation invariants', () => {
    it('rejects allocation amounts that do not sum to totalAmount (beyond ±0.01)', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        terms: {
          ...FIXED_TERMS,
          allocation: [
            { studentId: STUDENT_A, amount: 25_000 },
            { studentId: STUDENT_B, amount: 15_000.02 },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(
          /must equal terms\.totalAmount/,
        );
      }
    });

    it('accepts sub-cent drift within the ±0.01 tolerance (SPEC-14 parity)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          terms: {
            ...FIXED_TERMS,
            allocation: [
              { studentId: STUDENT_A, amount: 25_000 },
              { studentId: STUDENT_B, amount: 15_000.005 },
            ],
          },
        }).success,
      ).toBe(true);
    });

    it('rejects duplicate studentIds inside allocation', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        terms: {
          ...FIXED_TERMS,
          allocation: [
            { studentId: STUDENT_A, amount: 25_000 },
            { studentId: STUDENT_A, amount: 15_000 },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(/must be distinct/);
      }
    });

    it('rejects when a top-level student has NO allocation entry (set-equality: missing side)', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        terms: {
          ...FIXED_TERMS,
          allocation: [{ studentId: STUDENT_A, amount: 40_000 }],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(/Missing allocation for/);
      }
    });

    it('rejects when allocation carries a student NOT in studentIds (set-equality: extra side)', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        terms: {
          ...FIXED_TERMS,
          totalAmount: 55_000,
          allocation: [
            { studentId: STUDENT_A, amount: 25_000 },
            { studentId: STUDENT_B, amount: 15_000 },
            { studentId: STUDENT_C, amount: 15_000 },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(/Not in studentIds/);
      }
    });

    it('rejects non-positive allocation amounts and totalAmount (field-level)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          terms: {
            ...FIXED_TERMS,
            allocation: [
              { studentId: STUDENT_A, amount: 0 },
              { studentId: STUDENT_B, amount: 40_000 },
            ],
          },
        }).success,
      ).toBe(false);
      expect(
        billingAgreementResponseSchema.safeParse({
          ...VALID_RESPONSE,
          terms: { ...FIXED_TERMS, totalAmount: -1 },
        }).success,
      ).toBe(false);
    });

    it('reports sum + distinctness + set-equality together on a maximally-broken terms block', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...VALID_RESPONSE,
        terms: {
          agreementType: 'fixed_total',
          totalAmount: 40_000,
          allocation: [
            { studentId: STUDENT_C, amount: 1_000 },
            { studentId: STUDENT_C, amount: 2_000 },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' | ');
        expect(messages).toMatch(/must equal terms\.totalAmount/);
        expect(messages).toMatch(/must be distinct/);
        expect(messages).toMatch(/Missing allocation for/);
      }
    });
  });

  describe('superRefine — per_student line invariants', () => {
    const perStudentBase = {
      ...VALID_RESPONSE,
      studentIds: [STUDENT_A, STUDENT_B],
      agreementType: 'per_student',
    };

    it('accepts multiple lines for the same student (tuition + admission negotiated separately)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({ ...perStudentBase, terms: PER_STUDENT_TERMS })
          .success,
      ).toBe(true);
    });

    it('accepts lines with an optional feeStructureId pin (feeType present)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...perStudentBase,
          terms: {
            agreementType: 'per_student',
            lines: [
              {
                studentId: STUDENT_A,
                feeType: 'tuition',
                feeStructureId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                amount: 30_000,
              },
              { studentId: STUDENT_B, feeType: 'admission', amount: 20_000 },
            ],
          },
        }).success,
      ).toBe(true);
    });

    it('rejects a feeType-less lump-sum line — not priceable until a lump-sum rule ships (review P2-1)', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...perStudentBase,
        terms: {
          agreementType: 'per_student',
          lines: [
            { studentId: STUDENT_A, feeType: 'tuition', amount: 30_000 },
            { studentId: STUDENT_B, amount: 20_000 },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('feeType is required');
      }
    });

    it('rejects a line whose studentId is not in the top-level studentIds', () => {
      const result = billingAgreementResponseSchema.safeParse({
        ...perStudentBase,
        terms: {
          agreementType: 'per_student',
          lines: [
            { studentId: STUDENT_A, feeType: 'tuition', amount: 30_000 },
            { studentId: STUDENT_C, feeType: 'tuition', amount: 30_000 },
          ],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' | ')).toMatch(
          /not in the top-level studentIds/,
        );
      }
    });

    it('rejects empty lines, non-positive amounts, and unknown feeType (field-level)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...perStudentBase,
          terms: { agreementType: 'per_student', lines: [] },
        }).success,
      ).toBe(false);
      expect(
        billingAgreementResponseSchema.safeParse({
          ...perStudentBase,
          terms: {
            agreementType: 'per_student',
            lines: [{ studentId: STUDENT_A, amount: -5 }],
          },
        }).success,
      ).toBe(false);
      expect(
        billingAgreementResponseSchema.safeParse({
          ...perStudentBase,
          terms: {
            agreementType: 'per_student',
            lines: [{ studentId: STUDENT_A, feeType: 'registration', amount: 100 }],
          },
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown terms discriminator (closed union)', () => {
      expect(
        billingAgreementResponseSchema.safeParse({
          ...perStudentBase,
          terms: { agreementType: 'discount_percent', lines: [] },
        }).success,
      ).toBe(false);
    });
  });
});

describe('createBillingAgreementSchema', () => {
  it('accepts a valid fixed_total create (schoolId comes from the route, not the body)', () => {
    const parsed = createBillingAgreementSchema.parse(VALID_CREATE);
    expect(parsed.title).toContain('Adhikari');
    expect('schoolId' in parsed).toBe(false);
  });

  it('accepts the PR-CA per-student create: one student, no familyId', () => {
    const { familyId: _f, ...noFamily } = VALID_CREATE;
    const parsed = createBillingAgreementSchema.parse({
      ...noFamily,
      studentIds: [STUDENT_A],
      agreementType: 'per_student',
      terms: PER_STUDENT_TERMS,
    });
    expect(parsed.familyId).toBeUndefined();
  });

  it('server-assigned fields (status, version, statusHistory) are stripped, never client-settable', () => {
    const parsed = createBillingAgreementSchema.parse({
      ...VALID_CREATE,
      status: 'active',
      version: 7,
      statusHistory: [],
    });
    expect('status' in parsed).toBe(false);
    expect('version' in parsed).toBe(false);
    expect('statusHistory' in parsed).toBe(false);
  });

  it('defaults currency to NPR when omitted', () => {
    const { currency: _c, ...noCurrency } = VALID_CREATE;
    expect(createBillingAgreementSchema.parse(noCurrency).currency).toBe('NPR');
  });

  it('enforces YYYY-MM-DD on effectiveFrom/effectiveTo (dateSchema)', () => {
    expect(
      createBillingAgreementSchema.safeParse({ ...VALID_CREATE, effectiveFrom: '2026-4-1' }).success,
    ).toBe(false);
    expect(
      createBillingAgreementSchema.safeParse({ ...VALID_CREATE, effectiveTo: 'not-a-date' }).success,
    ).toBe(false);
  });

  it('runs the shared superRefine branches (sum mismatch + date order + type/terms mismatch)', () => {
    expect(
      createBillingAgreementSchema.safeParse({
        ...VALID_CREATE,
        terms: { ...FIXED_TERMS, totalAmount: 99_999 },
      }).success,
    ).toBe(false);
    expect(
      createBillingAgreementSchema.safeParse({
        ...VALID_CREATE,
        effectiveFrom: '2027-04-14',
        effectiveTo: '2026-04-13',
      }).success,
    ).toBe(false);
    expect(
      createBillingAgreementSchema.safeParse({
        ...VALID_CREATE,
        studentIds: [STUDENT_A],
        agreementType: 'per_student',
        terms: FIXED_TERMS,
      }).success,
    ).toBe(false);
  });

  it('rejects notes > 500', () => {
    expect(
      createBillingAgreementSchema.safeParse({ ...VALID_CREATE, notes: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('updateBillingAgreementSchema', () => {
  it('requires version (optimistic concurrency in the body — PR-CA convention)', () => {
    expect(updateBillingAgreementSchema.safeParse({ title: 'Renamed deal' }).success).toBe(false);
    expect(updateBillingAgreementSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a version-only body and rejects non-int / <1 versions', () => {
    expect(updateBillingAgreementSchema.safeParse({ version: 3 }).success).toBe(true);
    expect(updateBillingAgreementSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(updateBillingAgreementSchema.safeParse({ version: 1.5 }).success).toBe(false);
  });

  it('excludes identity fields — id/schoolId in the body are stripped', () => {
    const parsed = updateBillingAgreementSchema.parse({
      version: 2,
      id: AGREEMENT_ID,
      schoolId: SCHOOL_ID,
      title: 'Renamed deal',
    });
    expect('id' in parsed).toBe(false);
    expect('schoolId' in parsed).toBe(false);
  });

  it('allows clearing the family linkage with familyId: null', () => {
    const parsed = updateBillingAgreementSchema.parse({ version: 2, familyId: null });
    expect(parsed.familyId).toBeNull();
  });

  it('requires agreementType and terms to travel together', () => {
    expect(
      updateBillingAgreementSchema.safeParse({ version: 2, agreementType: 'per_student' }).success,
    ).toBe(false);
    expect(
      updateBillingAgreementSchema.safeParse({ version: 2, terms: PER_STUDENT_TERMS }).success,
    ).toBe(false);
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        agreementType: 'per_student',
        terms: PER_STUDENT_TERMS,
      }).success,
    ).toBe(true);
  });

  it('rejects agreementType ↔ terms discriminator mismatch', () => {
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        agreementType: 'fixed_total',
        terms: PER_STUDENT_TERMS,
      }).success,
    ).toBe(false);
  });

  it('enforces terms-internal invariants even without studentIds in the payload', () => {
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        agreementType: 'fixed_total',
        terms: {
          agreementType: 'fixed_total',
          totalAmount: 40_000,
          allocation: [{ studentId: STUDENT_A, amount: 10_000 }], // sum ≠ total
        },
      }).success,
    ).toBe(false);
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        agreementType: 'fixed_total',
        terms: FIXED_TERMS, // internally consistent → OK without studentIds
      }).success,
    ).toBe(true);
  });

  it('checks terms against studentIds when BOTH are in the payload', () => {
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        studentIds: [STUDENT_A],
        agreementType: 'per_student',
        terms: {
          agreementType: 'per_student',
          lines: [{ studentId: STUDENT_B, feeType: 'tuition', amount: 100 }],
        },
      }).success,
    ).toBe(false);
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        studentIds: [STUDENT_A, STUDENT_B],
        agreementType: 'fixed_total',
        terms: FIXED_TERMS,
      }).success,
    ).toBe(true);
  });

  it('checks date ordering only when BOTH dates are present (partial semantics)', () => {
    expect(
      updateBillingAgreementSchema.safeParse({
        version: 2,
        effectiveFrom: '2027-04-14',
        effectiveTo: '2026-04-13',
      }).success,
    ).toBe(false);
    expect(
      updateBillingAgreementSchema.safeParse({ version: 2, effectiveFrom: '2027-04-14' }).success,
    ).toBe(true);
    expect(
      updateBillingAgreementSchema.safeParse({ version: 2, effectiveTo: '2026-04-13' }).success,
    ).toBe(true);
  });
});

describe('billingAgreementFilterSchema', () => {
  it('accepts empty and each filter independently', () => {
    expect(billingAgreementFilterSchema.safeParse({}).success).toBe(true);
    expect(billingAgreementFilterSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(billingAgreementFilterSchema.safeParse({ studentId: STUDENT_A }).success).toBe(true);
    expect(billingAgreementFilterSchema.safeParse({ familyId: FAMILY_ID }).success).toBe(true);
  });

  it('rejects unknown status and malformed uuids', () => {
    expect(billingAgreementFilterSchema.safeParse({ status: 'voided' }).success).toBe(false);
    expect(billingAgreementFilterSchema.safeParse({ studentId: 'nope' }).success).toBe(false);
    expect(billingAgreementFilterSchema.safeParse({ familyId: 'nope' }).success).toBe(false);
  });
});

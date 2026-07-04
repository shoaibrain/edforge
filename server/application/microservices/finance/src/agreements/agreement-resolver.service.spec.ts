/**
 * AgreementResolverService Spec — EPIC-FB FB-3.1
 *
 * Coverage:
 *   - constructed GSI2 key carries the TENANT#{tid} prefix (risk R1)
 *   - date-bounded key condition (gte 'AGREEMENT#active#{onDate}')
 *   - boundary dates: day before From / on From / on To / day after To
 *   - stale-active pointer past effectiveTo returns null (key-bound AND
 *     hydration-drift variants)
 *   - cancelled/superseded hydrated rows rejected (pointer never trusted)
 *   - school filtering; allocationForStudent per terms shape
 *   - per-call memo Map reuse (positive + negative results)
 */

import { AgreementResolverService } from './agreement-resolver.service';
import {
  AgreementMemberEntity,
  BillingAgreementEntity,
} from '../common/entities/billing-agreement.entity';
import { EntityKeyBuilder, GSIKeyBuilder } from '../common/entities/base.entity';

const TENANT    = '11111111-1111-1111-1111-111111111111';
const SCHOOL    = '22222222-2222-2222-2222-222222222222';
const STUDENT_A = '44444444-4444-4444-4444-444444444444';
const STUDENT_B = '55555555-5555-5555-5555-555555555555';

const ctx = {
  tenantId: TENANT,
  userId: 'user-1',
  email: 'admin@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt-x',
} as any;

const FROM = '2026-05-01';
const TO = '2026-05-31';

function makePointer(overrides: Partial<AgreementMemberEntity> = {}): AgreementMemberEntity {
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.agreementMember(SCHOOL, STUDENT_A, 'ag-1'),
    entityType: 'AGREEMENT_MEMBER',
    agreementId: 'ag-1',
    schoolId: SCHOOL,
    studentId: STUDENT_A,
    status: 'active',
    effectiveFrom: FROM,
    effectiveTo: TO,
    gsi2pk: GSIKeyBuilder.studentScope(TENANT, STUDENT_A),
    gsi2sk: `AGREEMENT#active#${TO}`,
    createdAt: '2026-04-01T00:00:00.000Z',
    createdBy: 'u',
    updatedAt: '2026-04-01T00:00:00.000Z',
    updatedBy: 'u',
    version: 1,
    ...overrides,
  };
}

function makeAgreement(overrides: Partial<BillingAgreementEntity> = {}): BillingAgreementEntity {
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.agreement(SCHOOL, 'ag-1'),
    entityType: 'AGREEMENT',
    agreementId: 'ag-1',
    schoolId: SCHOOL,
    title: 'Deal',
    payer: { name: 'Ram' },
    studentIds: [STUDENT_A, STUDENT_B],
    agreementType: 'fixed_total',
    terms: {
      agreementType: 'fixed_total',
      totalAmount: 40000,
      allocation: [
        { studentId: STUDENT_A, amount: 25000 },
        { studentId: STUDENT_B, amount: 15000 },
      ],
    },
    coveredFeeTypes: ['tuition'],
    billingFrequency: 'annual',
    currency: 'NPR',
    effectiveFrom: FROM,
    effectiveTo: TO,
    status: 'active',
    isActive: true,
    statusHistory: [],
    gsi1pk: GSIKeyBuilder.schoolScope(TENANT, SCHOOL),
    gsi1sk: `AGREEMENT#active#${FROM}`,
    createdAt: '2026-04-01T00:00:00.000Z',
    createdBy: 'u',
    updatedAt: '2026-04-01T00:00:00.000Z',
    updatedBy: 'u',
    version: 2,
    ...overrides,
  } as BillingAgreementEntity;
}

/**
 * Mock DDB that EMULATES the GSI2 range semantics: pointers whose gsi2sk
 * sorts BEFORE the gte bound are not returned (as real DynamoDB would).
 */
function makeMockDdb(pointers: AgreementMemberEntity[], agreements: BillingAgreementEntity[]) {
  const byKey = new Map(agreements.map((a) => [a.entityKey, a]));
  return {
    getClient: jest.fn().mockResolvedValue({}),
    queryGSI: jest.fn().mockImplementation(
      async (_client: unknown, _index: string, pk: string, skValue: string, skOperator: string) => {
        expect(skOperator).toBe('gte');
        const items = pointers.filter((p) => p.gsi2pk === pk && p.gsi2sk >= skValue);
        return { items, hasMore: false };
      },
    ),
    getItem: jest.fn().mockImplementation(async (_client: unknown, _tid: string, key: string) => {
      return byKey.get(key) ?? null;
    }),
  } as any;
}

describe('AgreementResolverService.getActiveAgreementForStudent', () => {
  it('constructs the GSI2 pk with the TENANT# prefix (risk R1) and a date-bounded gte sort key', async () => {
    const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
    const svc = new AgreementResolverService(ddb);

    await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);

    const [, index, pk, skValue, skOperator] = ddb.queryGSI.mock.calls[0];
    expect(index).toBe('GSI2');
    expect(pk).toBe(`TENANT#${TENANT}#STUDENT#${STUDENT_A}`);
    expect(pk.startsWith(`TENANT#${TENANT}#`)).toBe(true);
    expect(skValue).toBe('AGREEMENT#active#2026-05-15');
    expect(skOperator).toBe('gte');
  });

  describe('boundary dates', () => {
    it('day BEFORE effectiveFrom → null (hydration rejects; pointer is in key range)', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-04-30', ctx);
      expect(result).toBeNull();
    });

    it('ON effectiveFrom → resolves', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, FROM, ctx);
      expect(result?.agreement.agreementId).toBe('ag-1');
    });

    it('ON effectiveTo → resolves (inclusive last day — the reason the bound is >=, not >)', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, TO, ctx);
      expect(result?.agreement.agreementId).toBe('ag-1');
    });

    it('day AFTER effectiveTo → null (pointer excluded by the key range itself)', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-06-01', ctx);
      expect(result).toBeNull();
      expect(ddb.getItem).not.toHaveBeenCalled(); // never even hydrated
    });
  });

  it('stale-active pointer whose sk lies but the hydrated row is past effectiveTo → null (pointer NEVER trusted alone)', async () => {
    // Pointer drifted: sk claims effectiveTo 2026-12-31, agreement row says 2026-05-31.
    const driftedPointer = makePointer({ gsi2sk: 'AGREEMENT#active#2026-12-31', effectiveTo: '2026-12-31' });
    const ddb = makeMockDdb([driftedPointer], [makeAgreement()]);
    const svc = new AgreementResolverService(ddb);
    const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-07-15', ctx);
    expect(result).toBeNull();
    expect(ddb.getItem).toHaveBeenCalled(); // hydrated, then rejected on dates
  });

  it.each(['cancelled', 'superseded', 'draft', 'expired'] as const)(
    'hydrated %s agreement behind an in-range pointer → null',
    async (status) => {
      // Statuses sorting after 'active' land in the >= range — hydration is
      // the authority.
      const pointer = makePointer({ status, gsi2sk: `AGREEMENT#${status}#${TO}` });
      const ddb = makeMockDdb([pointer], [makeAgreement({ status })]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
      expect(result).toBeNull();
    },
  );

  it('filters pointers from other schools', async () => {
    const pointer = makePointer({ schoolId: 'other-school' });
    const ddb = makeMockDdb([pointer], [makeAgreement()]);
    const svc = new AgreementResolverService(ddb);
    const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
    expect(result).toBeNull();
  });

  it('rejects a hydrated agreement that no longer lists the student in studentIds', async () => {
    const ddb = makeMockDdb([makePointer()], [makeAgreement({ studentIds: [STUDENT_B] })]);
    const svc = new AgreementResolverService(ddb);
    const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
    expect(result).toBeNull();
  });

  it('rejects a soft-deleted hydrated agreement (isActive=false)', async () => {
    const ddb = makeMockDdb([makePointer()], [makeAgreement({ isActive: false })]);
    const svc = new AgreementResolverService(ddb);
    const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
    expect(result).toBeNull();
  });

  describe('allocationForStudent', () => {
    it('fixed_total → the student allocation entry amount', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
      expect(result?.allocationForStudent).toBe(25000);
    });

    it('per_student → sum of the student lines', async () => {
      const agreement = makeAgreement({
        agreementType: 'per_student',
        terms: {
          agreementType: 'per_student',
          lines: [
            { studentId: STUDENT_A, feeType: 'tuition', amount: 10000 },
            { studentId: STUDENT_A, feeType: 'admission', amount: 4000 },
            { studentId: STUDENT_B, feeType: 'tuition', amount: 9000 },
          ],
        } as any,
      });
      const ddb = makeMockDdb([makePointer()], [agreement]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
      expect(result?.allocationForStudent).toBe(14000);
    });

    it('per_student member with no lines → null allocation (agreement still returned)', async () => {
      const agreement = makeAgreement({
        agreementType: 'per_student',
        terms: {
          agreementType: 'per_student',
          lines: [{ studentId: STUDENT_B, feeType: 'tuition', amount: 9000 }],
        } as any,
      });
      const ddb = makeMockDdb([makePointer()], [agreement]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
      expect(result?.agreement.agreementId).toBe('ag-1');
      expect(result?.allocationForStudent).toBeNull();
    });
  });

  describe('per-call memoization (bulk-worker contract for Package E)', () => {
    it('serves repeat (student, date) resolutions from the memo without re-querying', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const memo = new Map();

      const first = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx, memo);
      const second = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx, memo);

      expect(second).toBe(first);
      expect(ddb.queryGSI).toHaveBeenCalledTimes(1);
      expect(ddb.getClient).toHaveBeenCalledTimes(1);
    });

    it('memoizes NEGATIVE results too', async () => {
      const ddb = makeMockDdb([], []);
      const svc = new AgreementResolverService(ddb);
      const memo = new Map();

      expect(await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx, memo)).toBeNull();
      expect(await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx, memo)).toBeNull();
      expect(ddb.queryGSI).toHaveBeenCalledTimes(1);
    });

    it('different onDate misses the memo (key includes the date)', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const memo = new Map();

      await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx, memo);
      await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-16', ctx, memo);
      expect(ddb.queryGSI).toHaveBeenCalledTimes(2);
    });

    it('works without a memo (single-invoice path)', async () => {
      const ddb = makeMockDdb([makePointer()], [makeAgreement()]);
      const svc = new AgreementResolverService(ddb);
      const result = await svc.getActiveAgreementForStudent(STUDENT_A, SCHOOL, '2026-05-15', ctx);
      expect(result?.agreement.agreementId).toBe('ag-1');
    });
  });
});

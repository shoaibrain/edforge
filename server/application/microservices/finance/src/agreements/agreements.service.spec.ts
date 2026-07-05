/**
 * AgreementsService Spec — EPIC-FB FB-2.3/2.4/2.5 + FB-3.5 + FB-3.6
 *
 * Mocked-DDB unit tests (fee-structures.service.spec.ts idiom):
 *   - every create rejection path (school/currency/dates/terms/enrollment/
 *     family/advisory-overlap)
 *   - transactWrite composition for create / draft update / cancel /
 *     activate / versioning
 *   - transition matrix enforced centrally
 *   - activation lock contention → 409 AGREEMENT_OVERLAP with studentId
 *     (CancellationReasons positional mapping)
 *   - acknowledgeOpenInvoices both paths
 *   - lazy-expiry presentation (display-only status flip, no write)
 */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AGREEMENT_TRANSITIONS,
  AgreementsService,
  assertAgreementInvariants,
  assertAgreementTransition,
} from './agreements.service';
import {
  BillingAgreementEntity,
  agreementLockTtl,
} from '../common/entities/billing-agreement.entity';
import { EntityKeyBuilder, GSIKeyBuilder } from '../common/entities/base.entity';
import { FinanceErrors } from '../common/errors/finance-errors';
import type { CreateBillingAgreementDto } from '@aibrains/shared-types';

const TENANT    = '11111111-1111-1111-1111-111111111111';
const SCHOOL    = '22222222-2222-2222-2222-222222222222';
const STUDENT_A = '44444444-4444-4444-4444-444444444444';
const STUDENT_B = '55555555-5555-5555-5555-555555555555';
const STUDENT_C = '66666666-6666-6666-6666-666666666666';
const FAMILY    = '77777777-7777-7777-7777-777777777777';

const ctx = {
  tenantId: TENANT,
  userId: 'user-1',
  email: 'admin@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt-x',
} as any;

const FUTURE_FROM = '2099-01-01';
const FUTURE_TO = '2099-12-31';

function makeCreateDto(overrides: Partial<CreateBillingAgreementDto> = {}): CreateBillingAgreementDto {
  return {
    title: 'Adhikari family deal',
    payer: { name: 'Ram Adhikari' },
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
    coveredFeeTypes: ['tuition', 'admission'],
    billingFrequency: 'annual',
    currency: 'NPR',
    effectiveFrom: FUTURE_FROM,
    effectiveTo: FUTURE_TO,
    ...overrides,
  } as CreateBillingAgreementDto;
}

function makeAgreementEntity(overrides: Partial<BillingAgreementEntity> = {}): BillingAgreementEntity {
  const agreementId = overrides.agreementId ?? 'ag-1';
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.agreement(SCHOOL, agreementId),
    entityType: 'AGREEMENT',
    agreementId,
    schoolId: SCHOOL,
    title: 'Adhikari family deal',
    payer: { name: 'Ram Adhikari' },
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
    coveredFeeTypes: ['tuition', 'admission'],
    billingFrequency: 'annual',
    currency: 'NPR',
    effectiveFrom: FUTURE_FROM,
    effectiveTo: FUTURE_TO,
    status: 'draft',
    isActive: true,
    statusHistory: [],
    gsi1pk: GSIKeyBuilder.schoolScope(TENANT, SCHOOL),
    gsi1sk: `AGREEMENT#draft#${FUTURE_FROM}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: 'user-0',
    updatedAt: '2026-07-01T00:00:00.000Z',
    updatedBy: 'user-0',
    version: 1,
    ...overrides,
  } as BillingAgreementEntity;
}

function makeMockDdb(overrides: Record<string, unknown> = {}) {
  return {
    getClient: jest.fn().mockResolvedValue({}),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    getItem: jest.fn().mockResolvedValue(null),
    putItem: jest.fn().mockResolvedValue(undefined),
    deleteItem: jest.fn().mockResolvedValue(undefined),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    batchGetItems: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function makeMockEvents() {
  return {
    publishAgreementCreated: jest.fn().mockResolvedValue(undefined),
    publishAgreementActivated: jest.fn().mockResolvedValue(undefined),
    publishAgreementCancelled: jest.fn().mockResolvedValue(undefined),
    publishAgreementVersioned: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockIdentity(overrides: Record<string, unknown> = {}) {
  return {
    validateSchoolExists: jest.fn().mockResolvedValue(true),
    getWorkspaceSettings: jest
      .fn()
      .mockResolvedValue({ regional: { defaultCurrency: 'NPR' } }),
    getStudentInfo: jest.fn().mockResolvedValue({
      studentId: STUDENT_A,
      firstName: 'Sita',
      lastName: 'Adhikari',
      gradeLevel: '5',
    }),
    getStudentFamily: jest.fn().mockResolvedValue({ family: { id: FAMILY } }),
    ...overrides,
  } as any;
}

function makeMockFeeStructures(overrides: Record<string, unknown> = {}) {
  return {
    getByIds: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function makeService(deps: {
  ddb?: any;
  events?: any;
  identity?: any;
  feeStructures?: any;
} = {}) {
  const ddb = deps.ddb ?? makeMockDdb();
  const events = deps.events ?? makeMockEvents();
  const identity = deps.identity ?? makeMockIdentity();
  const feeStructures = deps.feeStructures ?? makeMockFeeStructures();
  const svc = new AgreementsService(ddb, events, identity, feeStructures);
  return { svc, ddb, events, identity, feeStructures };
}

function transactCancelled(reasons: Array<{ Code: string }>): Error {
  const err = new Error('Transaction cancelled') as Error & {
    name: string;
    CancellationReasons: Array<{ Code: string }>;
  };
  err.name = 'TransactionCanceledException';
  err.CancellationReasons = reasons;
  return err;
}

// ============================================================================
// Transition matrix — enforced centrally (FB-2.4)
// ============================================================================

describe('assertAgreementTransition — matrix', () => {
  const legal: Array<[string, string]> = [
    ['draft', 'active'],
    ['draft', 'cancelled'],
    ['active', 'cancelled'],
    ['active', 'expired'],
    ['active', 'superseded'],
  ];
  const illegal: Array<[string, string]> = [
    ['draft', 'expired'],
    ['draft', 'superseded'],
    ['active', 'active'],
    ['active', 'draft'],
    ['expired', 'active'],
    ['expired', 'cancelled'],
    ['cancelled', 'active'],
    ['cancelled', 'draft'],
    ['superseded', 'active'],
    ['superseded', 'cancelled'],
  ];

  it.each(legal)('%s → %s is legal', (from, to) => {
    expect(() => assertAgreementTransition(from as any, to as any)).not.toThrow();
  });

  it.each(illegal)('%s → %s is rejected with AGREEMENT_INVALID_TRANSITION', (from, to) => {
    try {
      assertAgreementTransition(from as any, to as any);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_INVALID_TRANSITION);
    }
  });

  it('terminal states have empty transition sets', () => {
    expect(AGREEMENT_TRANSITIONS.expired).toEqual([]);
    expect(AGREEMENT_TRANSITIONS.cancelled).toEqual([]);
    expect(AGREEMENT_TRANSITIONS.superseded).toEqual([]);
  });
});

describe('assertAgreementInvariants — server-side re-assert (FB-2.3)', () => {
  it('rejects effectiveFrom >= effectiveTo', () => {
    expect(() =>
      assertAgreementInvariants({
        ...makeCreateDto(),
        effectiveFrom: '2099-12-31',
        effectiveTo: '2099-01-01',
      } as any),
    ).toThrow(BadRequestException);
  });

  it('rejects terms.agreementType mismatch', () => {
    expect(() =>
      assertAgreementInvariants({ ...makeCreateDto(), agreementType: 'per_student' } as any),
    ).toThrow(BadRequestException);
  });

  it('rejects allocation sum drift beyond 1 cent', () => {
    const dto = makeCreateDto();
    (dto.terms as any).totalAmount = 40001;
    expect(() => assertAgreementInvariants(dto as any)).toThrow(BadRequestException);
  });

  it('rejects allocation not covering studentIds', () => {
    const dto = makeCreateDto({ studentIds: [STUDENT_A, STUDENT_B, STUDENT_C] });
    expect(() => assertAgreementInvariants(dto as any)).toThrow(BadRequestException);
  });

  it('rejects per_student lines referencing non-members', () => {
    const dto = makeCreateDto({
      agreementType: 'per_student',
      terms: {
        agreementType: 'per_student',
        lines: [{ studentId: STUDENT_C, amount: 5000 }],
      } as any,
    });
    expect(() => assertAgreementInvariants(dto as any)).toThrow(BadRequestException);
  });

  it('accepts a consistent payload', () => {
    expect(() => assertAgreementInvariants(makeCreateDto() as any)).not.toThrow();
  });

  it('review F6 — rejects duplicate (studentId, feeType) pairs across per_student lines', () => {
    const dto = makeCreateDto({
      studentIds: [STUDENT_A],
      agreementType: 'per_student',
      terms: {
        agreementType: 'per_student',
        lines: [
          { studentId: STUDENT_A, feeType: 'tuition', amount: 20000 },
          { studentId: STUDENT_A, feeType: 'tuition', amount: 10000 },
        ],
      } as any,
    });
    expect(() => assertAgreementInvariants(dto as any)).toThrow(BadRequestException);
  });

  it('review F1 — rejects a covered member missing a (studentId, feeType) line; full matrix accepted', () => {
    const incomplete = makeCreateDto({
      agreementType: 'per_student',
      coveredFeeTypes: ['tuition'],
      terms: {
        agreementType: 'per_student',
        lines: [{ studentId: STUDENT_A, feeType: 'tuition', amount: 20000 }],
      } as any,
    });
    expect(() => assertAgreementInvariants(incomplete as any)).toThrow(BadRequestException);

    const complete = makeCreateDto({
      agreementType: 'per_student',
      coveredFeeTypes: ['tuition'],
      terms: {
        agreementType: 'per_student',
        lines: [
          { studentId: STUDENT_A, feeType: 'tuition', amount: 20000 },
          { studentId: STUDENT_B, feeType: 'tuition', amount: 15000 },
        ],
      } as any,
    });
    expect(() => assertAgreementInvariants(complete as any)).not.toThrow();
  });

  it('review F1 — update() re-asserts completeness against the MERGED entity (PATCH without coveredFeeTypes)', async () => {
    // Stored agreement covers tuition for A+B; the PATCH swaps in
    // per_student terms pricing only A. Zod skips the completeness check
    // (no coveredFeeTypes in the payload) — the service must catch it.
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ coveredFeeTypes: ['tuition'] })),
    });
    const { svc } = makeService({ ddb });

    await expect(
      svc.update(
        SCHOOL,
        'ag-1',
        {
          version: 1,
          agreementType: 'per_student',
          terms: {
            agreementType: 'per_student',
            lines: [{ studentId: STUDENT_A, feeType: 'tuition', amount: 20000 }],
          },
        } as any,
        ctx,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });
});

// ============================================================================
// FB-2.3 — create
// ============================================================================

describe('AgreementsService.create', () => {
  it('404s when the school does not exist', async () => {
    const { svc } = makeService({
      identity: makeMockIdentity({ validateSchoolExists: jest.fn().mockResolvedValue(false) }),
    });
    await expect(svc.create(SCHOOL, makeCreateDto(), ctx)).rejects.toThrow(NotFoundException);
  });

  it('400s on tenant currency mismatch (mirrors fee-structures)', async () => {
    const { svc, ddb } = makeService({
      identity: makeMockIdentity({
        getWorkspaceSettings: jest.fn().mockResolvedValue({ regional: { defaultCurrency: 'USD' } }),
      }),
    });
    await expect(svc.create(SCHOOL, makeCreateDto(), ctx)).rejects.toThrow(BadRequestException);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('400s with AGREEMENT_STUDENT_NOT_ENROLLED listing the missing students', async () => {
    const identity = makeMockIdentity({
      getStudentInfo: jest
        .fn()
        .mockImplementation(async (studentId: string) =>
          studentId === STUDENT_B ? null : { studentId, firstName: 'X', lastName: 'Y', gradeLevel: '5' },
        ),
    });
    const { svc } = makeService({ identity });
    try {
      await svc.create(SCHOOL, makeCreateDto(), ctx);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_STUDENT_NOT_ENROLLED);
      expect(e.getResponse().studentIds).toEqual([STUDENT_B]);
    }
  });

  it('400s with AGREEMENT_STUDENT_NOT_IN_FAMILY when familyId membership fails', async () => {
    const identity = makeMockIdentity({
      getStudentFamily: jest
        .fn()
        .mockImplementation(async (studentId: string) =>
          studentId === STUDENT_A ? { family: { id: FAMILY } } : { family: null },
        ),
    });
    const { svc } = makeService({ identity });
    try {
      await svc.create(SCHOOL, makeCreateDto({ familyId: FAMILY }), ctx);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_STUDENT_NOT_IN_FAMILY);
      expect(e.getResponse().studentIds).toEqual([STUDENT_B]);
    }
  });

  it('fails CLOSED when the academics family lookup is unavailable (null)', async () => {
    const identity = makeMockIdentity({
      getStudentFamily: jest.fn().mockResolvedValue(null),
    });
    const { svc } = makeService({ identity });
    await expect(svc.create(SCHOOL, makeCreateDto({ familyId: FAMILY }), ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('skips family validation entirely when no familyId is supplied', async () => {
    const identity = makeMockIdentity();
    const { svc } = makeService({ identity });
    await svc.create(SCHOOL, makeCreateDto(), ctx);
    expect(identity.getStudentFamily).not.toHaveBeenCalled();
  });

  describe('FB-2.5 advisory overlap matrix', () => {
    function pointerFor(overrides: Record<string, unknown> = {}) {
      return {
        agreementId: 'existing-ag',
        schoolId: SCHOOL,
        studentId: STUDENT_A,
        status: 'draft',
        effectiveFrom: '2099-03-01',
        effectiveTo: '2099-06-30',
        ...overrides,
      };
    }

    async function createWith(pointers: unknown[], window?: { from: string; to: string }) {
      const ddb = makeMockDdb({
        queryGSI: jest.fn().mockResolvedValue({ items: pointers, hasMore: false }),
      });
      const { svc } = makeService({ ddb });
      const dto = makeCreateDto(
        window ? { effectiveFrom: window.from, effectiveTo: window.to } : {},
      );
      return { promise: svc.create(SCHOOL, dto, ctx), ddb };
    }

    it('409s AGREEMENT_OVERLAP with the conflicting agreementId (containing window)', async () => {
      const { promise } = await createWith([pointerFor()]);
      try {
        await promise;
        fail('expected ConflictException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_OVERLAP);
        expect(e.getResponse().conflictingAgreementId).toBe('existing-ag');
        expect(e.getResponse().studentId).toBe(STUDENT_A);
      }
    });

    it('409s on an ACTIVE overlapping pointer too (non-terminal statuses)', async () => {
      const { promise } = await createWith([pointerFor({ status: 'active' })]);
      await expect(promise).rejects.toThrow(ConflictException);
    });

    it('ignores terminal-status pointers (cancelled/expired/superseded)', async () => {
      const { promise } = await createWith([
        pointerFor({ status: 'cancelled' }),
        pointerFor({ status: 'expired', agreementId: 'e2' }),
        pointerFor({ status: 'superseded', agreementId: 'e3' }),
      ]);
      await expect(promise).resolves.toBeDefined();
    });

    it('ignores other-school pointers', async () => {
      const { promise } = await createWith([pointerFor({ schoolId: 'other-school' })]);
      await expect(promise).resolves.toBeDefined();
    });

    it('allows disjoint windows', async () => {
      const { promise } = await createWith(
        [pointerFor({ effectiveFrom: '2099-01-01', effectiveTo: '2099-01-31' })],
        { from: '2099-02-01', to: '2099-03-01' },
      );
      await expect(promise).resolves.toBeDefined();
    });

    it('review F8 — touching windows (shared boundary day) NOW conflict (closed [from..to] intervals, matching the resolver)', async () => {
      // Existing ends exactly where the new one starts — both windows
      // are billable ON 2099-02-01 (the resolver's date bound is closed),
      // so the overlap check is closed/inclusive too.
      const { promise } = await createWith(
        [pointerFor({ effectiveFrom: '2099-01-01', effectiveTo: '2099-02-01' })],
        { from: '2099-02-01', to: '2099-03-01' },
      );
      await expect(promise).rejects.toThrow(ConflictException);
    });
  });

  it('writes agreement + one pointer per student in ONE transactWrite (draft)', async () => {
    const { svc, ddb, events } = makeService();
    const result = await svc.create(SCHOOL, makeCreateDto(), ctx);

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(3);

    const agreementItem = items[0].Put.Item;
    expect(agreementItem.entityType).toBe('AGREEMENT');
    expect(agreementItem.status).toBe('draft');
    expect(agreementItem.version).toBe(1);
    expect(agreementItem.gsi1pk).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
    expect(agreementItem.gsi1sk).toBe(`AGREEMENT#draft#${FUTURE_FROM}`);

    const pointerItems = items.slice(1).map((i: any) => i.Put.Item);
    expect(pointerItems.map((p: any) => p.studentId).sort()).toEqual(
      [STUDENT_A, STUDENT_B].sort(),
    );
    for (const pointer of pointerItems) {
      expect(pointer.entityType).toBe('AGREEMENT_MEMBER');
      expect(pointer.status).toBe('draft');
      expect(pointer.entityKey).toBe(
        EntityKeyBuilder.agreementMember(SCHOOL, pointer.studentId, agreementItem.agreementId),
      );
      expect(pointer.gsi2pk).toBe(`TENANT#${TENANT}#STUDENT#${pointer.studentId}`);
      expect(pointer.gsi2sk).toBe(`AGREEMENT#draft#${FUTURE_TO}`);
    }

    expect(events.publishAgreementCreated).toHaveBeenCalledWith(
      TENANT,
      SCHOOL,
      agreementItem.agreementId,
      'Adhikari family deal',
    );

    expect(result.status).toBe('draft');
    expect(result.id).toBe(agreementItem.agreementId);
    // P1d — isActive never in response DTOs.
    expect('isActive' in (result as any)).toBe(false);
  });
});

// ============================================================================
// FB-2.3 — get / list · lazy expiry presentation (FB-3.5(5))
// ============================================================================

describe('AgreementsService.get', () => {
  it('404s when missing', async () => {
    const { svc } = makeService();
    await expect(svc.get(SCHOOL, 'nope', ctx)).rejects.toThrow(NotFoundException);
  });

  it('404s when soft-deleted (isActive=false rows are filtered server-side)', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ isActive: false })),
    });
    const { svc } = makeService({ ddb });
    await expect(svc.get(SCHOOL, 'ag-1', ctx)).rejects.toThrow(NotFoundException);
  });

  it('presents an active agreement past effectiveTo as expired WITHOUT writing (lazy expiry, epic §3.2)', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(
        makeAgreementEntity({
          status: 'active',
          effectiveFrom: '2020-01-01',
          effectiveTo: '2020-12-31',
        }),
      ),
    });
    const { svc } = makeService({ ddb });
    const dto = await svc.get(SCHOOL, 'ag-1', ctx);
    expect(dto.status).toBe('expired');
    expect(ddb.transactWrite).not.toHaveBeenCalled();
    expect(ddb.putItem).not.toHaveBeenCalled();
  });

  it('leaves an in-term active agreement presented as active', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ status: 'active' })),
    });
    const { svc } = makeService({ ddb });
    const dto = await svc.get(SCHOOL, 'ag-1', ctx);
    expect(dto.status).toBe('active');
  });
});

describe('AgreementsService.list', () => {
  it('queries GSI1 with the school scope + AGREEMENT# prefix and isActive filter', async () => {
    const { svc, ddb } = makeService();
    await svc.list(SCHOOL, ctx, {});
    const call = ddb.queryGSI.mock.calls[0];
    expect(call[1]).toBe('GSI1');
    expect(call[2]).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
    expect(call[3]).toBe('AGREEMENT#');
    expect(call[4]).toBe('begins_with');
    expect(call[5]).toContain('isActive');
  });

  it('narrows the sort-key prefix when a status filter is given', async () => {
    const { svc, ddb } = makeService();
    await svc.list(SCHOOL, ctx, { status: 'active' });
    expect(ddb.queryGSI.mock.calls[0][3]).toBe('AGREEMENT#active#');
  });

  it('adds a familyId filter expression when given', async () => {
    const { svc, ddb } = makeService();
    await svc.list(SCHOOL, ctx, { familyId: FAMILY });
    const call = ddb.queryGSI.mock.calls[0];
    expect(call[5]).toContain('familyId = :familyId');
    expect(call[6][':familyId']).toBe(FAMILY);
  });

  describe('review NOTE-A — lazy-expiry-aware status filters', () => {
    const lapsed = () =>
      makeAgreementEntity({
        agreementId: 'ag-lapsed',
        status: 'active',
        effectiveFrom: '2020-01-01',
        effectiveTo: '2020-12-31',
        gsi1sk: 'AGREEMENT#active#2020-01-01',
      });
    const inTerm = () =>
      makeAgreementEntity({
        agreementId: 'ag-live',
        status: 'active',
        gsi1sk: `AGREEMENT#active#${FUTURE_FROM}`,
      });

    it('review NOTE-A — status=expired queries the ACTIVE prefix and returns only lapsed agreements', async () => {
      const ddb = makeMockDdb({
        queryGSI: jest.fn().mockResolvedValue({ items: [lapsed(), inTerm()], hasMore: false }),
      });
      const { svc } = makeService({ ddb });

      const result = await svc.list(SCHOOL, ctx, { status: 'expired' });

      // 'expired' is display-only — rows are STORED as 'active', so the
      // key prefix must target the active partition slice.
      expect(ddb.queryGSI.mock.calls[0][3]).toBe('AGREEMENT#active#');
      expect(result.items.map((i) => i.id)).toEqual(['ag-lapsed']);
      expect(result.items[0].status).toBe('expired');
    });

    it('review NOTE-A — status=active post-filters lapsed agreements out of the page', async () => {
      const ddb = makeMockDdb({
        queryGSI: jest.fn().mockResolvedValue({ items: [lapsed(), inTerm()], hasMore: false }),
      });
      const { svc } = makeService({ ddb });

      const result = await svc.list(SCHOOL, ctx, { status: 'active' });

      expect(ddb.queryGSI.mock.calls[0][3]).toBe('AGREEMENT#active#');
      expect(result.items.map((i) => i.id)).toEqual(['ag-live']);
      expect(result.items[0].status).toBe('active');
    });

    it('review NOTE-A — unfiltered list is unchanged (both rows, mapper presents lapsed as expired)', async () => {
      const ddb = makeMockDdb({
        queryGSI: jest.fn().mockResolvedValue({ items: [lapsed(), inTerm()], hasMore: false }),
      });
      const { svc } = makeService({ ddb });

      const result = await svc.list(SCHOOL, ctx, {});

      expect(ddb.queryGSI.mock.calls[0][3]).toBe('AGREEMENT#');
      expect(result.items.map((i) => i.status).sort()).toEqual(['active', 'expired']);
    });
  });
});

describe('AgreementsService.listForStudent', () => {
  it('hydrates pointers via batchGet, filters other-school pointers, applies presented-status filter', async () => {
    const pointers = [
      { agreementId: 'ag-1', schoolId: SCHOOL, studentId: STUDENT_A },
      { agreementId: 'ag-2', schoolId: 'other-school', studentId: STUDENT_A },
    ];
    const ddb = makeMockDdb({
      queryGSI: jest.fn().mockResolvedValue({ items: pointers, hasMore: false }),
      batchGetItems: jest.fn().mockResolvedValue([makeAgreementEntity({ agreementId: 'ag-1' })]),
    });
    const { svc } = makeService({ ddb });

    const result = await svc.listForStudent(STUDENT_A, SCHOOL, ctx, {});
    expect(ddb.batchGetItems.mock.calls[0][1]).toEqual([
      { tenantId: TENANT, entityKey: EntityKeyBuilder.agreement(SCHOOL, 'ag-1') },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ag-1');

    const filtered = await svc.listForStudent(STUDENT_A, SCHOOL, ctx, { status: 'active' });
    expect(filtered.items).toHaveLength(0); // stored draft ≠ requested active
  });
});

// ============================================================================
// FB-2.4 — draft update (+ optimistic concurrency + pointer reconcile)
// ============================================================================

describe('AgreementsService.update', () => {
  it('404s when missing', async () => {
    const { svc } = makeService();
    await expect(svc.update(SCHOOL, 'nope', { version: 1 } as any, ctx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s CONCURRENT_UPDATE on a stale body version', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ version: 3 })) });
    const { svc } = makeService({ ddb });
    try {
      await svc.update(SCHOOL, 'ag-1', { version: 2, title: 'X' } as any, ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e.getResponse().code).toBe(FinanceErrors.CONCURRENT_UPDATE);
    }
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('rejects edits on terminal statuses (transition matrix — terminal immutable)', async () => {
    for (const status of ['cancelled', 'expired', 'superseded'] as const) {
      const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ status })) });
      const { svc } = makeService({ ddb });
      try {
        await svc.update(SCHOOL, 'ag-1', { version: 1, title: 'X' } as any, ctx);
        fail('expected ConflictException');
      } catch (e: any) {
        expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_INVALID_TRANSITION);
      }
    }
  });

  it('draft in-place edit (incl. financial fields) puts the merged row with version+1 and a version+status condition', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(makeAgreementEntity()) });
    const { svc } = makeService({ ddb });

    const result = await svc.update(
      SCHOOL,
      'ag-1',
      {
        version: 1,
        title: 'Renamed deal',
        terms: {
          agreementType: 'fixed_total',
          totalAmount: 50000,
          allocation: [
            { studentId: STUDENT_A, amount: 30000 },
            { studentId: STUDENT_B, amount: 20000 },
          ],
        },
        agreementType: 'fixed_total',
      } as any,
      ctx,
    );

    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(1); // students + dates unchanged → no pointer churn
    const put = items[0].Put;
    expect(put.Item.title).toBe('Renamed deal');
    expect(put.Item.version).toBe(2);
    expect(put.Item.status).toBe('draft');
    expect(put.ConditionExpression).toContain('version = :expectedVersion');
    expect(put.ExpressionAttributeValues[':expectedVersion']).toBe(1);
    expect(put.ExpressionAttributeValues[':expectedStatus']).toBe('draft');
    expect(result.version).toBe(2);
    expect((result.terms as any).totalAmount).toBe(50000);
  });

  it('reconciles pointer rows in the SAME transactWrite when studentIds change (delete removed, put current)', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(makeAgreementEntity()) });
    const { svc } = makeService({ ddb });

    await svc.update(
      SCHOOL,
      'ag-1',
      {
        version: 1,
        studentIds: [STUDENT_B, STUDENT_C],
        agreementType: 'fixed_total',
        terms: {
          agreementType: 'fixed_total',
          totalAmount: 40000,
          allocation: [
            { studentId: STUDENT_B, amount: 25000 },
            { studentId: STUDENT_C, amount: 15000 },
          ],
        },
      } as any,
      ctx,
    );

    const items = ddb.transactWrite.mock.calls[0][1];
    // 1 agreement put + 1 delete (STUDENT_A removed) + 2 pointer puts
    expect(items).toHaveLength(4);
    const deletes = items.filter((i: any) => i.Delete);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].Delete.Key.entityKey).toBe(
      EntityKeyBuilder.agreementMember(SCHOOL, STUDENT_A, 'ag-1'),
    );
    const pointerPuts = items.filter((i: any) => i.Put?.Item?.entityType === 'AGREEMENT_MEMBER');
    expect(pointerPuts.map((i: any) => i.Put.Item.studentId).sort()).toEqual(
      [STUDENT_B, STUDENT_C].sort(),
    );
  });

  it('rewrites pointers when effective dates change (gsi2sk embeds effectiveTo)', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(makeAgreementEntity()) });
    const { svc } = makeService({ ddb });

    await svc.update(
      SCHOOL,
      'ag-1',
      { version: 1, effectiveTo: '2099-11-30' } as any,
      ctx,
    );

    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(3); // agreement + 2 pointer rewrites
    const pointerPuts = items.filter((i: any) => i.Put?.Item?.entityType === 'AGREEMENT_MEMBER');
    for (const p of pointerPuts) {
      expect(p.Put.Item.gsi2sk).toBe('AGREEMENT#draft#2099-11-30');
    }
  });

  it('active + non-financial-only PATCH updates in place (no versioning)', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ status: 'active', version: 2 })),
    });
    const { svc } = makeService({ ddb });

    const result = await svc.update(SCHOOL, 'ag-1', { version: 2, title: 'New title' } as any, ctx);
    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(1);
    expect(items[0].Put.Item.agreementId).toBe('ag-1'); // same row — no new version row
    expect(items[0].Put.Item.status).toBe('active');
    expect(result.version).toBe(3);
  });

  it('maps a transact ConditionalCheckFailed on the agreement item to 409 CONCURRENT_UPDATE', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity()),
      transactWrite: jest
        .fn()
        .mockRejectedValue(transactCancelled([{ Code: 'ConditionalCheckFailed' }])),
    });
    const { svc } = makeService({ ddb });
    try {
      await svc.update(SCHOOL, 'ag-1', { version: 1, title: 'X' } as any, ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e.getResponse().code).toBe(FinanceErrors.CONCURRENT_UPDATE);
    }
  });
});

// ============================================================================
// FB-2.4 / FB-3.5(4) — cancel
// ============================================================================

describe('AgreementsService.cancel', () => {
  it('draft → cancelled: re-keys pointers, appends statusHistory, NO lock deletes', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(makeAgreementEntity()) });
    const { svc, events } = makeService({ ddb });

    const result = await svc.cancel(SCHOOL, 'ag-1', { version: 1, reason: 'operator mistake' } as any, ctx);

    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(3); // agreement + 2 pointers, no locks for draft
    expect(items[0].Put.Item.status).toBe('cancelled');
    expect(items[0].Put.Item.gsi1sk).toBe(`AGREEMENT#cancelled#${FUTURE_FROM}`);
    const history = items[0].Put.Item.statusHistory;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: 'draft', to: 'cancelled', reason: 'operator mistake' });

    const pointerPuts = items.slice(1);
    for (const p of pointerPuts) {
      expect(p.Put.Item.status).toBe('cancelled');
      expect(p.Put.Item.gsi2sk).toBe(`AGREEMENT#cancelled#${FUTURE_TO}`);
    }
    expect(items.some((i: any) => i.Delete)).toBe(false);

    expect(events.publishAgreementCancelled).toHaveBeenCalledWith(TENANT, SCHOOL, 'ag-1', 'draft');
    expect(result.status).toBe('cancelled');
  });

  it('active → cancelled: also deletes the per-student locks in the same transact (guarded to our agreementId)', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ status: 'active', version: 2 })),
    });
    const { svc } = makeService({ ddb });

    await svc.cancel(SCHOOL, 'ag-1', { version: 2 } as any, ctx);

    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(5); // agreement + 2 pointers + 2 lock deletes
    const lockDeletes = items.filter((i: any) => i.Delete);
    expect(lockDeletes).toHaveLength(2);
    for (const d of lockDeletes) {
      expect(d.Delete.Key.entityKey).toMatch(new RegExp(`^AGREEMENT_ACTIVE_LOCK#${SCHOOL}#`));
      expect(d.Delete.ConditionExpression).toContain('attribute_not_exists(entityKey)');
      expect(d.Delete.ExpressionAttributeValues[':agreementId']).toBe('ag-1');
    }
  });

  it('rejects cancelling a terminal agreement', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity({ status: 'cancelled' })),
    });
    const { svc } = makeService({ ddb });
    await expect(svc.cancel(SCHOOL, 'ag-1', { version: 1 } as any, ctx)).rejects.toThrow(
      ConflictException,
    );
  });
});

// ============================================================================
// FB-3.5 — activation
// ============================================================================

describe('AgreementsService.activate', () => {
  function activatableDdb(entityOverrides: Partial<BillingAgreementEntity> = {}, ddbOverrides: Record<string, unknown> = {}) {
    return makeMockDdb({
      getItem: jest.fn().mockResolvedValue(makeAgreementEntity(entityOverrides)),
      ...ddbOverrides,
    });
  }

  it('only draft can activate (matrix)', async () => {
    for (const status of ['active', 'cancelled', 'expired', 'superseded'] as const) {
      const { svc } = makeService({ ddb: activatableDdb({ status }) });
      await expect(svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx)).rejects.toThrow(
        ConflictException,
      );
    }
  });

  it('400s AGREEMENT_TERM_EXPIRED when effectiveTo is already past', async () => {
    const { svc } = makeService({
      ddb: activatableDdb({ effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' }),
    });
    try {
      await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_TERM_EXPIRED);
    }
  });

  it('re-validates enrollment of every member at activation', async () => {
    const identity = makeMockIdentity({ getStudentInfo: jest.fn().mockResolvedValue(null) });
    const { svc } = makeService({ ddb: activatableDdb(), identity });
    try {
      await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e.getResponse().code).toBe(FinanceErrors.AGREEMENT_STUDENT_NOT_ENROLLED);
    }
  });

  describe('open-invoice conflict check (FB-3.5(2))', () => {
    const openInvoice = {
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-420-2605-0001',
      schoolId: SCHOOL,
      status: 'issued',
      grandTotal: 12000,
      issuedDate: '2099-02-01',
      dueDate: '2099-03-01',
      lineItems: [
        { feeStructureId: 'fs-1', feeType: 'tuition', description: 'Tuition', amount: 12000 },
      ],
    };

    function invoiceAwareDdb(invoices: unknown[]) {
      return activatableDdb(
        {},
        {
          queryGSI: jest.fn().mockImplementation(async (...args: any[]) => {
            const skValue = args[3];
            if (skValue === 'INVOICE') return { items: invoices, hasMore: false };
            return { items: [], hasMore: false };
          }),
        },
      );
    }

    it('409s CONFLICTING_OPEN_INVOICES with the listing when not acknowledged', async () => {
      const ddb = invoiceAwareDdb([openInvoice]);
      const { svc } = makeService({ ddb });
      try {
        await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
        fail('expected ConflictException');
      } catch (e: any) {
        expect(e.getResponse().code).toBe(FinanceErrors.CONFLICTING_OPEN_INVOICES);
        expect(e.getResponse().conflicts).toEqual([
          {
            invoiceId: 'inv-1',
            invoiceNumber: 'INV-420-2605-0001',
            grandTotal: 12000,
            matchedFeeTypes: ['tuition'],
          },
        ]);
      }
      expect(ddb.transactWrite).not.toHaveBeenCalled();
    });

    it('proceeds with acknowledgeOpenInvoices: true and records the list in the audit payload', async () => {
      const ddb = invoiceAwareDdb([openInvoice]);
      const { svc } = makeService({ ddb });
      const auditSpy = jest
        .spyOn((svc as any).auditLogger, 'log')
        .mockImplementation(() => undefined as any);

      await svc.activate(SCHOOL, 'ag-1', { version: 1, acknowledgeOpenInvoices: true } as any, ctx);

      expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
      const details = auditSpy.mock.calls[0][3] as any;
      expect(details.acknowledgedOpenInvoices).toHaveLength(1);
      expect(details.acknowledgedOpenInvoices[0].invoiceId).toBe('inv-1');
    });

    it('resolves un-stamped line fee types via FeeStructuresService.getByIds', async () => {
      const invoice = {
        ...openInvoice,
        lineItems: [{ feeStructureId: 'fs-9', description: 'Old-style line', amount: 5000 }],
      };
      const feeStructures = makeMockFeeStructures({
        getByIds: jest.fn().mockResolvedValue([{ feeStructureId: 'fs-9', feeType: 'admission' }]),
      });
      const { svc } = makeService({ ddb: invoiceAwareDdb([invoice]), feeStructures });
      try {
        await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
        fail('expected ConflictException');
      } catch (e: any) {
        expect(e.getResponse().conflicts[0].matchedFeeTypes).toEqual(['admission']);
      }
      expect(feeStructures.getByIds).toHaveBeenCalledWith(SCHOOL, ['fs-9'], expect.anything());
    });

    it('ignores custom lines, non-covered fee types, and out-of-term invoices', async () => {
      const invoices = [
        { ...openInvoice, invoiceId: 'i-custom', lineItems: [{ feeStructureId: 'x', isCustom: true, feeType: 'custom' }] },
        { ...openInvoice, invoiceId: 'i-transport', lineItems: [{ feeStructureId: 'y', feeType: 'transport' }] },
        { ...openInvoice, invoiceId: 'i-early', issuedDate: '2001-01-01', dueDate: '2001-02-01' },
      ];
      const { svc } = makeService({ ddb: invoiceAwareDdb(invoices) });
      await expect(
        svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx),
      ).resolves.toBeDefined();
    });

    it('review F2 — conflict check paginates: an open invoice on page 2 still 409s', async () => {
      const page2Cursor = Buffer.from(JSON.stringify({ entityKey: 'INVOICE#end-p1' })).toString('base64');
      const queryGSI = jest
        .fn()
        .mockResolvedValueOnce({ items: [], hasMore: true, lastEvaluatedKey: page2Cursor })
        .mockResolvedValueOnce({ items: [openInvoice], hasMore: false })
        .mockResolvedValue({ items: [], hasMore: false });
      const ddb = activatableDdb({}, { queryGSI });
      const { svc } = makeService({ ddb });

      try {
        await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
        fail('expected ConflictException');
      } catch (e: any) {
        expect(e.getResponse().code).toBe(FinanceErrors.CONFLICTING_OPEN_INVOICES);
        expect(e.getResponse().conflicts[0].invoiceId).toBe('inv-1');
      }
      // Page 2 was requested with the decoded ExclusiveStartKey.
      expect(queryGSI.mock.calls[1][10]).toEqual({ entityKey: 'INVOICE#end-p1' });
    });

    it('review F2 — 25-page cap throws INVOICE_SCAN_LIMIT_EXCEEDED for manual review (never silently passes)', async () => {
      const cursor = Buffer.from(JSON.stringify({ entityKey: 'k' })).toString('base64');
      const queryGSI = jest
        .fn()
        .mockResolvedValue({ items: [], hasMore: true, lastEvaluatedKey: cursor });
      const ddb = activatableDdb({}, { queryGSI });
      const { svc } = makeService({ ddb });

      try {
        await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
        fail('expected ConflictException');
      } catch (e: any) {
        expect(e.getResponse().code).toBe(FinanceErrors.INVOICE_SCAN_LIMIT_EXCEEDED);
      }
      expect(queryGSI).toHaveBeenCalledTimes(25);
      expect(ddb.transactWrite).not.toHaveBeenCalled();
    });
  });

  it('one transactWrite: agreement (condition draft+version) + pointer re-keys + conditional lock puts with correct TTL', async () => {
    const ddb = activatableDdb();
    const { svc, events } = makeService({ ddb });

    const result = await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(5); // agreement + 2 pointers + 2 locks

    const agreementPut = items[0].Put;
    expect(agreementPut.Item.status).toBe('active');
    expect(agreementPut.Item.version).toBe(2);
    expect(agreementPut.Item.approvedBy).toBe('user-1');
    expect(agreementPut.Item.gsi1sk).toBe(`AGREEMENT#active#${FUTURE_FROM}`);
    expect(agreementPut.ConditionExpression).toContain(':draft');
    expect(agreementPut.Item.statusHistory[0]).toMatchObject({ from: 'draft', to: 'active' });

    const pointerPuts = items.slice(1, 3);
    for (const p of pointerPuts) {
      expect(p.Put.Item.status).toBe('active');
      expect(p.Put.Item.gsi2sk).toBe(`AGREEMENT#active#${FUTURE_TO}`);
    }

    const lockPuts = items.slice(3);
    for (const l of lockPuts) {
      expect(l.Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');
      expect(l.Put.Item.entityType).toBe('AGREEMENT_ACTIVE_LOCK');
      expect(l.Put.Item.agreementId).toBe('ag-1');
      expect(l.Put.Item.ttl).toBe(agreementLockTtl(FUTURE_TO));
      expect(l.Put.Item.entityKey).toBe(
        EntityKeyBuilder.agreementActiveLock(SCHOOL, l.Put.Item.studentId),
      );
    }

    expect(events.publishAgreementActivated).toHaveBeenCalledWith(TENANT, SCHOOL, 'ag-1', [
      STUDENT_A,
      STUDENT_B,
    ]);
    expect(result.status).toBe('active');
  });

  it('maps lock contention (CancellationReasons order) to 409 AGREEMENT_OVERLAP with the studentId + holder lookup', async () => {
    // Items order: [agreement, pointerA, pointerB, lockA, lockB] — lockB fails.
    const holder = { agreementId: 'other-agreement', studentId: STUDENT_B };
    const getItem = jest
      .fn()
      .mockResolvedValueOnce(makeAgreementEntity()) // load
      .mockResolvedValueOnce(null) // F7 lock pre-read (STUDENT_A) — no lock
      .mockResolvedValueOnce(null) // F7 lock pre-read (STUDENT_B) — no lock
      .mockResolvedValueOnce(holder); // best-effort holder lookup
    const ddb = makeMockDdb({
      getItem,
      transactWrite: jest.fn().mockRejectedValue(
        transactCancelled([
          { Code: 'None' },
          { Code: 'None' },
          { Code: 'None' },
          { Code: 'None' },
          { Code: 'ConditionalCheckFailed' },
        ]),
      ),
    });
    const { svc } = makeService({ ddb });

    try {
      await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.code).toBe(FinanceErrors.AGREEMENT_OVERLAP);
      expect(body.studentIds).toEqual([STUDENT_B]);
      expect(body.conflictingAgreementId).toBe('other-agreement');
    }
  });

  it('maps an agreement-item condition failure (not a lock) to 409 CONCURRENT_UPDATE', async () => {
    const ddb = activatableDdb(
      {},
      {
        transactWrite: jest.fn().mockRejectedValue(
          transactCancelled([
            { Code: 'ConditionalCheckFailed' },
            { Code: 'None' },
            { Code: 'None' },
            { Code: 'None' },
            { Code: 'None' },
          ]),
        ),
      },
    );
    const { svc } = makeService({ ddb });
    try {
      await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e.getResponse().code).toBe(FinanceErrors.CONCURRENT_UPDATE);
    }
  });

  describe('review F7 — stale-lock reclaim (consecutive-term scenario)', () => {
    const lockKeyA = EntityKeyBuilder.agreementActiveLock(SCHOOL, STUDENT_A);

    it('review F7 — naturally-expired lock is conditionally deleted, activation succeeds, lock puts point at the NEW agreement', async () => {
      const expiredLock = {
        entityType: 'AGREEMENT_ACTIVE_LOCK',
        agreementId: 'prev-term-ag',
        schoolId: SCHOOL,
        studentId: STUDENT_A,
        effectiveTo: '2020-12-31',
      };
      const getItem = jest.fn().mockImplementation(async (_c: any, _t: string, key: string) => {
        if (key === EntityKeyBuilder.agreement(SCHOOL, 'ag-1')) return makeAgreementEntity();
        if (key === lockKeyA) return expiredLock;
        return null;
      });
      const ddb = makeMockDdb({ getItem });
      const { svc } = makeService({ ddb });

      const result = await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);

      // Conditional delete guards against racing a live lock.
      expect(ddb.deleteItem).toHaveBeenCalledTimes(1);
      expect(ddb.deleteItem).toHaveBeenCalledWith(
        expect.anything(),
        TENANT,
        lockKeyA,
        'effectiveTo < :today',
        { ':today': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      );

      // The activation transact is unchanged: conditional lock puts now
      // land (key free) and point at the activating agreement.
      const items = ddb.transactWrite.mock.calls[0][1];
      const lockPuts = items.filter(
        (i: any) => i.Put?.Item?.entityType === 'AGREEMENT_ACTIVE_LOCK',
      );
      expect(lockPuts).toHaveLength(2);
      for (const l of lockPuts) {
        expect(l.Put.Item.agreementId).toBe('ag-1');
        expect(l.Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');
      }
      expect(result.status).toBe('active');
    });

    it('review F7 — NON-expired lock is left alone and activation still 409s AGREEMENT_OVERLAP', async () => {
      const liveLock = {
        entityType: 'AGREEMENT_ACTIVE_LOCK',
        agreementId: 'other-agreement',
        schoolId: SCHOOL,
        studentId: STUDENT_A,
        effectiveTo: FUTURE_TO,
      };
      const getItem = jest.fn().mockImplementation(async (_c: any, _t: string, key: string) => {
        if (key === EntityKeyBuilder.agreement(SCHOOL, 'ag-1')) return makeAgreementEntity();
        if (key === lockKeyA) return liveLock;
        return null;
      });
      const ddb = makeMockDdb({
        getItem,
        // Items order: [agreement, pointerA, pointerB, lockA, lockB] — lockA fails.
        transactWrite: jest.fn().mockRejectedValue(
          transactCancelled([
            { Code: 'None' },
            { Code: 'None' },
            { Code: 'None' },
            { Code: 'ConditionalCheckFailed' },
            { Code: 'None' },
          ]),
        ),
      });
      const { svc } = makeService({ ddb });

      try {
        await svc.activate(SCHOOL, 'ag-1', { version: 1 } as any, ctx);
        fail('expected ConflictException');
      } catch (e: any) {
        const body = e.getResponse();
        expect(body.code).toBe(FinanceErrors.AGREEMENT_OVERLAP);
        expect(body.studentIds).toEqual([STUDENT_A]);
        expect(body.conflictingAgreementId).toBe('other-agreement');
      }
      expect(ddb.deleteItem).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// FB-3.6 — versioning of ACTIVE agreements
// ============================================================================

describe('AgreementsService — FB-3.6 versioning of active agreements', () => {
  const activeEntity = () =>
    makeAgreementEntity({ status: 'active', version: 2, gsi1sk: `AGREEMENT#active#${FUTURE_FROM}` });

  const financialPatch = {
    version: 2,
    agreementType: 'fixed_total',
    terms: {
      agreementType: 'fixed_total',
      totalAmount: 44000,
      allocation: [
        { studentId: STUDENT_A, amount: 27000 },
        { studentId: STUDENT_B, amount: 17000 },
      ],
    },
  } as any;

  it('400s AGREEMENT_VERSION_TOO_LARGE when the membership change would exceed the 100-item transactWrite ceiling (review P2-2)', async () => {
    const mk = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}00000-0000-4000-8000-000000000000`.slice(0, 36));
    const oldIds = mk(30, 'a');
    const newIds = mk(30, 'b');
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(
        makeAgreementEntity({
          status: 'active',
          version: 2,
          studentIds: oldIds,
          gsi1sk: `AGREEMENT#active#${FUTURE_FROM}`,
        }),
      ),
    });
    const { svc } = makeService({ ddb });
    const patch = {
      version: 2,
      studentIds: newIds,
      agreementType: 'fixed_total',
      terms: {
        agreementType: 'fixed_total',
        totalAmount: 30000,
        allocation: newIds.map((id) => ({ studentId: id, amount: 1000 })),
      },
    } as any;

    await expect(svc.update(SCHOOL, 'ag-1', patch, ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AGREEMENT_VERSION_TOO_LARGE' }),
    });
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('creates a NEW row (version+1, versionParentId = original id), supersedes old, re-targets pointers + locks atomically', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(activeEntity()) });
    const { svc, events } = makeService({ ddb });

    const result = await svc.update(SCHOOL, 'ag-1', financialPatch, ctx);

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1];
    // new agreement + superseded old + per kept student (2): pointer delete,
    // pointer put, lock update → 2 + 2*3 = 8
    expect(items).toHaveLength(8);

    const newPut = items[0].Put;
    expect(newPut.Item.agreementId).not.toBe('ag-1');
    expect(newPut.Item.version).toBe(3);
    expect(newPut.Item.versionParentId).toBe('ag-1');
    expect(newPut.Item.status).toBe('active');
    expect((newPut.Item.terms as any).totalAmount).toBe(44000);

    const oldPut = items[1].Put;
    expect(oldPut.Item.agreementId).toBe('ag-1');
    expect(oldPut.Item.status).toBe('superseded');
    // In-flight invoice provenance: superseded row keeps its version.
    expect(oldPut.Item.version).toBe(2);
    expect(oldPut.Item.gsi1sk).toBe(`AGREEMENT#superseded#${FUTURE_FROM}`);
    expect(oldPut.ConditionExpression).toContain(':active');
    const lastHistory = oldPut.Item.statusHistory[oldPut.Item.statusHistory.length - 1];
    expect(lastHistory).toMatchObject({ from: 'active', to: 'superseded' });

    const pointerDeletes = items.filter(
      (i: any) => i.Delete && String(i.Delete.Key.entityKey).startsWith('AGREEMENT_MEMBER#'),
    );
    expect(pointerDeletes).toHaveLength(2);
    for (const d of pointerDeletes) {
      expect(d.Delete.Key.entityKey).toContain('#ag-1'); // old pointers deleted
    }

    const pointerPuts = items.filter((i: any) => i.Put?.Item?.entityType === 'AGREEMENT_MEMBER');
    expect(pointerPuts).toHaveLength(2);
    for (const p of pointerPuts) {
      expect(p.Put.Item.agreementId).toBe(newPut.Item.agreementId);
      expect(p.Put.Item.status).toBe('active');
    }

    const lockUpdates = items.filter((i: any) => i.Update);
    expect(lockUpdates).toHaveLength(2);
    for (const u of lockUpdates) {
      expect(u.Update.Key.entityKey).toMatch(new RegExp(`^AGREEMENT_ACTIVE_LOCK#${SCHOOL}#`));
      expect(u.Update.ConditionExpression).toBe('agreementId = :oldId');
      expect(u.Update.ExpressionAttributeValues[':oldId']).toBe('ag-1');
      expect(u.Update.ExpressionAttributeValues[':newId']).toBe(newPut.Item.agreementId);
      expect(u.Update.ExpressionAttributeValues[':ttl']).toBe(agreementLockTtl(FUTURE_TO));
    }

    expect(events.publishAgreementVersioned).toHaveBeenCalledWith(
      TENANT,
      SCHOOL,
      'ag-1',
      newPut.Item.agreementId,
      3,
      expect.arrayContaining(['terms']),
    );
    expect(result.version).toBe(3);
    expect(result.versionParentId).toBe('ag-1');
  });

  it('preserves the chain ROOT when versioning an already-versioned agreement', async () => {
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(
        makeAgreementEntity({
          status: 'active',
          version: 3,
          agreementId: 'ag-2',
          entityKey: EntityKeyBuilder.agreement(SCHOOL, 'ag-2'),
          versionParentId: 'ag-root',
        }),
      ),
    });
    const { svc } = makeService({ ddb });

    const result = await svc.update(SCHOOL, 'ag-2', { ...financialPatch, version: 3 }, ctx);
    expect(result.versionParentId).toBe('ag-root'); // fee-structures semantics exactly
    expect(result.version).toBe(4);
  });

  it('handles membership change during versioning: removed → pointer+lock deletes; added → conditional lock put', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(activeEntity()) });
    const { svc } = makeService({ ddb });

    await svc.update(
      SCHOOL,
      'ag-1',
      {
        version: 2,
        studentIds: [STUDENT_A, STUDENT_C], // B removed, C added
        agreementType: 'fixed_total',
        terms: {
          agreementType: 'fixed_total',
          totalAmount: 40000,
          allocation: [
            { studentId: STUDENT_A, amount: 25000 },
            { studentId: STUDENT_C, amount: 15000 },
          ],
        },
      } as any,
      ctx,
    );

    const items = ddb.transactWrite.mock.calls[0][1];
    // 2 agreements + removed B (pointer del + lock del) + kept A (del+put+update) + added C (put+lockput)
    expect(items).toHaveLength(9);

    const lockDeleteB = items.find(
      (i: any) => i.Delete?.Key?.entityKey === EntityKeyBuilder.agreementActiveLock(SCHOOL, STUDENT_B),
    );
    expect(lockDeleteB).toBeDefined();
    expect(lockDeleteB.Delete.ConditionExpression).toContain('attribute_not_exists(entityKey)');

    const lockPutC = items.find(
      (i: any) => i.Put?.Item?.entityType === 'AGREEMENT_ACTIVE_LOCK' && i.Put.Item.studentId === STUDENT_C,
    );
    expect(lockPutC).toBeDefined();
    expect(lockPutC.Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');

    const lockUpdateA = items.find(
      (i: any) => i.Update?.Key?.entityKey === EntityKeyBuilder.agreementActiveLock(SCHOOL, STUDENT_A),
    );
    expect(lockUpdateA).toBeDefined();
  });

  it('in-flight invoice references stay valid: the OLD row is written back (still exists) with status superseded, never deleted', async () => {
    const ddb = makeMockDdb({ getItem: jest.fn().mockResolvedValue(activeEntity()) });
    const { svc } = makeService({ ddb });

    await svc.update(SCHOOL, 'ag-1', financialPatch, ctx);

    const items = ddb.transactWrite.mock.calls[0][1];
    const agreementDeletes = items.filter(
      (i: any) => i.Delete && String(i.Delete.Key.entityKey).startsWith('AGREEMENT#'),
    );
    expect(agreementDeletes).toHaveLength(0); // old agreement row never deleted
    const oldPut = items[1].Put;
    expect(oldPut.Item.entityKey).toBe(EntityKeyBuilder.agreement(SCHOOL, 'ag-1'));
    expect(oldPut.Item.isActive).toBe(true); // superseded ≠ soft-deleted; row stays readable
  });
});

// ============================================================================
// FB-3.6 — version history
// ============================================================================

describe('AgreementsService.getVersionHistory', () => {
  it('queries the school SK prefix filtered by the chain root and sorts by version', async () => {
    const v1 = makeAgreementEntity({ agreementId: 'ag-root', status: 'superseded', version: 1 });
    const v2 = makeAgreementEntity({
      agreementId: 'ag-2',
      versionParentId: 'ag-root',
      status: 'active',
      version: 2,
    });
    const ddb = makeMockDdb({
      getItem: jest.fn().mockResolvedValue(v2),
      query: jest.fn().mockResolvedValue({ items: [v2, v1], hasMore: false }),
    });
    const { svc } = makeService({ ddb });

    const history = await svc.getVersionHistory(SCHOOL, 'ag-2', ctx);

    const call = ddb.query.mock.calls[0];
    expect(call[2]).toBe(`AGREEMENT#${SCHOOL}#`);
    expect(call[3]).toContain('versionParentId = :parentId OR agreementId = :parentId');
    expect(call[4][':parentId']).toBe('ag-root');

    expect(history.map((h) => h.version)).toEqual([1, 2]);
    expect(history[0].status).toBe('superseded');
  });
});

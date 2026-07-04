/**
 * FamilyBillingService + IdentityClientService.getFamilyMembers —
 * EPIC-FB Sprint FB-4.6.
 *
 * Pins:
 *   1. family → members → per-student open invoices → sorted view +
 *      totalDue + planner-backed suggestedAllocation.
 *   2. 404 FAMILY_NOT_FOUND when academics says the family doesn't exist
 *      (also the natural degradation when academics' family-groups
 *      feature flag is off — this endpoint carries NO flag of its own).
 *   3. 503 FAMILY_MEMBERS_UNAVAILABLE when the family exists but the
 *      academics member-enumeration API can't answer (distinct from 404
 *      so clients can tell "no such family" from "can't resolve").
 *   4. Cross-school exclusion: the invoice query runs school-scoped per
 *      member; another school's invoices never appear.
 *   5. getFamilyMembers client: 404 → not_found; family ok + members
 *      route failing → members_unavailable; both array and {items}
 *      member response shapes accepted.
 */

import { Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FamilyBillingService } from './family-billing.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const SCHOOL_ID = 'school-1-uuid';
const FAMILY_ID = 'family-uuid';
const STUDENT_1 = 'student-1-uuid';
const STUDENT_2 = 'student-2-uuid';

const ctx = { tenantId: 'tenant-uuid', userId: 'user-1', jwtToken: 'jwt', role: 'TenantAdmin', schoolId: SCHOOL_ID } as any;

function openInvoice(
  invoiceId: string,
  studentId: string,
  amountDue: number,
  dueDate: string,
  invoiceNumber: string,
  overrides: Partial<InvoiceEntity> = {},
): InvoiceEntity {
  return {
    invoiceId,
    invoiceNumber,
    studentId,
    studentName: `Snapshot ${studentId}`,
    schoolId: SCHOOL_ID,
    status: 'issued',
    dueDate,
    amountDue,
    currency: 'NPR',
    gradeLevel: '4',
    ...overrides,
  } as InvoiceEntity;
}

function buildService(fixtures: {
  members: 'not_found' | 'unavailable' | Array<{ studentId: string; studentName: string }>;
  invoicesByStudent?: Record<string, InvoiceEntity[]>;
  /** FB-5.3 — billing-account rows keyed by entityKey (`BILLING_ACCOUNT#{school}#{student}`). */
  accountsByKey?: Record<string, Record<string, unknown>>;
  /** FB-5.3 — resolver results keyed by studentId. */
  agreementsByStudent?: Record<string, { agreement: any; allocationForStudent: number | null }>;
}) {
  const identityClient: any = {
    getFamilyMembers: jest.fn().mockResolvedValue(
      fixtures.members === 'not_found'
        ? { kind: 'not_found' }
        : fixtures.members === 'unavailable'
          ? { kind: 'members_unavailable', family: { id: FAMILY_ID, name: 'Rai family' } }
          : { kind: 'ok', family: { id: FAMILY_ID, name: 'Rai family' }, members: fixtures.members },
    ),
  };
  const invoicesService: any = {
    listOpenInvoiceEntitiesForStudent: jest.fn().mockImplementation(
      async (_school: string, studentId: string) => fixtures.invoicesByStudent?.[studentId] ?? [],
    ),
  };
  // FB-5.3 ctor deps — defaults model "no billing account, no agreement";
  // summary fixtures override per test.
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockImplementation(
      async (_client: unknown, _tenantId: string, entityKey: string) =>
        fixtures.accountsByKey?.[entityKey] ?? null,
    ),
  };
  const agreementResolver: any = {
    getActiveAgreementForStudent: jest.fn().mockImplementation(
      async (studentId: string) => fixtures.agreementsByStudent?.[studentId] ?? null,
    ),
  };
  const service = new FamilyBillingService(
    identityClient,
    invoicesService,
    dynamoDBClient,
    agreementResolver,
  );
  return { service, identityClient, invoicesService, dynamoDBClient, agreementResolver };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FamilyBillingService.getFamilyOpenInvoices', () => {
  it('assembles members + open invoices (dueDate/invoiceNumber sorted) + totalDue + full oldest-first suggestion', async () => {
    const { service, invoicesService } = buildService({
      members: [
        { studentId: STUDENT_1, studentName: 'Sunita Rai' },
        { studentId: STUDENT_2, studentName: 'Bikash Rai' },
      ],
      invoicesByStudent: {
        [STUDENT_1]: [
          openInvoice('inv-b', STUDENT_1, 2000, '2026-08-01', 'INV-0002'),
          openInvoice('inv-a', STUDENT_1, 1000, '2026-07-01', 'INV-0001', { status: 'overdue' }),
        ],
        [STUDENT_2]: [openInvoice('inv-c', STUDENT_2, 1500, '2026-07-01', 'INV-0000', { status: 'partially_paid' })],
      },
    });

    const result = await service.getFamilyOpenInvoices(SCHOOL_ID, FAMILY_ID, ctx);

    expect(result.familyId).toBe(FAMILY_ID);
    expect(result.familyName).toBe('Rai family');
    expect(result.students).toEqual([
      { studentId: STUDENT_1, studentName: 'Sunita Rai' },
      { studentId: STUDENT_2, studentName: 'Bikash Rai' },
    ]);

    // School-scoped query per member — cross-school invoices excluded at
    // the query, not post-hoc.
    expect(invoicesService.listOpenInvoiceEntitiesForStudent).toHaveBeenCalledTimes(2);
    expect(invoicesService.listOpenInvoiceEntitiesForStudent).toHaveBeenCalledWith(SCHOOL_ID, STUDENT_1, ctx);
    expect(invoicesService.listOpenInvoiceEntitiesForStudent).toHaveBeenCalledWith(SCHOOL_ID, STUDENT_2, ctx);

    // Sorted dueDate asc, then invoiceNumber asc (INV-0000 before INV-0001 on 07-01).
    expect(result.openInvoices.map(i => i.invoiceId)).toEqual(['inv-c', 'inv-a', 'inv-b']);
    // Member-row name wins over the invoice snapshot name.
    expect(result.openInvoices[0].studentName).toBe('Bikash Rai');
    expect(result.openInvoices[0].status).toBe('partially_paid');
    // P1d — isActive never emitted.
    expect(Object.keys(result.openInvoices[0])).not.toContain('isActive');

    expect(result.totalDue).toBe(4500);
    expect(result.suggestedAllocation).toEqual([
      { invoiceId: 'inv-c', amount: 1500 },
      { invoiceId: 'inv-a', amount: 1000 },
      { invoiceId: 'inv-b', amount: 2000 },
    ]);
  });

  it('members with no open invoices still appear in students[]; empty view → totalDue 0, empty suggestion', async () => {
    const { service } = buildService({
      members: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }],
      invoicesByStudent: {},
    });
    const result = await service.getFamilyOpenInvoices(SCHOOL_ID, FAMILY_ID, ctx);
    expect(result.students).toHaveLength(1);
    expect(result.openInvoices).toEqual([]);
    expect(result.totalDue).toBe(0);
    expect(result.suggestedAllocation).toEqual([]);
  });

  it('family not found (or academics family-groups flag off) → 404 FAMILY_NOT_FOUND', async () => {
    const { service, invoicesService } = buildService({ members: 'not_found' });
    try {
      await service.getFamilyOpenInvoices(SCHOOL_ID, FAMILY_ID, ctx);
      fail('expected NotFoundException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse().code).toBe('FAMILY_NOT_FOUND');
    }
    expect(invoicesService.listOpenInvoiceEntitiesForStudent).not.toHaveBeenCalled();
  });

  it('members unavailable → 503 FAMILY_MEMBERS_UNAVAILABLE (never a lying empty family)', async () => {
    const { service } = buildService({ members: 'unavailable' });
    try {
      await service.getFamilyOpenInvoices(SCHOOL_ID, FAMILY_ID, ctx);
      fail('expected ServiceUnavailableException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ServiceUnavailableException);
      expect(e.getResponse().code).toBe('FAMILY_MEMBERS_UNAVAILABLE');
    }
  });

  it('suggestion caps at 20 targets when the family carries more open invoices (planner ceiling)', async () => {
    const invoices = Array.from({ length: 23 }, (_, i) =>
      openInvoice(`inv-${i}`, STUDENT_1, 100, `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, `INV-${String(i).padStart(4, '0')}`),
    );
    const { service } = buildService({
      members: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }],
      invoicesByStudent: { [STUDENT_1]: invoices },
    });
    const result = await service.getFamilyOpenInvoices(SCHOOL_ID, FAMILY_ID, ctx);
    expect(result.openInvoices).toHaveLength(23);
    expect(result.totalDue).toBe(2300);
    expect(result.suggestedAllocation).toHaveLength(20);
    // The 20 OLDEST — the first 20 of the sorted view.
    expect(result.suggestedAllocation.map(s => s.invoiceId)).toEqual(
      result.openInvoices.slice(0, 20).map(i => i.invoiceId),
    );
  });
});

describe('FamilyBillingService.getFamilySummary (FB-5.3)', () => {
  const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.BILLING_AGREEMENTS_ENABLED;
    else process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
  });

  const accountKey = (studentId: string) => `BILLING_ACCOUNT#${SCHOOL_ID}#${studentId}`;

  it('rolls up member balances + open invoices + agreement pointer; totals sum across members', async () => {
    const agreement = {
      agreementId: 'agr-1',
      title: 'Rai Family 2083',
      status: 'active',
    };
    const { service, dynamoDBClient } = buildService({
      members: [
        { studentId: STUDENT_1, studentName: 'Sunita Rai' },
        { studentId: STUDENT_2, studentName: 'Bikash Rai' },
      ],
      invoicesByStudent: {
        [STUDENT_1]: [
          openInvoice('inv-a', STUDENT_1, 1000, '2026-07-01', 'INV-0001'),
          openInvoice('inv-b', STUDENT_1, 500.5, '2026-08-01', 'INV-0002'),
        ],
        [STUDENT_2]: [openInvoice('inv-c', STUDENT_2, 2000, '2026-07-15', 'INV-0003')],
      },
      accountsByKey: {
        [accountKey(STUDENT_1)]: {
          balance: 1500.5,
          totalPaid: 7000,
          lastPaymentDate: '2026-06-20',
        },
        [accountKey(STUDENT_2)]: {
          balance: 2000,
          totalPaid: 0,
          lastPaymentDate: null,
        },
      },
      agreementsByStudent: {
        [STUDENT_1]: { agreement, allocationForStudent: 12000 },
        [STUDENT_2]: { agreement, allocationForStudent: 8000 },
      },
    });

    const result = await service.getFamilySummary(SCHOOL_ID, FAMILY_ID, ctx);

    expect(result.familyId).toBe(FAMILY_ID);
    expect(result.familyName).toBe('Rai family');
    expect(result.members).toEqual([
      {
        studentId: STUDENT_1,
        studentName: 'Sunita Rai',
        balance: 1500.5,
        totalPaid: 7000,
        lastPaymentDate: '2026-06-20',
        openInvoiceCount: 2,
        openAmountDue: 1500.5,
        activeAgreementId: 'agr-1',
      },
      {
        studentId: STUDENT_2,
        studentName: 'Bikash Rai',
        balance: 2000,
        totalPaid: 0,
        lastPaymentDate: null,
        openInvoiceCount: 1,
        openAmountDue: 2000,
        activeAgreementId: 'agr-1',
      },
    ]);
    expect(result.totals).toEqual({ balance: 3500.5, openAmountDue: 3500.5 });
    expect(result.agreement).toEqual({ id: 'agr-1', title: 'Rai Family 2083', status: 'active' });

    // Account lookup is a direct GetItem on the deterministic key — no
    // create-on-read.
    expect(dynamoDBClient.getItem).toHaveBeenCalledWith({}, ctx.tenantId, accountKey(STUDENT_1));
    expect(dynamoDBClient.getItem).toHaveBeenCalledWith({}, ctx.tenantId, accountKey(STUDENT_2));
  });

  it('member WITHOUT a billing account reports zeros + null lastPaymentDate (never 404)', async () => {
    const { service } = buildService({
      members: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }],
      // no accountsByKey — GetItem resolves null
    });

    const result = await service.getFamilySummary(SCHOOL_ID, FAMILY_ID, ctx);

    expect(result.members).toEqual([
      {
        studentId: STUDENT_1,
        studentName: 'Sunita Rai',
        balance: 0,
        totalPaid: 0,
        lastPaymentDate: null,
        openInvoiceCount: 0,
        openAmountDue: 0,
      },
    ]);
    expect(result.members[0]).not.toHaveProperty('activeAgreementId');
    expect(result.totals).toEqual({ balance: 0, openAmountDue: 0 });
    expect(result.agreement).toBeUndefined();
  });

  it('reuses the FB-4.6 error semantics: 404 FAMILY_NOT_FOUND / 503 FAMILY_MEMBERS_UNAVAILABLE', async () => {
    const notFound = buildService({ members: 'not_found' });
    await expect(notFound.service.getFamilySummary(SCHOOL_ID, FAMILY_ID, ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const unavailable = buildService({ members: 'unavailable' });
    await expect(
      unavailable.service.getFamilySummary(SCHOOL_ID, FAMILY_ID, ctx),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("BILLING_AGREEMENTS_ENABLED='false' → resolver never consulted; summary still returns money figures", async () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';
    const { service, agreementResolver } = buildService({
      members: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }],
      agreementsByStudent: {
        [STUDENT_1]: {
          agreement: { agreementId: 'agr-1', title: 'X', status: 'active' },
          allocationForStudent: 1,
        },
      },
    });

    const result = await service.getFamilySummary(SCHOOL_ID, FAMILY_ID, ctx);

    expect(agreementResolver.getActiveAgreementForStudent).not.toHaveBeenCalled();
    expect(result.agreement).toBeUndefined();
    expect(result.members[0]).not.toHaveProperty('activeAgreementId');
  });

  it('agreement resolution throwing degrades to "no agreement shown" — money figures unaffected', async () => {
    const { service, agreementResolver } = buildService({
      members: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }],
      accountsByKey: {
        [accountKey(STUDENT_1)]: { balance: 100, totalPaid: 50, lastPaymentDate: '2026-06-01' },
      },
    });
    agreementResolver.getActiveAgreementForStudent.mockRejectedValue(new Error('DDB down'));

    const result = await service.getFamilySummary(SCHOOL_ID, FAMILY_ID, ctx);

    expect(result.members[0].balance).toBe(100);
    expect(result.members[0]).not.toHaveProperty('activeAgreementId');
    expect(result.agreement).toBeUndefined();
  });
});

describe('IdentityClientService.getFamilyMembers (FB-4.6 client)', () => {
  function buildClient(httpGet: jest.Mock) {
    return new IdentityClientService({ get: httpGet } as any);
  }

  it('family 200 + members 200 (bare array) → kind ok with family name + members', async () => {
    const httpGet = jest.fn()
      .mockResolvedValueOnce({ data: { id: FAMILY_ID, name: 'Rai family' } })
      .mockResolvedValueOnce({ data: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }] });
    const result = await buildClient(httpGet).getFamilyMembers(FAMILY_ID, SCHOOL_ID, ctx);
    expect(result).toEqual({
      kind: 'ok',
      family: { id: FAMILY_ID, name: 'Rai family' },
      members: [{ studentId: STUDENT_1, studentName: 'Sunita Rai' }],
    });
    expect(httpGet.mock.calls[0][0]).toContain(`/academics/schools/${SCHOOL_ID}/families/${FAMILY_ID}`);
    expect(httpGet.mock.calls[1][0]).toContain(`/families/${FAMILY_ID}/members`);
  });

  it('members route returning { items } shape is accepted', async () => {
    const httpGet = jest.fn()
      .mockResolvedValueOnce({ data: { id: FAMILY_ID, name: 'Rai family' } })
      .mockResolvedValueOnce({ data: { items: [{ studentId: STUDENT_2, studentName: 'Bikash Rai' }] } });
    const result = await buildClient(httpGet).getFamilyMembers(FAMILY_ID, SCHOOL_ID, ctx);
    expect(result.kind).toBe('ok');
    expect((result as any).members).toEqual([{ studentId: STUDENT_2, studentName: 'Bikash Rai' }]);
  });

  it('family 404 → kind not_found (members leg never attempted)', async () => {
    const httpGet = jest.fn().mockRejectedValueOnce({ response: { status: 404 }, message: 'not found' });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const result = await buildClient(httpGet).getFamilyMembers(FAMILY_ID, SCHOOL_ID, ctx);
    expect(result).toEqual({ kind: 'not_found' });
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('family ok + members route 404 (academics GET /members not yet shipped) → kind members_unavailable', async () => {
    const httpGet = jest.fn()
      .mockResolvedValueOnce({ data: { id: FAMILY_ID, name: 'Rai family' } })
      .mockRejectedValueOnce({ response: { status: 404 }, message: 'Cannot GET .../members' });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const result = await buildClient(httpGet).getFamilyMembers(FAMILY_ID, SCHOOL_ID, ctx);
    expect(result).toEqual({ kind: 'members_unavailable', family: { id: FAMILY_ID, name: 'Rai family' } });
  });

  it('family fetch 5xx → members_unavailable (unverifiable family is never guessed)', async () => {
    const httpGet = jest.fn().mockRejectedValueOnce({ response: { status: 503 }, message: 'academics down' });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const result = await buildClient(httpGet).getFamilyMembers(FAMILY_ID, SCHOOL_ID, ctx);
    expect(result.kind).toBe('members_unavailable');
  });
});

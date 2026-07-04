/**
 * DashboardService Spec — pagination regression (2026-05-24 hotfix)
 *
 * **Bug being locked down:** finance/dashboard/payments/invoices services
 * all had `JSON.parse(result.lastEvaluatedKey)` in their multi-page
 * fetch loops. The DDB client wrapper base64-encodes
 * `LastEvaluatedKey` (see `finance/.../dynamodb-client.service.ts:144`
 * + the contract on `pagination.dto.ts:23`), so calling `JSON.parse`
 * directly on the encoded string throws a SyntaxError as soon as
 * pagination actually fires.
 *
 * **Why the bug surfaced 2026-05-24, not earlier:** the bug only fires
 * when `lastEvaluatedKey` is set, which happens once a (gsi1pk, prefix)
 * scope exceeds the configured page size (500 in dashboard, 1000 in
 * payments/invoices CSV streams). `dev-pabson-primary` (tenant
 * `21aea5da…`) accumulated enough INVOICE+PAYMENT rows after provisioning
 * 2026-05-08 to finally cross the boundary; up until then `lastEvaluatedKey`
 * was always undefined and the broken branch never ran.
 *
 * **Regression guard:** mock `queryGSI` to return a base64-encoded
 * cursor on the first call. Assert the SECOND call to `queryGSI`
 * receives the DECODED object as `exclusiveStartKey` (parameter
 * position 11 in the wrapper's signature) — i.e., the loop did NOT
 * pass the raw base64 string through.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DashboardService } from './dashboard.service';
import type { RequestContext } from '../common/entities/base.entity';

type AnyArgs = unknown[];

const TENANT = 'tttttttt-tttt-tttt-tttt-tttttttttttt';
const SCHOOL = 'ssssssss-ssss-ssss-ssss-ssssssssssss';
const CTX: RequestContext = {
  userId: 'u',
  tenantId: TENANT,
  email: 'e@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

/**
 * Encode a sample LastEvaluatedKey the same way the DDB wrapper does.
 * This mirrors `Buffer.from(JSON.stringify(key)).toString('base64')`.
 */
function encodeCursor(key: Record<string, string>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function makeMockDdb() {
  return {
    getClient: jest
      .fn<(...args: AnyArgs) => Promise<unknown>>()
      .mockResolvedValue({}),
    queryGSI: jest
      .fn<(...args: AnyArgs) => Promise<{ items: unknown[]; lastEvaluatedKey?: string; hasMore: boolean }>>()
      .mockResolvedValue({ items: [], hasMore: false }),
  };
}

describe('DashboardService.fetchAllEntities — base64 cursor decode (hotfix 2026-05-24)', () => {
  let ddb: ReturnType<typeof makeMockDdb>;
  let service: DashboardService;

  beforeEach(() => {
    ddb = makeMockDdb();
    service = new DashboardService(ddb as never);
  });

  it('single-page result (no cursor) — no JSON.parse runs; happy path stays clean', async () => {
    // Both fetchAllEntities calls (INVOICE + PAYMENT) return empty pages.
    ddb.queryGSI.mockResolvedValue({ items: [], hasMore: false });

    await expect(service.getSummary(SCHOOL, CTX)).resolves.toBeDefined();
    // 3 calls total: INVOICE + PAYMENT + (FB-5.5) AGREEMENT#active# prefix
    expect(ddb.queryGSI).toHaveBeenCalledTimes(3);
  });

  it('multi-page result — second queryGSI call receives the DECODED cursor, not the raw base64 string', async () => {
    const sampleCursor = {
      gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
      entityKey: 'INVOICE#some-uuid',
    };
    const encoded = encodeCursor(sampleCursor);

    // INVOICE prefix: first call yields a cursor, second call clears it.
    // PAYMENT prefix: single page (no cursor).
    let invoiceCall = 0;
    let paymentCall = 0;
    ddb.queryGSI.mockImplementation(async (...args: AnyArgs) => {
      const prefix = args[3] as string;
      if (prefix === 'INVOICE') {
        invoiceCall += 1;
        if (invoiceCall === 1) {
          return { items: [], lastEvaluatedKey: encoded, hasMore: true };
        }
        return { items: [], hasMore: false };
      }
      paymentCall += 1;
      return { items: [], hasMore: false };
    });

    await expect(service.getSummary(SCHOOL, CTX)).resolves.toBeDefined();

    // Find the second INVOICE call and inspect its exclusiveStartKey arg.
    const invoiceCalls = ddb.queryGSI.mock.calls.filter((c) => c[3] === 'INVOICE');
    expect(invoiceCalls).toHaveLength(2);
    const secondInvoiceCall = invoiceCalls[1];
    // queryGSI signature (per finance/dynamodb-client.service.ts):
    //   (client, indexName, pkValue, skValue?, skOperator?, filterExpression?,
    //    expressionAttributeValues?, expressionAttributeNames?, limit?,
    //    scanIndexForward?, exclusiveStartKey?)
    // exclusiveStartKey is the LAST positional argument (index 10).
    const exclusiveStartKey = secondInvoiceCall[10];
    expect(exclusiveStartKey).toEqual(sampleCursor);
    // Guard against the regression: the raw base64 string must NOT be passed through.
    expect(exclusiveStartKey).not.toEqual(encoded);
    expect(typeof exclusiveStartKey).toBe('object');
  });

  it('DOES NOT throw SyntaxError when DDB pagination cursor is returned (the original bug)', async () => {
    // The bug manifested as `SyntaxError: Unexpected token 'e', "eyJ…" is not valid JSON`
    // because JSON.parse ran on a base64-encoded string starting with 'eyJ'.
    // Verify the decode round-trip survives a realistic encoded cursor.
    const realisticCursor = {
      gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
      entityKey: 'INVOICE#11111111-1111-1111-1111-111111111111',
      gsi1sk: 'INVOICE#2026-04-15#11111111-1111-1111-1111-111111111111',
    };
    let invoiceCall = 0;
    ddb.queryGSI.mockImplementation(async (...args: AnyArgs) => {
      const prefix = args[3] as string;
      if (prefix === 'INVOICE') {
        invoiceCall += 1;
        if (invoiceCall === 1) {
          return { items: [], lastEvaluatedKey: encodeCursor(realisticCursor), hasMore: true };
        }
      }
      return { items: [], hasMore: false };
    });

    await expect(service.getSummary(SCHOOL, CTX)).resolves.toBeDefined();
  });
});

/**
 * EPIC-FB FB-0.1(d) + FB-0.3(b) — aggregation semantics.
 *
 * FB-0.1(d): `overdue` figures = stored-overdue + past-due partially_paid
 * (the sweep no longer erases the partial signal), while partially_paid
 * remains its own count; the overlap is surfaced as `pastDuePartiallyPaid`.
 *
 * FB-0.3(b): drafts are excluded from headline money figures by default
 * (`excludeDrafts` default TRUE); `excludeDrafts=false` folds them back in;
 * `draftTotals` reports draft exposure explicitly either way.
 */
function makeInvoiceItem(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'INVOICE',
    invoiceId: `inv-${Math.random().toString(36).slice(2, 8)}`,
    invoiceNumber: 'INV-001-2606-0001',
    studentName: 'Test Student',
    academicYear: '2025-2026',
    lineItems: [],
    grandTotal: 1000,
    amountPaid: 0,
    amountDue: 1000,
    status: 'issued',
    dueDate: '2099-12-31',
    issuedDate: '2026-06-01',
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function mockInvoicePage(
  ddb: ReturnType<typeof makeMockDdb>,
  invoices: unknown[],
  agreements: unknown[] = [],
) {
  ddb.queryGSI.mockImplementation(async (...args: AnyArgs) => {
    const prefix = args[3] as string;
    if (prefix === 'INVOICE') return { items: invoices, hasMore: false };
    // FB-5.5 — stored-active agreement rows for the coverage tile.
    if (prefix === 'AGREEMENT#active#') return { items: agreements, hasMore: false };
    return { items: [], hasMore: false }; // PAYMENT page
  });
}

describe('DashboardService — FB-0.1(d) overdue exposure includes past-due partials', () => {
  let ddb: ReturnType<typeof makeMockDdb>;
  let service: DashboardService;

  beforeEach(() => {
    ddb = makeMockDdb();
    service = new DashboardService(ddb as never);
  });

  it('overdue amount + count = stored overdue + past-due partials; partially_paid keeps its own count', async () => {
    mockInvoicePage(ddb, [
      makeInvoiceItem({ status: 'overdue', dueDate: '2020-01-01', grandTotal: 500, amountDue: 500 }),
      makeInvoiceItem({ status: 'partially_paid', dueDate: '2020-01-01', grandTotal: 1000, amountPaid: 400, amountDue: 600 }),
      makeInvoiceItem({ status: 'partially_paid', dueDate: '2099-12-31', grandTotal: 800, amountPaid: 500, amountDue: 300 }),
      makeInvoiceItem({ status: 'paid', grandTotal: 700, amountPaid: 700, amountDue: 0 }),
    ]);

    const summary = await service.getSummary(SCHOOL, CTX);

    // Money exposure: 500 (stored overdue) + 600 (past-due partial).
    expect(summary.overdue).toBe(1100);
    // Future-due partial is outstanding but NOT overdue.
    expect(summary.outstanding).toBe(500 + 600 + 300);

    // Counts: deliberate documented overlap for the past-due partial.
    expect(summary.invoicesByStatus.overdue).toBe(2);
    expect(summary.invoicesByStatus.partially_paid).toBe(2);
    expect(summary.pastDuePartiallyPaid).toEqual({ count: 1, amount: 600 });
  });

  it('no past-due partials → pastDuePartiallyPaid zeroed and overdue = stored overdue only', async () => {
    mockInvoicePage(ddb, [
      makeInvoiceItem({ status: 'overdue', dueDate: '2020-01-01', amountDue: 250, grandTotal: 250 }),
      makeInvoiceItem({ status: 'partially_paid', dueDate: '2099-12-31', amountPaid: 100, amountDue: 900 }),
    ]);

    const summary = await service.getSummary(SCHOOL, CTX);

    expect(summary.overdue).toBe(250);
    expect(summary.invoicesByStatus.overdue).toBe(1);
    expect(summary.pastDuePartiallyPaid).toEqual({ count: 0, amount: 0 });
  });
});

describe('DashboardService — FB-0.3(b) excludeDrafts (default TRUE) + draftTotals', () => {
  let ddb: ReturnType<typeof makeMockDdb>;
  let service: DashboardService;

  const fixtures = [
    makeInvoiceItem({ status: 'draft', grandTotal: 1000, amountDue: 1000, dueDate: '2020-01-01' }),
    makeInvoiceItem({ status: 'draft', grandTotal: 500, amountDue: 500 }),
    makeInvoiceItem({ status: 'issued', grandTotal: 2000, amountDue: 2000 }),
    makeInvoiceItem({ status: 'paid', grandTotal: 700, amountPaid: 700, amountDue: 0 }),
  ];

  beforeEach(() => {
    ddb = makeMockDdb();
    service = new DashboardService(ddb as never);
    mockInvoicePage(ddb, fixtures);
  });

  it('default (no filter) → drafts excluded from money figures; draftTotals + status count still present', async () => {
    const summary = await service.getSummary(SCHOOL, CTX);

    expect(summary.totalInvoiced).toBe(2700); // issued 2000 + paid 700
    expect(summary.totalCollected).toBe(700);
    expect(summary.outstanding).toBe(2000);
    // Past-due DRAFT is never overdue exposure.
    expect(summary.overdue).toBe(0);
    expect(summary.invoicesByStatus.draft).toBe(2);
    expect(summary.draftTotals).toEqual({ count: 2, amount: 1500 });
  });

  it('excludeDrafts=true explicitly → identical to the default', async () => {
    const summary = await service.getSummary(SCHOOL, CTX, { excludeDrafts: true });

    expect(summary.totalInvoiced).toBe(2700);
    expect(summary.outstanding).toBe(2000);
    expect(summary.draftTotals).toEqual({ count: 2, amount: 1500 });
  });

  it('excludeDrafts=false → drafts fold back into totalInvoiced + outstanding (draft-inclusive view)', async () => {
    const summary = await service.getSummary(SCHOOL, CTX, { excludeDrafts: false });

    expect(summary.totalInvoiced).toBe(2700 + 1500);
    expect(summary.outstanding).toBe(2000 + 1500);
    expect(summary.totalCollected).toBe(700); // drafts carry no payments
    expect(summary.overdue).toBe(0);          // still never overdue exposure
    expect(summary.invoicesByStatus.draft).toBe(2);
    expect(summary.draftTotals).toEqual({ count: 2, amount: 1500 });
  });

  it('the two excludeDrafts states are cached independently', async () => {
    const excluded = await service.getSummary(SCHOOL, CTX);
    const included = await service.getSummary(SCHOOL, CTX, { excludeDrafts: false });
    const excludedAgain = await service.getSummary(SCHOOL, CTX, { excludeDrafts: true });

    expect(excluded.totalInvoiced).toBe(2700);
    expect(included.totalInvoiced).toBe(4200);
    expect(excludedAgain.totalInvoiced).toBe(2700);
  });
});

/**
 * EPIC-FB FB-5.5 — agreementCoverage tile.
 *
 * `studentsCovered` / `activeAgreements`: ONE school-scoped GSI1 query on
 * the AGREEMENT#active# sk prefix, then a lazy-expiry re-check
 * (effectiveFrom <= today <= effectiveTo, isActive) — stored status is
 * never trusted alone; studentsCovered = distinct union of the rows'
 * studentIds snapshots.
 *
 * `invoicedViaAgreement`: derived from the SAME invoice rows the existing
 * aggregation pass scans (header agreementId present) — no second scan —
 * and respects the same draft exclusion as the headline figures.
 */
function makeAgreementRow(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'AGREEMENT',
    agreementId: `agr-${Math.random().toString(36).slice(2, 8)}`,
    schoolId: SCHOOL,
    studentIds: ['stu-1', 'stu-2'],
    status: 'active',
    effectiveFrom: '2020-01-01',
    effectiveTo: '2099-12-31',
    isActive: true,
    ...overrides,
  };
}

describe('DashboardService — FB-5.5 agreementCoverage', () => {
  let ddb: ReturnType<typeof makeMockDdb>;
  let service: DashboardService;

  beforeEach(() => {
    ddb = makeMockDdb();
    service = new DashboardService(ddb as never);
  });

  it('counts live agreements + distinct covered students; stale-active and soft-deleted rows are excluded (lazy expiry)', async () => {
    mockInvoicePage(ddb, [], [
      makeAgreementRow({ studentIds: ['stu-1', 'stu-2'] }),
      // Shares stu-2 → union dedupes.
      makeAgreementRow({ studentIds: ['stu-2', 'stu-3'] }),
      // Stored-active but past effectiveTo → stale pointer, never counted.
      makeAgreementRow({ studentIds: ['stu-9'], effectiveTo: '2020-12-31' }),
      // Not yet effective.
      makeAgreementRow({ studentIds: ['stu-8'], effectiveFrom: '2098-01-01' }),
      // Soft-deleted.
      makeAgreementRow({ studentIds: ['stu-7'], isActive: false }),
    ]);

    const summary = await service.getSummary(SCHOOL, CTX);

    expect(summary.agreementCoverage.activeAgreements).toBe(2);
    expect(summary.agreementCoverage.studentsCovered).toBe(3);
  });

  it('invoicedViaAgreement aggregates mixed invoices from the existing scan; drafts excluded by default', async () => {
    mockInvoicePage(ddb, [
      makeInvoiceItem({ status: 'issued', grandTotal: 12000, agreementId: 'agr-1' }),
      makeInvoiceItem({ status: 'paid', grandTotal: 8000, amountPaid: 8000, amountDue: 0, agreementId: 'agr-1' }),
      makeInvoiceItem({ status: 'issued', grandTotal: 2000 }), // standard
      makeInvoiceItem({ status: 'draft', grandTotal: 5000, agreementId: 'agr-1' }),
      makeInvoiceItem({ status: 'cancelled', grandTotal: 9000, agreementId: 'agr-1' }),
    ]);

    const summary = await service.getSummary(SCHOOL, CTX);

    // issued 12000 + paid 8000; draft excluded (default), cancelled never.
    expect(summary.agreementCoverage.invoicedViaAgreement).toEqual({
      count: 2,
      amount: 20000,
    });
  });

  it('excludeDrafts=false folds agreement drafts into invoicedViaAgreement (same draft rule as the headline figures)', async () => {
    mockInvoicePage(ddb, [
      makeInvoiceItem({ status: 'issued', grandTotal: 12000, agreementId: 'agr-1' }),
      makeInvoiceItem({ status: 'draft', grandTotal: 5000, agreementId: 'agr-1' }),
      makeInvoiceItem({ status: 'cancelled', grandTotal: 9000, agreementId: 'agr-1' }),
    ]);

    const summary = await service.getSummary(SCHOOL, CTX, { excludeDrafts: false });

    expect(summary.agreementCoverage.invoicedViaAgreement).toEqual({
      count: 2,
      amount: 17000,
    });
  });

  it('zero agreements + zero agreement invoices → all-zero tile (additive back-compat shape)', async () => {
    mockInvoicePage(ddb, [makeInvoiceItem({ status: 'issued', grandTotal: 2000 })]);

    const summary = await service.getSummary(SCHOOL, CTX);

    expect(summary.agreementCoverage).toEqual({
      studentsCovered: 0,
      activeAgreements: 0,
      invoicedViaAgreement: { count: 0, amount: 0 },
    });
  });

  it('agreement fetch failure degrades to zeros — the tile can never take the dashboard down', async () => {
    ddb.queryGSI.mockImplementation(async (...args: AnyArgs) => {
      const prefix = args[3] as string;
      if (prefix === 'AGREEMENT#active#') throw new Error('GSI throttled');
      if (prefix === 'INVOICE') {
        return {
          items: [makeInvoiceItem({ status: 'issued', grandTotal: 1000, agreementId: 'agr-1' })],
          hasMore: false,
        };
      }
      return { items: [], hasMore: false };
    });

    const summary = await service.getSummary(SCHOOL, CTX);

    expect(summary.agreementCoverage.studentsCovered).toBe(0);
    expect(summary.agreementCoverage.activeAgreements).toBe(0);
    // Invoice-derived figure still works — it never depended on the fetch.
    expect(summary.agreementCoverage.invoicedViaAgreement).toEqual({ count: 1, amount: 1000 });
  });
});

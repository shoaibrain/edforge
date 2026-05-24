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
    // 2 calls total: one for INVOICE, one for PAYMENT prefix
    expect(ddb.queryGSI).toHaveBeenCalledTimes(2);
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

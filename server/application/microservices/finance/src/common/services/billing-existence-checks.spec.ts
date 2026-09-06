import { RecurringBillingService } from './recurring-billing.service';
import { BillingReconciliationService } from './billing-reconciliation.service';

/**
 * Issue #467 — the two scheduled money-integrity checks decided a boolean
 * with `Scan` + `FilterExpression` + `Limit: 1`. DynamoDB applies `Limit`
 * BEFORE the filter, so each examined exactly one arbitrary row of the whole
 * table and then filtered it away: the answer was "nothing found" whenever
 * the sought row was not physically first.
 *
 * These tests model that ordering. Each fake places the matching row behind
 * non-matching ones, which is what defeated the old implementation.
 */

const TENANT_ID = 'tenant-1';
const SCHOOL_ID = 'school-1';
const STUDENT_ID = 'student-1';

/** A client whose Query honours partition, filter and paging. */
function fakeClient(rows: Array<Record<string, any>>, pageSize = 500) {
  const send = jest.fn(async (command: any) => {
    // This repo's jest setup mocks AWS SDK commands as { type, params }.
    const input = command.params ?? command.input ?? command;
    const values = input.ExpressionAttributeValues ?? {};
    const inPartition = rows.filter(r =>
      r[input.IndexName === 'GSI2' ? 'gsi2pk' : 'gsi1pk'] === values[':pk'],
    );
    let start = 0;
    if (input.ExclusiveStartKey?.entityKey) {
      const at = inPartition.findIndex(r => r.entityKey === input.ExclusiveStartKey.entityKey);
      start = at >= 0 ? at + 1 : 0;
    }
    const read = inPartition.slice(start, start + Math.min(input.Limit ?? pageSize, pageSize));
    // Limit caps rows READ; the filter is applied afterwards.
    const matched = read.filter(r => {
      if (values[':period'] !== undefined) return r.billingPeriod === values[':period'];
      if (values[':schoolPrefix'] !== undefined) {
        return String(r.entityKey).startsWith(values[':schoolPrefix']);
      }
      return true;
    });
    const exhausted = start + read.length >= inPartition.length;
    return {
      Items: matched,
      LastEvaluatedKey: exhausted || read.length === 0
        ? undefined
        : { entityKey: read[read.length - 1].entityKey },
    };
  });
  return { send };
}

describe('RecurringBillingService.hasInvoiceForBillingPeriod (#467)', () => {
  function build(rows: Array<Record<string, any>>) {
    const client = fakeClient(rows);
    const service = new RecurringBillingService(
      { getSystemClient: () => client, getTableName: () => 'tbl' } as any,
      {} as any,
    );
    return { service, client };
  }

  const gsi1pk = `TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}`;

  it('finds a billed period even when the matching row is not first', async () => {
    const rows = [
      ...Array.from({ length: 120 }, (_, i) => ({
        entityKey: `INVOICE#${SCHOOL_ID}#other-${i}`, gsi1pk, billingPeriod: '2026-08',
      })),
      { entityKey: `INVOICE#${SCHOOL_ID}#target`, gsi1pk, billingPeriod: '2026-09' },
    ];
    const { service, client } = build(rows);

    const result = await (service as any).hasInvoiceForBillingPeriod(
      client, 'tbl', TENANT_ID, SCHOOL_ID, '2026-09',
    );
    expect(result).toBe(true);
  });

  it('reports an unbilled period as unbilled', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      entityKey: `INVOICE#${SCHOOL_ID}#other-${i}`, gsi1pk, billingPeriod: '2026-08',
    }));
    const { service, client } = build(rows);

    const result = await (service as any).hasInvoiceForBillingPeriod(
      client, 'tbl', TENANT_ID, SCHOOL_ID, '2026-09',
    );
    expect(result).toBe(false);
  });

  it('queries the school partition on GSI1 instead of scanning the table', async () => {
    const { service, client } = build([]);
    await (service as any).hasInvoiceForBillingPeriod(client, 'tbl', TENANT_ID, SCHOOL_ID, '2026-09');

    const cmd = client.send.mock.calls[0][0] as any;
    const input = cmd.params ?? cmd.input ?? cmd;
    expect(input.IndexName).toBe('GSI1');
    expect(input.ExpressionAttributeValues[':pk']).toBe(gsi1pk);
    expect(input.Limit).toBeGreaterThan(1);
  });
});

describe('BillingReconciliationService.studentHasInvoices (#467)', () => {
  function build(rows: Array<Record<string, any>>) {
    const client = fakeClient(rows, 100);
    const service = new BillingReconciliationService(
      { getSystemClient: () => client, getTableName: () => 'tbl' } as any,
    );
    return { service, client };
  }

  const gsi2pk = `TENANT#${TENANT_ID}#STUDENT#${STUDENT_ID}`;

  it('finds an invoice even when it is not the first row of the partition', async () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => ({
        entityKey: `INVOICE#other-school#x-${i}`, gsi2pk,
      })),
      { entityKey: `INVOICE#${SCHOOL_ID}#target`, gsi2pk },
    ];
    const { service, client } = build(rows);

    await expect(
      (service as any).studentHasInvoices(client, 'tbl', TENANT_ID, STUDENT_ID, SCHOOL_ID),
    ).resolves.toBe(true);
  });

  it('reports a genuinely unbilled student as unbilled', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      entityKey: `INVOICE#other-school#x-${i}`, gsi2pk,
    }));
    const { service, client } = build(rows);

    await expect(
      (service as any).studentHasInvoices(client, 'tbl', TENANT_ID, STUDENT_ID, SCHOOL_ID),
    ).resolves.toBe(false);
  });

  it('queries the student partition on GSI2 instead of scanning the table', async () => {
    const { service, client } = build([]);
    await (service as any).studentHasInvoices(client, 'tbl', TENANT_ID, STUDENT_ID, SCHOOL_ID);

    const cmd = client.send.mock.calls[0][0] as any;
    const input = cmd.params ?? cmd.input ?? cmd;
    expect(input.IndexName).toBe('GSI2');
    expect(input.ExpressionAttributeValues[':pk']).toBe(gsi2pk);
    expect(input.Limit).toBeGreaterThan(1);
  });
});

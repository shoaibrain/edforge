/**
 * #502 defect A2 — a payment reversal must not resurrect an invoice whose
 * financial life has already ended.
 *
 * Runtime evidence (issue #502): voiding the remaining payment on a CANCELLED
 * invoice flipped its status back to `issued` and raised `amountDue` from
 * 8,800 to 8,900. A school cancels an invoice; weeks later a cheque bounces,
 * the cashier voids the payment that was on it, and the cancelled invoice
 * comes back to life billable at full value with nobody told.
 *
 * Both reversal entry points derived the new status from the payment totals
 * alone (`newAmountPaid <= 0 -> 'issued'`) with no regard for the invoice's
 * own lifecycle state. `reversePaymentOnInvoice` serves single-target
 * void/refund; `buildReversePaymentTransactItem` serves the multi-target
 * family-payment path — fixing only one would leave family payments broken,
 * so both are pinned here.
 *
 * The resurrection happens BELOW `validateStatusTransition`, which already
 * forbids `cancelled -> anything` and is never called on the reversal path.
 *
 * Pins:
 *   - cancelled / written_off: status, amountDue, gsi1sk and statusHistory are
 *     left out of the write entirely; only amountPaid and version move;
 *   - the pre-existing receivable is preserved as read, never recomputed, so a
 *     reversal neither corrects nor worsens rows written before this fix;
 *   - live statuses keep the pre-fix derivation and the pre-fix write shape;
 *   - both writes carry a `#status` guard alongside the version check, so a
 *     cancel landing between the read and the write cannot be overwritten;
 *   - no ExpressionAttributeValues entry is ever left unused by the
 *     expressions (DynamoDB rejects the request outright if one is).
 */

import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { InvoiceStatus } from '@aibrains/shared-types';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const TABLE = 'edforge-finance-basic';

const ctx = {
  tenantId: TENANT,
  userId: 'operator-9',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
} as any;

function makeInvoice(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    tenantId: TENANT,
    entityKey: `INVOICE#${SCHOOL}#inv-1`,
    entityType: 'INVOICE',
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-001-2606-0001',
    studentAccountId: 'acct-1',
    studentId: 'stu-1',
    studentName: 'Test Student',
    schoolId: SCHOOL,
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 8900,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 8900,
    amountPaid: 100,
    amountDue: 0,
    currency: 'NPR',
    dueDate: '2026-06-01',
    issuedDate: '2026-05-01',
    status: 'cancelled',
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: 'INVOICE#cancelled#2026-06-01',
    gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-05-01T00:00:00Z',
    updatedBy: 'admin',
    version: 7,
    ...overrides,
  } as InvoiceEntity;
}

function makeService(invoice: InvoiceEntity) {
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockResolvedValue(invoice),
    updateItem: jest.fn().mockImplementation(async () => ({})),
    getTableName: jest.fn().mockReturnValue(TABLE),
  };
  const service = new InvoicesService(
    dynamoDBClient as any,
    { publishInvoiceStatusChanged: jest.fn().mockResolvedValue(undefined) } as any,
    { getSchoolName: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, dynamoDBClient };
}

/** updateItem(client, tenantId, entityKey, expr, values, condition, names) */
function updateArgs(dynamoDBClient: { updateItem: jest.Mock }) {
  const call = dynamoDBClient.updateItem.mock.calls[0];
  return {
    updateExpression: call[3] as string,
    values: call[4] as Record<string, unknown>,
    conditionExpression: call[5] as string,
    names: call[6] as Record<string, string>,
  };
}

const LIVE_UPDATE_EXPRESSION =
  'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :newStatus, updatedAt = :now, '
  + 'gsi1sk = :gsi1sk, #v = #v + :one, statusHistory = '
  + 'list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)';

const DEAD_UPDATE_EXPRESSION = 'SET amountPaid = :amountPaid, updatedAt = :now, #v = #v + :one';

/**
 * Live-status regression table, shared by both entry points. grandTotal is
 * 8,900 throughout. Row 1 is the case the fix must NOT change: a reversal that
 * empties a *live* invoice correctly returns it to `issued`. Row 3 pins the
 * overpayment clamp (negative due -> 0).
 */
const LIVE_CASES: {
  status: InvoiceStatus;
  amountPaid: number;
  amountDue: number;
  reversalAmount: number;
  expectedStatus: InvoiceStatus;
  expectedDue: number;
  expectedPaid: number;
}[] = [
  {
    status: 'partially_paid',
    amountPaid: 100,
    amountDue: 8800,
    reversalAmount: 100,
    expectedStatus: 'issued',
    expectedDue: 8900,
    expectedPaid: 0,
  },
  {
    status: 'partially_paid',
    amountPaid: 500,
    amountDue: 8400,
    reversalAmount: 100,
    expectedStatus: 'partially_paid',
    expectedDue: 8500,
    expectedPaid: 400,
  },
  {
    status: 'paid',
    amountPaid: 9000,
    amountDue: 0,
    reversalAmount: 50,
    expectedStatus: 'paid',
    expectedDue: 0,
    expectedPaid: 8950,
  },
];

/**
 * DynamoDB rejects a request whose ExpressionAttributeValues / -Names carry an
 * entry no expression references, so a conditional write shape has to prune
 * them rather than pass the superset.
 */
function assertNoUnusedExpressionOperands(
  updateExpression: string,
  conditionExpression: string,
  values: Record<string, unknown>,
  names: Record<string, string>,
) {
  const expressions = `${updateExpression} ${conditionExpression}`;
  for (const placeholder of Object.keys(values)) {
    expect(expressions).toContain(placeholder);
  }
  for (const alias of Object.keys(names)) {
    expect(expressions).toContain(alias);
  }
}

describe('InvoicesService.reversePaymentOnInvoice — #502 A2 (single-target void/refund)', () => {
  it.each(['cancelled', 'written_off'] as const)(
    'does NOT resurrect a %s invoice — status, amountDue, gsi1sk and statusHistory stay out of the write',
    async status => {
      const invoice = makeInvoice({
        status,
        gsi1sk: `INVOICE#${status}#2026-06-01`,
      });
      const { service, dynamoDBClient } = makeService(invoice);

      await service.reversePaymentOnInvoice(SCHOOL, 'inv-1', 100, ctx);

      const { updateExpression, values, conditionExpression, names } = updateArgs(dynamoDBClient);

      expect(updateExpression).toBe(DEAD_UPDATE_EXPRESSION);
      expect(updateExpression).not.toContain('#status = :newStatus');
      expect(updateExpression).not.toContain('gsi1sk');
      expect(updateExpression).not.toContain('statusHistory');
      expect(values).not.toHaveProperty(':newStatus');
      expect(values).not.toHaveProperty(':amountDue');
      expect(values).not.toHaveProperty(':gsi1sk');
      expect(values).not.toHaveProperty(':historyEntry');

      // The void still unwinds the money that never arrived.
      expect(values[':amountPaid']).toBe(0);
      expect(values[':currentVersion']).toBe(7);

      assertNoUnusedExpressionOperands(updateExpression, conditionExpression, values, names);
    },
  );

  it('preserves a pre-fix corrupted receivable as-is rather than recomputing it', async () => {
    // Rows cancelled before #502 A1 landed still carry a non-zero amountDue.
    // The reversal must not re-derive it to grandTotal (8,900) — remediating
    // legacy rows is a separate, audited data fix.
    const invoice = makeInvoice({ amountDue: 8800 });
    const { service, dynamoDBClient } = makeService(invoice);

    await service.reversePaymentOnInvoice(SCHOOL, 'inv-1', 100, ctx);

    const { values } = updateArgs(dynamoDBClient);
    expect(values).not.toHaveProperty(':amountDue');
  });

  it('guards the write on the status it read, so a concurrent cancel cannot be overwritten', async () => {
    const { service, dynamoDBClient } = makeService(makeInvoice({ status: 'partially_paid' }));

    await service.reversePaymentOnInvoice(SCHOOL, 'inv-1', 100, ctx);

    const { conditionExpression, values, names } = updateArgs(dynamoDBClient);
    expect(conditionExpression).toBe('#v = :currentVersion AND #status = :expectedStatus');
    expect(values[':expectedStatus']).toBe('partially_paid');
    expect(names['#status']).toBe('status');
  });

  it.each(LIVE_CASES)(
    'keeps the pre-fix derivation for a live invoice: $status -> $expectedStatus',
    async ({ status, amountPaid, amountDue, reversalAmount, expectedStatus, expectedDue, expectedPaid }) => {
      const invoice = makeInvoice({ status, amountPaid, amountDue });
      const { service, dynamoDBClient } = makeService(invoice);

      await service.reversePaymentOnInvoice(SCHOOL, 'inv-1', reversalAmount, ctx);

      const { updateExpression, values, conditionExpression, names } = updateArgs(dynamoDBClient);

      expect(updateExpression).toBe(LIVE_UPDATE_EXPRESSION);
      expect(values[':newStatus']).toBe(expectedStatus);
      expect(values[':amountDue']).toBe(expectedDue);
      expect(values[':amountPaid']).toBe(expectedPaid);
      expect(values[':gsi1sk']).toBe(`INVOICE#${expectedStatus}#2026-06-01`);
      expect(values[':historyEntry']).toEqual([
        expect.objectContaining({ from: status, to: expectedStatus, changedBy: 'operator-9' }),
      ]);

      assertNoUnusedExpressionOperands(updateExpression, conditionExpression, values, names);
    },
  );
});

describe('InvoicesService.buildReversePaymentTransactItem — #502 A2 (multi-target family payment)', () => {
  function buildFor(invoice: InvoiceEntity, reversalAmount: number) {
    const { service } = makeService(invoice);
    const built = service.buildReversePaymentTransactItem(invoice, reversalAmount, ctx);
    return { built, update: built.item.Update! };
  }

  it.each(['cancelled', 'written_off'] as const)(
    'does NOT resurrect a %s invoice in the folded family-payment transaction',
    status => {
      const invoice = makeInvoice({ status, gsi1sk: `INVOICE#${status}#2026-06-01` });
      const { built, update } = buildFor(invoice, 100);

      expect(update.UpdateExpression).toBe(DEAD_UPDATE_EXPRESSION);
      expect(update.ExpressionAttributeValues).not.toHaveProperty(':newStatus');
      expect(update.ExpressionAttributeValues).not.toHaveProperty(':amountDue');
      expect(update.ExpressionAttributeValues).not.toHaveProperty(':gsi1sk');
      expect(update.ExpressionAttributeValues).not.toHaveProperty(':historyEntry');

      // Reported outcome must match what was actually written.
      expect(built.newStatus).toBe(status);
      expect(built.newAmountDue).toBe(invoice.amountDue);
      expect(built.newAmountPaid).toBe(0);

      expect(update.TableName).toBe(TABLE);
      expect(update.Key).toEqual({ tenantId: TENANT, entityKey: invoice.entityKey });

      assertNoUnusedExpressionOperands(
        update.UpdateExpression!,
        update.ConditionExpression!,
        update.ExpressionAttributeValues as Record<string, unknown>,
        update.ExpressionAttributeNames as Record<string, string>,
      );
    },
  );

  it('guards the transact write on the status it was handed', () => {
    const invoice = makeInvoice({ status: 'partially_paid', amountPaid: 500, amountDue: 8400 });
    const { update } = buildFor(invoice, 100);

    expect(update.ConditionExpression).toBe('#v = :currentVersion AND #status = :expectedStatus');
    expect(update.ExpressionAttributeValues![':expectedStatus']).toBe('partially_paid');
  });

  it.each(LIVE_CASES)(
    'keeps the pre-fix derivation for a live invoice: $status -> $expectedStatus',
    ({ status, amountPaid, amountDue, reversalAmount, expectedStatus, expectedDue, expectedPaid }) => {
      const invoice = makeInvoice({ status, amountPaid, amountDue });
      const { built, update } = buildFor(invoice, reversalAmount);

      expect(update.UpdateExpression).toBe(LIVE_UPDATE_EXPRESSION);
      expect(built.newStatus).toBe(expectedStatus);
      expect(built.newAmountDue).toBe(expectedDue);
      expect(built.newAmountPaid).toBe(expectedPaid);
      expect(update.ExpressionAttributeValues![':gsi1sk']).toBe(
        `INVOICE#${expectedStatus}#2026-06-01`,
      );

      assertNoUnusedExpressionOperands(
        update.UpdateExpression!,
        update.ConditionExpression!,
        update.ExpressionAttributeValues as Record<string, unknown>,
        update.ExpressionAttributeNames as Record<string, string>,
      );
    },
  );
});

/**
 * OverdueDetectionService spec — EPIC-FB FB-0.1 (live finding L2, risk R5).
 *
 * Locks the sweep to `issued → overdue` ONLY:
 *   - the GSI1 scan filter no longer targets the `INVOICE#partially_paid`
 *     prefix (the pre-FB-0.1 sweep erased the partial-payment signal by
 *     flipping past-due partials back to stored-overdue — observed live:
 *     overdue → partially_paid → overdue by `system`, 43 min later);
 *   - a partially_paid row that still reaches the loop (stale GSI
 *     projection race) is skipped, never written;
 *   - the L2 regression sequence (issued → partial payment → sweep) leaves
 *     `status = 'partially_paid'` while the derived mapper flag reports
 *     `isOverdue = true` — both signals preserved.
 */

import { OverdueDetectionService } from './overdue-detection.service';
import { invoiceEntityToDto, isInvoiceOverdue } from '../mappers/invoice.mapper';
import type { InvoiceEntity } from '../entities/invoice.entity';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';

/**
 * The global jest.setup.js mocks '@aws-sdk/lib-dynamodb': ScanCommand
 * becomes a factory returning `{ type: 'ScanCommand', params }`. Read the
 * payload via `.params` (falling back to `.input` should the mock ever be
 * removed and the real SDK command flow instead).
 */
const commandInput = (cmd: any): any => cmd?.input ?? cmd?.params;

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
    subtotal: 1000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 1000,
    amountPaid: 0,
    amountDue: 1000,
    currency: 'NPR',
    dueDate: '2020-01-01', // far past due
    issuedDate: '2019-12-01',
    status: 'issued',
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: 'INVOICE#issued#2020-01-01',
    gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2019-12-01T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2019-12-01T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  };
}

function makeService(scanPages: Array<{ Items: InvoiceEntity[]; LastEvaluatedKey?: any }>) {
  const send = jest.fn();
  for (const page of scanPages) send.mockResolvedValueOnce(page);
  send.mockResolvedValue({ Items: [] });

  const dynamoDBClient = {
    getSystemClient: jest.fn().mockReturnValue({ send }),
    getTableName: jest.fn().mockReturnValue('edforge-finance-basic'),
    updateItem: jest.fn().mockResolvedValue({}),
  };
  const eventsService = {
    publishInvoiceStatusChanged: jest.fn().mockResolvedValue(undefined),
  };
  const service = new OverdueDetectionService(dynamoDBClient as any, eventsService as any);
  return { service, send, dynamoDBClient, eventsService };
}

describe('OverdueDetectionService.detectOverdue — FB-0.1 issued-only sweep', () => {
  it('scan filter targets ONLY the INVOICE#issued prefix — partially_paid prefix removed', async () => {
    const { service, send } = makeService([{ Items: [] }]);

    await service.detectOverdue();

    expect(send).toHaveBeenCalled();
    const scanInput = commandInput(send.mock.calls[0][0]);
    expect(scanInput.FilterExpression).toBe(
      'begins_with(gsi1sk, :issuedPrefix) AND dueDate < :today',
    );
    expect(scanInput.ExpressionAttributeValues[':issuedPrefix']).toBe('INVOICE#issued');
    expect(scanInput.FilterExpression).not.toContain('partial');
    expect(scanInput.ExpressionAttributeValues[':partialPrefix']).toBeUndefined();
  });

  it('past-due issued invoice IS transitioned to overdue with a system statusHistory entry', async () => {
    const invoice = makeInvoice();
    const { service, dynamoDBClient, eventsService } = makeService([{ Items: [invoice] }]);

    const result = await service.detectOverdue();

    expect(result.marked).toBe(1);
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    const [, tenantId, entityKey, updateExpr, values] = dynamoDBClient.updateItem.mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(entityKey).toBe(invoice.entityKey);
    expect(updateExpr).toContain('#status = :overdue');
    expect(values[':overdue']).toBe('overdue');
    expect(values[':gsi1sk']).toBe('INVOICE#overdue#2020-01-01');
    expect(values[':historyEntry']).toEqual([
      expect.objectContaining({ from: 'issued', to: 'overdue', changedBy: 'system' }),
    ]);
    expect(eventsService.publishInvoiceStatusChanged).toHaveBeenCalledWith(
      TENANT, SCHOOL, 'inv-1', 'issued', 'overdue',
    );
  });

  it('partially_paid row surfacing in scan results (stale projection) is SKIPPED — no write, no event', async () => {
    const partial = makeInvoice({
      invoiceId: 'inv-partial',
      entityKey: `INVOICE#${SCHOOL}#inv-partial`,
      status: 'partially_paid',
      amountPaid: 400,
      amountDue: 600,
      version: 2,
    });
    const issued = makeInvoice();
    const { service, dynamoDBClient, eventsService } = makeService([
      { Items: [partial, issued] },
    ]);

    const result = await service.detectOverdue();

    expect(result.marked).toBe(1); // only the issued row
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    expect(dynamoDBClient.updateItem.mock.calls[0][2]).toBe(issued.entityKey);
    expect(eventsService.publishInvoiceStatusChanged).not.toHaveBeenCalledWith(
      TENANT, SCHOOL, 'inv-partial', expect.anything(), expect.anything(),
    );
  });

  it('ConditionalCheckFailedException (concurrent update) is skipped silently, not counted as marked', async () => {
    const invoice = makeInvoice();
    const { service, dynamoDBClient } = makeService([{ Items: [invoice] }]);
    const err = new Error('conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    dynamoDBClient.updateItem.mockRejectedValueOnce(err);

    const result = await service.detectOverdue();

    expect(result.marked).toBe(0);
    expect(result.scanned).toBe(1);
  });

  /**
   * Regression — epic §4.7 L2 live sequence:
   *   1. invoice issued
   *   2. partial payment recorded → status flips to partially_paid (v++)
   *   3. hourly sweep runs
   * Pre-FB-0.1 the sweep flipped it back to overdue (observed live, actor
   * `system`). Post-FB-0.1: the sweep never touches it — status stays
   * partially_paid AND the derived read-side flag reports it overdue.
   */
  it('L2 regression: issued → partial payment → sweep ⇒ status stays partially_paid, isOverdue=true', async () => {
    const afterPartialPayment = makeInvoice({
      status: 'partially_paid',
      gsi1sk: 'INVOICE#partially_paid#2020-01-01',
      amountPaid: 400,
      amountDue: 600,
      version: 2,
      statusHistory: [
        { from: 'draft', to: 'issued', changedAt: '2019-12-01T00:00:00Z', changedBy: 'op-1' },
        { from: 'issued', to: 'partially_paid', changedAt: '2019-12-15T00:00:00Z', changedBy: 'op-1' },
      ],
    });

    // The scan filter excludes the partially_paid prefix, so the row never
    // reaches the sweep. Feed an empty page to model the filtered scan and
    // ALSO assert the defensive in-loop skip with the row present.
    const { service: filteredSweep, dynamoDBClient: ddb1 } = makeService([{ Items: [] }]);
    await filteredSweep.detectOverdue();
    expect(ddb1.updateItem).not.toHaveBeenCalled();

    const { service: defensiveSweep, dynamoDBClient: ddb2 } = makeService([
      { Items: [afterPartialPayment] },
    ]);
    await defensiveSweep.detectOverdue();
    expect(ddb2.updateItem).not.toHaveBeenCalled();

    // Status signal preserved…
    expect(afterPartialPayment.status).toBe('partially_paid');
    // …and the derived overdue signal is present at the read boundary.
    expect(isInvoiceOverdue(afterPartialPayment)).toBe(true);
    const dto = invoiceEntityToDto(afterPartialPayment);
    expect(dto.status).toBe('partially_paid');
    expect(dto.isOverdue).toBe(true);
    expect(dto.amountPaid).toBe(400);
    expect(dto.amountDue).toBe(600);
  });
});

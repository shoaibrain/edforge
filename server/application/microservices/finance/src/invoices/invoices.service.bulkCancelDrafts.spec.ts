/**
 * EPIC-FB FB-0.3(a) — bulk draft-invoice cleanup (live finding L3: 94% of
 * pilot invoices were drafts; no lifecycle policy).
 *
 * Pins:
 *   - only status=draft rows are eligible (GSI1 `INVOICE#draft#` prefix
 *     query + per-write `#status = :draft` condition);
 *   - tenant/school scoping via the GSI1 partition key;
 *   - dryRun (the default) performs ZERO writes;
 *   - non-dry-run cancels with statusHistory actor + reason
 *     'bulk_draft_cleanup' in batches;
 *   - olderThanDays/academicYear narrowing lands in the FilterExpression;
 *   - a draft issued between query and write (conditional failure) is
 *     skipped, not counted as cancelled.
 */

import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const ctx = {
  tenantId: TENANT,
  userId: 'operator-9',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
} as any;

function makeDraft(n: number): InvoiceEntity {
  return {
    tenantId: TENANT,
    entityKey: `INVOICE#${SCHOOL}#inv-${n}`,
    entityType: 'INVOICE',
    invoiceId: `inv-${n}`,
    invoiceNumber: `INV-001-2606-${String(n).padStart(4, '0')}`,
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
    dueDate: '2026-06-01',
    issuedDate: '2026-05-01',
    status: 'draft',
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: 'INVOICE#draft#2026-06-01',
    gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-05-01T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
  };
}

function makeService(drafts: InvoiceEntity[] = []) {
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    queryGSI: jest.fn().mockResolvedValue({ items: drafts, hasMore: false }),
    updateItem: jest.fn().mockResolvedValue({}),
  };
  const eventsService = {
    publishInvoiceStatusChanged: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoicesService(
    dynamoDBClient as any,
    eventsService as any,
    { getSchoolName: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, dynamoDBClient, eventsService };
}

describe('InvoicesService.bulkCancelDrafts — FB-0.3(a)', () => {
  it('queries ONLY the draft sort-key prefix, scoped to the tenant+school partition', async () => {
    const { service, dynamoDBClient } = makeService();

    await service.bulkCancelDrafts(SCHOOL, { dryRun: true }, ctx);

    const call = dynamoDBClient.queryGSI.mock.calls[0];
    expect(call[1]).toBe('GSI1');
    expect(call[2]).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
    expect(call[3]).toBe('INVOICE#draft#');
    expect(call[4]).toBe('begins_with');
  });

  it('dryRun (default) → matched + sample reported, ZERO writes, cancelled=0', async () => {
    const drafts = Array.from({ length: 12 }, (_, i) => makeDraft(i + 1));
    const { service, dynamoDBClient, eventsService } = makeService(drafts);

    const result = await service.bulkCancelDrafts(SCHOOL, { dryRun: true }, ctx);

    expect(result).toEqual({
      matched: 12,
      cancelled: 0,
      dryRun: true,
      sample: drafts.slice(0, 10).map(d => d.invoiceNumber),
    });
    expect(result.sample).toHaveLength(10); // first 10 only
    expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(eventsService.publishInvoiceStatusChanged).not.toHaveBeenCalled();
  });

  it('non-dry-run → cancels via the status-transition shape with reason bulk_draft_cleanup + operator actor', async () => {
    const { service, dynamoDBClient, eventsService } = makeService([makeDraft(1)]);

    const result = await service.bulkCancelDrafts(SCHOOL, { dryRun: false }, ctx);

    expect(result.matched).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.dryRun).toBe(false);

    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    const [, tenantId, entityKey, updateExpr, values, condition, names] =
      dynamoDBClient.updateItem.mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(entityKey).toBe(`INVOICE#${SCHOOL}#inv-1`);
    expect(updateExpr).toContain('#status = :cancelled');
    expect(updateExpr).toContain('statusHistory = list_append');
    expect(values[':cancelled']).toBe('cancelled');
    expect(values[':gsi1sk']).toBe('INVOICE#cancelled#2026-06-01');
    expect(values[':historyEntry']).toEqual([
      expect.objectContaining({
        from: 'draft',
        to: 'cancelled',
        changedBy: 'operator-9',
        reason: 'bulk_draft_cleanup',
      }),
    ]);
    // Only-drafts guard rides the write itself (TOCTOU-safe).
    expect(condition).toBe('#status = :draft AND #v = :currentVersion');
    expect(names).toEqual({ '#status': 'status', '#v': 'version' });

    expect(eventsService.publishInvoiceStatusChanged).toHaveBeenCalledWith(
      TENANT, SCHOOL, 'inv-1', 'draft', 'cancelled',
    );
  });

  it('processes in batches (25 drafts → 25 individual conditional updates)', async () => {
    const drafts = Array.from({ length: 25 }, (_, i) => makeDraft(i + 1));
    const { service, dynamoDBClient } = makeService(drafts);

    const result = await service.bulkCancelDrafts(SCHOOL, { dryRun: false }, ctx);

    expect(result.cancelled).toBe(25);
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(25);
  });

  it('draft issued between query and write (ConditionalCheckFailedException) → skipped, not cancelled', async () => {
    const drafts = [makeDraft(1), makeDraft(2)];
    const { service, dynamoDBClient } = makeService(drafts);
    const err = new Error('conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    dynamoDBClient.updateItem.mockRejectedValueOnce(err).mockResolvedValueOnce({});

    const result = await service.bulkCancelDrafts(SCHOOL, { dryRun: false }, ctx);

    expect(result.matched).toBe(2);
    expect(result.cancelled).toBe(1);
  });

  it('olderThanDays + academicYear narrow the query via FilterExpression', async () => {
    const { service, dynamoDBClient } = makeService();
    const before = Date.now();

    await service.bulkCancelDrafts(
      SCHOOL,
      { olderThanDays: 30, academicYear: '2025-2026', dryRun: true },
      ctx,
    );

    const call = dynamoDBClient.queryGSI.mock.calls[0];
    expect(call[5]).toBe('academicYear = :academicYear AND createdAt <= :cutoff');
    expect(call[6][':academicYear']).toBe('2025-2026');
    const cutoff = new Date(call[6][':cutoff']).getTime();
    const expected = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(60_000);
  });

  it('rejects a negative/non-integer olderThanDays with 400', async () => {
    const { service } = makeService();

    await expect(
      service.bulkCancelDrafts(SCHOOL, { olderThanDays: -1, dryRun: true }, ctx),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.bulkCancelDrafts(SCHOOL, { olderThanDays: 2.5, dryRun: true }, ctx),
    ).rejects.toThrow(BadRequestException);
  });
});

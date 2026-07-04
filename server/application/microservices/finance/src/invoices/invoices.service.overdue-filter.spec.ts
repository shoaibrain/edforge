/**
 * EPIC-FB FB-0.1(c) + FB-0.2 — invoice list read paths.
 *
 * FB-0.1(c): a `status=overdue` list filter must keep returning past-due
 * `partially_paid` invoices now that the sweep no longer flips them to
 * stored-overdue. Status filtering on every list path is a FilterExpression
 * over the same key condition (NOT a status-prefixed key), so the fix is a
 * single-query filter expansion — pagination cursors are untouched. These
 * specs pin the expanded expression on all three list paths.
 *
 * FB-0.2: list/detail responses resolve schoolName from the CURRENT school
 * record (identity lookup) with the stored snapshot as fallback.
 */

import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const ctx = {
  tenantId: TENANT,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
} as any;

function makeEntity(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
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
    schoolName: 'Stored School Name',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 1000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 1000,
    amountPaid: 0,
    amountDue: 1000,
    currency: 'NPR',
    dueDate: '2020-01-01',
    issuedDate: '2019-12-01',
    status: 'partially_paid',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2019-12-01T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2019-12-01T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  };
}

function makeService(items: InvoiceEntity[] = []) {
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn(),
    queryGSI: jest.fn().mockResolvedValue({ items, hasMore: false }),
  };
  const identityClient = {
    getSchoolName: jest.fn().mockResolvedValue(null),
  };
  const service = new InvoicesService(
    dynamoDBClient as any,
    {} as any, // eventsService
    identityClient as any,
    {} as any, // tenantSettings
    {} as any, // sequenceService
    {} as any, // feeStructuresService
    {} as any, // studentAccountsService
    {} as any, // pdfLogoOptimizer
  );
  return { service, dynamoDBClient, identityClient };
}

const EXPANDED_OVERDUE_FILTER =
  '(#status = :status OR (#status = :partiallyPaid AND dueDate < :today))';

describe('FB-0.1(c) — status=overdue list filter includes past-due partials', () => {
  it('list(): overdue filter expands to stored-overdue OR past-due partially_paid', async () => {
    const { service, dynamoDBClient } = makeService();

    await service.list(SCHOOL, ctx, { status: 'overdue' });

    const call = dynamoDBClient.queryGSI.mock.calls[0];
    // (client, index, pk, sk, op, filterExpr, values, names, ...)
    expect(call[1]).toBe('GSI1');
    expect(call[5]).toBe(EXPANDED_OVERDUE_FILTER);
    expect(call[6][':status']).toBe('overdue');
    expect(call[6][':partiallyPaid']).toBe('partially_paid');
    expect(call[6][':today']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call[7]).toEqual({ '#status': 'status' });
  });

  it('list(): non-overdue status keeps the plain equality filter', async () => {
    const { service, dynamoDBClient } = makeService();

    await service.list(SCHOOL, ctx, { status: 'paid' });

    const call = dynamoDBClient.queryGSI.mock.calls[0];
    expect(call[5]).toBe('#status = :status');
    expect(call[6][':status']).toBe('paid');
    expect(call[6][':partiallyPaid']).toBeUndefined();
  });

  it('list(): overdue filter composes with academicYear', async () => {
    const { service, dynamoDBClient } = makeService();

    await service.list(SCHOOL, ctx, { status: 'overdue', academicYear: '2025-2026' });

    const call = dynamoDBClient.queryGSI.mock.calls[0];
    expect(call[5]).toBe(`${EXPANDED_OVERDUE_FILTER} AND academicYear = :academicYear`);
    expect(call[6][':academicYear']).toBe('2025-2026');
  });

  it('listForStudents(): overdue filter expanded on the per-student GSI2 queries', async () => {
    const { service, dynamoDBClient } = makeService();

    await service.listForStudents(SCHOOL, ['stu-1', 'stu-2'], ctx, { status: 'overdue' });

    const gsi2Calls = dynamoDBClient.queryGSI.mock.calls.filter(c => c[1] === 'GSI2');
    expect(gsi2Calls).toHaveLength(2);
    for (const call of gsi2Calls) {
      expect(call[5]).toBe(EXPANDED_OVERDUE_FILTER);
      expect(call[6][':partiallyPaid']).toBe('partially_paid');
    }
  });

  it('listBySchoolAndGrade(): overdue filter expanded on the GSI14 query', async () => {
    const { service, dynamoDBClient } = makeService();

    await service.listBySchoolAndGrade(SCHOOL, '4', ctx, { status: 'overdue' });

    const call = dynamoDBClient.queryGSI.mock.calls.find(c => c[1] === 'GSI14');
    expect(call).toBeDefined();
    expect(call![5]).toBe(EXPANDED_OVERDUE_FILTER);
  });

  it('a past-due partially_paid row returned by the expanded query carries isOverdue=true with status intact', async () => {
    const { service } = makeService([makeEntity()]);

    const result = await service.list(SCHOOL, ctx, { status: 'overdue' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('partially_paid');
    expect(result.items[0].isOverdue).toBe(true);
  });
});

describe('FB-0.2 — schoolName resolved at read time (list + detail)', () => {
  it('list(): renamed school → items carry the CURRENT name', async () => {
    const { service, identityClient } = makeService([makeEntity()]);
    identityClient.getSchoolName.mockResolvedValue('Renamed School');

    const result = await service.list(SCHOOL, ctx, {});

    expect(identityClient.getSchoolName).toHaveBeenCalledWith(SCHOOL, ctx);
    expect(result.items[0].schoolName).toBe('Renamed School');
  });

  it('list(): lookup returns null → stored snapshot fallback', async () => {
    const { service, identityClient } = makeService([makeEntity()]);
    identityClient.getSchoolName.mockResolvedValue(null);

    const result = await service.list(SCHOOL, ctx, {});

    expect(result.items[0].schoolName).toBe('Stored School Name');
  });

  it('list(): lookup THROWS → stored snapshot fallback (never 5xx)', async () => {
    const { service, identityClient } = makeService([makeEntity()]);
    identityClient.getSchoolName.mockRejectedValue(new Error('identity 503'));

    const result = await service.list(SCHOOL, ctx, {});

    expect(result.items[0].schoolName).toBe('Stored School Name');
  });

  it('get(): renamed school → detail carries the CURRENT name', async () => {
    const { service, dynamoDBClient, identityClient } = makeService();
    dynamoDBClient.getItem.mockResolvedValue(makeEntity());
    identityClient.getSchoolName.mockResolvedValue('Renamed School');

    const dto = await service.get(SCHOOL, 'inv-1', ctx);

    expect(dto.schoolName).toBe('Renamed School');
  });

  it('get(): lookup failure → stored snapshot fallback', async () => {
    const { service, dynamoDBClient, identityClient } = makeService();
    dynamoDBClient.getItem.mockResolvedValue(makeEntity());
    identityClient.getSchoolName.mockRejectedValue(new Error('boom'));

    const dto = await service.get(SCHOOL, 'inv-1', ctx);

    expect(dto.schoolName).toBe('Stored School Name');
  });

  it('list() with studentId (GSI2 branch) also resolves the current name', async () => {
    const { service, identityClient } = makeService([makeEntity()]);
    identityClient.getSchoolName.mockResolvedValue('Renamed School');

    const result = await service.list(SCHOOL, ctx, { studentId: 'stu-1' });

    expect(result.items[0].schoolName).toBe('Renamed School');
  });
});

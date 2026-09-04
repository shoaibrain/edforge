/**
 * InvoicesController.bulkCancelDrafts — EPIC-FB FB-0.3(a).
 *
 * Direct handler tests (manual `new InvoicesController(...,
      new JobsDispatcherService({}), // C3.7 — inline transport, as before
    )`, same pattern
 * as the F.4 bulkPdfExport spec). Pins:
 *   - dryRun DEFAULTS to true — a missing/absent flag can never trigger the
 *     destructive path; only an explicit `dryRun: false` does;
 *   - filters pass through verbatim;
 *   - permission metadata mirrors the sibling bulk mutation (bulk-issue):
 *     billing:edit scoped by the schoolId route param.
 */

import { InvoicesController } from './invoices.controller';
import { JobsDispatcherService } from '../bulk-ops/jobs-dispatcher.service';
import { PERMISSION_KEY } from '@app/auth/decorators/require-permission.decorator';

const SCHOOL = 'school-A';

function buildTenant(): any {
  return {
    tenantId: 'tenant-A',
    userId: 'op-A',
    email: 'op@example.com',
    role: 'TenantAdmin',
    globalRole: 'TenantAdmin',
    jwtToken: 'jwt',
  };
}

function buildReq(): any {
  return { headers: {} };
}

describe('InvoicesController.bulkCancelDrafts (FB-0.3a)', () => {
  let controller: InvoicesController;
  let invoicesService: any;

  beforeEach(() => {
    invoicesService = {
      bulkCancelDrafts: jest.fn().mockResolvedValue({
        matched: 3, cancelled: 0, dryRun: true, sample: ['INV-1', 'INV-2', 'INV-3'],
      }),
    };
    controller = new InvoicesController(
      invoicesService,
      {} as any, // identityClient
      {} as any, // financeJobsService
      {} as any, // bulkInvoiceGenerateWorker
      {} as any, // bulkInvoicePdfExportWorker,
      new JobsDispatcherService({}), // C3.7 — inline transport, as before
    );
  });

  it('dryRun omitted → defaults to TRUE (never destructive by accident)', async () => {
    await controller.bulkCancelDrafts(SCHOOL, {}, buildTenant(), buildReq());

    expect(invoicesService.bulkCancelDrafts).toHaveBeenCalledWith(
      SCHOOL,
      { olderThanDays: undefined, academicYear: undefined, dryRun: true },
      expect.objectContaining({ tenantId: 'tenant-A', userId: 'op-A' }),
    );
  });

  it('dryRun: true explicit → true', async () => {
    await controller.bulkCancelDrafts(SCHOOL, { dryRun: true }, buildTenant(), buildReq());
    expect(invoicesService.bulkCancelDrafts.mock.calls[0][1].dryRun).toBe(true);
  });

  it('only an explicit dryRun: false enables the destructive path; filters pass through', async () => {
    await controller.bulkCancelDrafts(
      SCHOOL,
      { dryRun: false, olderThanDays: 30, academicYear: '2025-2026' },
      buildTenant(),
      buildReq(),
    );

    expect(invoicesService.bulkCancelDrafts).toHaveBeenCalledWith(
      SCHOOL,
      { olderThanDays: 30, academicYear: '2025-2026', dryRun: false },
      expect.anything(),
    );
  });

  it('returns the service result verbatim', async () => {
    const payload = { matched: 5, cancelled: 5, dryRun: false, sample: ['INV-9'] };
    invoicesService.bulkCancelDrafts.mockResolvedValue(payload);

    const result = await controller.bulkCancelDrafts(
      SCHOOL, { dryRun: false }, buildTenant(), buildReq(),
    );

    expect(result).toEqual(payload);
  });

  it('permission mirrors bulk-issue exactly: billing:edit @ schoolId param', () => {
    const cancelMeta = Reflect.getMetadata(
      PERMISSION_KEY,
      InvoicesController.prototype.bulkCancelDrafts,
    );
    const issueMeta = Reflect.getMetadata(
      PERMISSION_KEY,
      InvoicesController.prototype.bulkIssue,
    );
    expect(cancelMeta).toEqual({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' });
    expect(cancelMeta).toEqual(issueMeta);
  });
});

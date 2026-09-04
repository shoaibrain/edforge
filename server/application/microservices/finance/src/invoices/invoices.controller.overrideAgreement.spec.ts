/**
 * `InvoicesController.generate` — FB-3.4 in-handler billing:manage gate for
 * `overrideAgreement`.
 *
 * The route's @RequirePermission decorator is static (billing:create), so
 * the escalated pricing-bypass permission is enforced inside the handler,
 * only when the flag is present. TenantAdmin bypasses RBAC exactly like
 * PermissionGuard does.
 */

import { ForbiddenException } from '@nestjs/common';
import { JobsDispatcherService } from '../bulk-ops/jobs-dispatcher.service';
import { InvoicesController } from './invoices.controller';

const SCHOOL_ID = 'school-uuid';

function makeController() {
  const invoicesService = {
    generate: jest.fn().mockResolvedValue({ id: 'inv-1' }),
  };
  const identityClient = {
    checkPermission: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const controller = new InvoicesController(
    invoicesService as any,
    identityClient as any,
    {} as any, // financeJobsService — unused by generate()
    {} as any, // bulkInvoiceGenerateWorker
    {} as any, // bulkInvoicePdfExportWorker,
    new JobsDispatcherService({}), // C3.7 — inline transport, as before
  );
  return { controller, invoicesService, identityClient };
}

function tenant(globalRole: string) {
  return {
    userId: 'user-1',
    tenantId: 'tenant-uuid',
    email: 'op@test.com',
    globalRole,
  } as any;
}

const req = { headers: { authorization: 'Bearer jwt' }, ip: '10.0.0.1' } as any;

function dto(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'student-uuid',
    feeStructureIds: ['fs-1'],
    academicYear: '2082-83',
    dueDate: '2026-08-15',
    ...overrides,
  } as any;
}

describe('InvoicesController.generate — overrideAgreement billing:manage gate (FB-3.4)', () => {
  it('overrideAgreement + non-admin + billing:manage denied → 403, service never called', async () => {
    const { controller, invoicesService, identityClient } = makeController();
    identityClient.checkPermission.mockResolvedValue({ allowed: false });

    await expect(
      controller.generate(SCHOOL_ID, dto({ overrideAgreement: true }), tenant('SchoolAdmin'), req),
    ).rejects.toThrow(ForbiddenException);

    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'billing',
      'manage',
      SCHOOL_ID,
      expect.objectContaining({ tenantId: 'tenant-uuid', jwtToken: 'jwt' }),
    );
    expect(invoicesService.generate).not.toHaveBeenCalled();
  });

  it('overrideAgreement + non-admin + billing:manage allowed → passes through to the service', async () => {
    const { controller, invoicesService, identityClient } = makeController();

    await controller.generate(
      SCHOOL_ID,
      dto({ overrideAgreement: true }),
      tenant('SchoolAdmin'),
      req,
    );

    expect(identityClient.checkPermission).toHaveBeenCalledTimes(1);
    expect(invoicesService.generate).toHaveBeenCalledWith(
      SCHOOL_ID,
      expect.objectContaining({ overrideAgreement: true }),
      expect.objectContaining({ tenantId: 'tenant-uuid' }),
    );
  });

  it('overrideAgreement + TenantAdmin → RBAC bypass, no permission round-trip', async () => {
    const { controller, invoicesService, identityClient } = makeController();

    await controller.generate(
      SCHOOL_ID,
      dto({ overrideAgreement: true }),
      tenant('TenantAdmin'),
      req,
    );

    expect(identityClient.checkPermission).not.toHaveBeenCalled();
    expect(invoicesService.generate).toHaveBeenCalled();
  });

  it('no overrideAgreement flag → billing:create decorator suffices; no in-handler check', async () => {
    const { controller, invoicesService, identityClient } = makeController();

    await controller.generate(SCHOOL_ID, dto(), tenant('SchoolAdmin'), req);

    expect(identityClient.checkPermission).not.toHaveBeenCalled();
    expect(invoicesService.generate).toHaveBeenCalled();
  });

  it('overrideAgreement:false is NOT the flag case — no in-handler check', async () => {
    const { controller, invoicesService, identityClient } = makeController();

    await controller.generate(
      SCHOOL_ID,
      dto({ overrideAgreement: false }),
      tenant('SchoolAdmin'),
      req,
    );

    expect(identityClient.checkPermission).not.toHaveBeenCalled();
    expect(invoicesService.generate).toHaveBeenCalled();
  });
});

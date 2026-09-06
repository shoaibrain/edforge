/**
 * Reverify finding — parent gradeLevel leak on the school invoice list.
 *
 * A Parent passing ?studentId=<own-child>&gradeLevel=X previously skipped
 * the auto-scope (studentId present), passed ownership on their own child,
 * then hit the staff GSI14 branch which DROPS studentId — returning every
 * grade-X invoice school-wide. Parent/Student callers must now ALWAYS be
 * routed to listForStudents, never to listBySchoolAndGrade or list().
 */

import { ForbiddenException } from '@nestjs/common';
import { JobsDispatcherService } from '../bulk-ops/jobs-dispatcher.service';
import { InvoicesController } from './invoices.controller';

const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';
const OWN_CHILD = 'student-own-uuid';
const OTHER_CHILD = 'student-other-uuid';

const tenant = (globalRole: string) => ({
  userId: 'caller-uuid',
  tenantId: 'tenant-uuid',
  email: 'caller@example.com',
  globalRole,
});

const req = { headers: { authorization: 'Bearer jwt' } } as any;

function buildController(overrides: {
  schoolRole?: string | null;
  ownedStudentIds?: string[];
  linkedStudentIds?: string[];
} = {}) {
  const owned = new Set(overrides.ownedStudentIds ?? [OWN_CHILD]);

  const invoicesService: any = {
    list: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    listForStudents: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    listBySchoolAndGrade: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const identityClient: any = {
    getUserRole: jest
      .fn()
      .mockResolvedValue(
        overrides.schoolRole === null ? null : { role: overrides.schoolRole ?? 'Parent' },
      ),
    getLinkedStudentIds: jest
      .fn()
      .mockResolvedValue(overrides.linkedStudentIds ?? [OWN_CHILD]),
    enforceStudentOwnership: jest.fn().mockImplementation(async (studentId: string) => {
      if (!owned.has(studentId)) {
        throw new ForbiddenException('Access denied to this resource');
      }
    }),
    checkPermission: jest.fn().mockResolvedValue(true),
  };

  const controller = new InvoicesController(
    invoicesService,
    identityClient,
    { get: jest.fn() } as any, // FinanceJobsService — unused by list()
    { run: jest.fn() } as any, // BulkInvoiceGenerateWorker — unused by list()
    { run: jest.fn() } as any, // BulkInvoicePdfExportWorker — unused by list(),
    new JobsDispatcherService({}), // C3.7 — inline transport, as before
  );
  return { controller, invoicesService, identityClient };
}

async function callList(
  controller: InvoicesController,
  t: any,
  opts: { studentId?: string; gradeLevel?: string; invoiceNumber?: string } = {},
) {
  return (controller as any).list(
    SCHOOL_ID,
    undefined, // status
    opts.studentId,
    undefined, // academicYear
    opts.gradeLevel,
    undefined, // billingSource
    opts.invoiceNumber, // #348 invoice-number lookup
    undefined, // limit
    undefined, // cursor
    t,
    req,
  );
}

describe('InvoicesController.list — parent scoping (reverify leak fix)', () => {
  it('Parent + own studentId + gradeLevel routes to listForStudents([child]) — never the school-wide GSI14 branch', async () => {
    const { controller, invoicesService } = buildController();

    await callList(controller, tenant('TenantUser'), {
      studentId: OWN_CHILD,
      gradeLevel: '5',
    });

    expect(invoicesService.listForStudents).toHaveBeenCalledTimes(1);
    expect(invoicesService.listForStudents.mock.calls[0][1]).toEqual([OWN_CHILD]);
    expect(invoicesService.listBySchoolAndGrade).not.toHaveBeenCalled();
    expect(invoicesService.list).not.toHaveBeenCalled();
  });

  it('Parent + unowned studentId → 403, no service call', async () => {
    const { controller, invoicesService } = buildController();

    await expect(
      callList(controller, tenant('TenantUser'), { studentId: OTHER_CHILD, gradeLevel: '5' }),
    ).rejects.toThrow(ForbiddenException);
    expect(invoicesService.listForStudents).not.toHaveBeenCalled();
    expect(invoicesService.listBySchoolAndGrade).not.toHaveBeenCalled();
  });

  it('Parent without studentId keeps the linked auto-scope (even with gradeLevel set)', async () => {
    const { controller, invoicesService } = buildController({
      linkedStudentIds: [OWN_CHILD, 'sibling-uuid'],
    });

    await callList(controller, tenant('TenantUser'), { gradeLevel: '5' });

    expect(invoicesService.listForStudents).toHaveBeenCalledTimes(1);
    expect(invoicesService.listForStudents.mock.calls[0][1]).toEqual([
      OWN_CHILD,
      'sibling-uuid',
    ]);
    expect(invoicesService.listBySchoolAndGrade).not.toHaveBeenCalled();
  });

  it('staff role + gradeLevel still uses the GSI14 school-wide branch', async () => {
    const { controller, invoicesService } = buildController({ schoolRole: 'Accountant' });

    await callList(controller, tenant('TenantUser'), { gradeLevel: '5' });

    expect(invoicesService.listBySchoolAndGrade).toHaveBeenCalledTimes(1);
    expect(invoicesService.listForStudents).not.toHaveBeenCalled();
  });

  it('TenantAdmin skips the role probe entirely', async () => {
    const { controller, invoicesService, identityClient } = buildController();

    await callList(controller, tenant('TenantAdmin'), { gradeLevel: '5' });

    expect(identityClient.getUserRole).not.toHaveBeenCalled();
    expect(invoicesService.listBySchoolAndGrade).toHaveBeenCalledTimes(1);
  });
  it('#348 — a Parent searching by invoice number stays scoped to their own children', async () => {
    const { controller, invoicesService } = buildController();

    await callList(controller, tenant('TenantUser'), {
      invoiceNumber: 'INV-420-2609-0151',
    });

    // The number narrows within the linked students; it must never reach the
    // school-wide branches.
    expect(invoicesService.listForStudents).toHaveBeenCalledTimes(1);
    expect(invoicesService.listBySchoolAndGrade).not.toHaveBeenCalled();
    expect(invoicesService.list).not.toHaveBeenCalled();
    expect(invoicesService.listForStudents.mock.calls[0][3]).toMatchObject({
      invoiceNumber: 'INV-420-2609-0151',
    });
  });
});

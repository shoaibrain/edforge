/**
 * Enrollment Billing Service
 *
 * Extracted from enrollment-webhook.controller.ts.
 * Handles enrollment→billing logic: auto-invoice generation,
 * duplicate detection, withdrawal cancellation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { ProRateService } from '../common/services/pro-rate.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import type { RequestContext } from '../common/entities/base.entity';

export interface EnrollmentBillingParams {
  tenantId: string;
  schoolId: string;
  studentId: string;
  gradeLevel: string;
  enrollmentDate: string;
  academicYearId: string;
  studentName?: string;
}

@Injectable()
export class EnrollmentBillingService {
  private readonly logger = new Logger(EnrollmentBillingService.name);

  constructor(
    private readonly feeStructuresService: FeeStructuresService,
    private readonly invoicesService: InvoicesService,
    private readonly studentAccountsService: StudentAccountsService,
    private readonly proRateService: ProRateService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * Handle student enrollment: create billing account + auto-generate invoices
   */
  async handleEnrollment(params: EnrollmentBillingParams, context: RequestContext): Promise<{
    accountId: string;
    invoiceId?: string;
    feeCount: number;
  }> {
    // 1. Resolve student name if not provided
    let studentName = params.studentName || '';
    if (!studentName) {
      try {
        const info = await this.identityClient.getStudentInfo(params.studentId, context);
        if (info) studentName = `${info.firstName} ${info.lastName}`.trim();
      } catch (err: any) {
        this.logger.warn(`Identity resolution failed for ${params.studentId}: ${err.message}`);
      }
    }

    // 2. Create/get billing account (idempotent)
    const account = await this.studentAccountsService.getOrCreate(
      params.schoolId, params.studentId, studentName, context,
    );

    // 3. Look up auto-apply fee structures
    const fees = await this.feeStructuresService.getEnrollmentFees(
      params.schoolId, params.gradeLevel, context,
    );

    if (fees.length === 0) {
      return { accountId: account.accountId, feeCount: 0 };
    }

    // 4. Check for duplicate invoices (prevent re-billing on re-enrollment events)
    const existingInvoices = await this.invoicesService.listForStudents(
      params.schoolId, [params.studentId], context, { limit: 100 },
    );
    const existingFeeIds = new Set(
      existingInvoices.items.flatMap(inv =>
        (inv.lineItems || []).map((li: any) => li.feeStructureId).filter(Boolean)
      )
    );

    // Filter out fees that already have invoices
    const newFees = fees.filter(f => !existingFeeIds.has(f.feeStructureId));

    if (newFees.length === 0) {
      this.logger.log(`No new fees to invoice for student ${params.studentId} (duplicates filtered)`);
      return { accountId: account.accountId, feeCount: 0 };
    }

    // 5. Generate invoice with pro-rating for mid-term entries
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await this.invoicesService.generate(
      params.schoolId,
      {
        feeStructureIds: newFees.map(f => f.feeStructureId),
        studentId: account.studentId,
        academicYear: params.academicYearId,
        billingPeriod: 'Enrollment',
        dueDate: dueDate.toISOString().split('T')[0],
        notes: `Auto-generated on enrollment (${params.enrollmentDate})`,
      },
      context,
    );

    this.logger.log({
      action: 'enrollment_billing.invoice_generated',
      studentId: params.studentId,
      invoiceId: invoice.id,
      feeCount: newFees.length,
      grandTotal: invoice.grandTotal,
    });

    // 6. Publish billing event
    this.eventsService.publishBillingAccountCreated(
      params.tenantId, params.schoolId, params.studentId, account.accountId, invoice.id,
    ).catch(err => this.logger.error(`Failed to publish BillingAccountCreated: ${err.message}`));

    return { accountId: account.accountId, invoiceId: invoice.id, feeCount: newFees.length };
  }

  /**
   * Handle student withdrawal: cancel draft invoices, flag active ones
   */
  async handleWithdrawal(
    schoolId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<{ cancelledCount: number; skippedCount: number }> {
    const invoiceResult = await this.invoicesService.listForStudents(
      schoolId, [studentId], context, { limit: 500 },
    );

    let cancelledCount = 0;
    let skippedCount = 0;

    for (const invoice of invoiceResult.items) {
      if (invoice.status === 'draft') {
        try {
          await this.invoicesService.update(
            schoolId, invoice.id,
            { status: 'cancelled' as any, notes: 'Student withdrawn from school' },
            context,
          );
          cancelledCount++;
        } catch (err: any) {
          this.logger.warn(`Failed to cancel invoice ${invoice.id}: ${err.message}`);
        }
      } else if (invoice.status === 'issued' || invoice.status === 'partially_paid') {
        this.logger.warn({
          action: 'withdrawal.active_invoice_skipped',
          invoiceId: invoice.id,
          status: invoice.status,
          studentId,
        });
        skippedCount++;
      }
    }

    return { cancelledCount, skippedCount };
  }
}

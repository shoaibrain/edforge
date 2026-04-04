/**
 * Enrollment Billing Service
 *
 * Handles enrollment→billing logic: auto-invoice generation,
 * idempotency via enrollmentId, withdrawal cancellation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { ProRateService } from '../common/services/pro-rate.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import type { RequestContext } from '../common/entities/base.entity';
import { calculateDueDate } from '../common/utils/due-date.util';

export interface EnrollmentBillingParams {
  tenantId: string;
  schoolId: string;
  studentId: string;
  gradeLevel: string;
  enrollmentDate: string;
  academicYearId: string;
  studentName?: string;
  enrollmentId?: string;
  enrollmentType?: string;
  /** Academic year start date — used for pro-rate calculation */
  termStartDate?: string;
  /** Academic year end date — used for pro-rate calculation */
  termEndDate?: string;
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
   * Handle student enrollment: create billing account + auto-generate issued invoice.
   * Uses enrollmentId for idempotency when available.
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

    // 3. Idempotency check via enrollmentId (if provided by academics service)
    if (params.enrollmentId) {
      const existingInvoices = await this.invoicesService.listForStudents(
        params.schoolId, [params.studentId], context, { limit: 100 },
      );
      const existingInvoice = existingInvoices.items.find(
        (inv: any) => inv.enrollmentId === params.enrollmentId,
      );
      if (existingInvoice) {
        this.logger.log({
          action: 'enrollment_billing.idempotent_skip',
          enrollmentId: params.enrollmentId,
          existingInvoiceId: existingInvoice.id,
        });
        return {
          accountId: account.accountId,
          invoiceId: existingInvoice.id,
          feeCount: existingInvoice.lineItems?.length || 0,
        };
      }
    }

    // 4. Look up auto-apply fee structures (pre-filtered by enrollment type)
    const fees = await this.feeStructuresService.getEnrollmentFees(
      params.schoolId, params.gradeLevel, context, params.enrollmentType,
    );

    if (fees.length === 0) {
      return { accountId: account.accountId, feeCount: 0 };
    }

    // 5. Fallback duplicate detection (for when enrollmentId is not available)
    if (!params.enrollmentId) {
      const existingInvoices = await this.invoicesService.listForStudents(
        params.schoolId, [params.studentId], context, { limit: 100 },
      );
      const existingFeeIds = new Set(
        existingInvoices.items.flatMap(inv =>
          (inv.lineItems || []).map((li: any) => li.feeStructureId).filter(Boolean),
        ),
      );
      const newFees = fees.filter(f => !existingFeeIds.has(f.feeStructureId));
      if (newFees.length === 0) {
        this.logger.log(`No new fees to invoice for student ${params.studentId} (duplicates filtered)`);
        return { accountId: account.accountId, feeCount: 0 };
      }
      return this.generateAndPublish(params, account, newFees, context);
    }

    return this.generateAndPublish(params, account, fees, context);
  }

  private async generateAndPublish(
    params: EnrollmentBillingParams,
    account: { accountId: string; studentId: string },
    fees: any[],
    context: RequestContext,
  ): Promise<{ accountId: string; invoiceId: string; feeCount: number }> {
    // Use the first fee's dueDateRule (all enrollment fees typically share the same rule)
    const dueDateRule = fees[0]?.dueDateRule;
    const dueDate = calculateDueDate(dueDateRule, params.enrollmentDate);

    // Calculate pro-rate discounts for mid-term enrollments when term dates are available
    const discounts: Array<{ feeStructureId: string; amount: number; reason?: string }> = [];
    if (params.termStartDate && params.termEndDate) {
      for (const fee of fees) {
        if (fee.proRateOnMidTermEntry && fee.frequency) {
          const proRatedAmount = this.proRateService.calculateProRatedAmount({
            fullAmount: fee.amount,
            termStartDate: params.termStartDate,
            termEndDate: params.termEndDate,
            enrollmentDate: params.enrollmentDate,
            frequency: fee.frequency,
            proRateEnabled: fee.proRateOnMidTermEntry,
          });
          const discount = fee.amount - proRatedAmount;
          if (discount > 0) {
            discounts.push({
              feeStructureId: fee.feeStructureId,
              amount: discount,
              reason: `Pro-rated for mid-term enrollment (${params.enrollmentDate})`,
            });
            this.logger.log({
              action: 'enrollment_billing.pro_rate_applied',
              feeStructureId: fee.feeStructureId,
              fullAmount: fee.amount,
              proRatedAmount,
              discount,
              frequency: fee.frequency,
            });
          }
        }
      }
    }

    const invoice = await this.invoicesService.generate(
      params.schoolId,
      {
        feeStructureIds: fees.map(f => f.feeStructureId),
        studentId: account.studentId,
        academicYear: params.academicYearId,
        billingPeriod: 'Enrollment',
        dueDate,
        notes: `Auto-generated on enrollment (${params.enrollmentDate})`,
        autoIssue: true,
        issuedDate: params.enrollmentDate,
        enrollmentId: params.enrollmentId,
        gradeLevel: params.gradeLevel,
        discounts: discounts.length > 0 ? discounts : undefined,
      },
      context,
    );

    this.logger.log({
      action: 'enrollment_billing.invoice_generated',
      studentId: params.studentId,
      invoiceId: invoice.id,
      feeCount: fees.length,
      grandTotal: invoice.grandTotal,
      enrollmentId: params.enrollmentId,
      status: invoice.status,
    });

    // Publish billing event
    this.eventsService.publishBillingAccountCreated(
      params.tenantId, params.schoolId, params.studentId, account.accountId, invoice.id,
    ).catch(err => this.logger.error(`Failed to publish BillingAccountCreated: ${err.message}`));

    return { accountId: account.accountId, invoiceId: invoice.id, feeCount: fees.length };
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

/**
 * Enrollment Webhook Controller
 *
 * Handles enrollment lifecycle events from the academics service:
 * - EnrollmentCompleted → creates billing account + auto-generates admission invoice
 * - StudentWithdrawn → cancels draft invoices
 *
 * Protected by InternalApiKeyGuard (service-to-service auth).
 */

import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { InvoicesService } from '../invoices/invoices.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import type { RequestContext } from '../common/entities/base.entity';

// ============================================================================
// EVENT SCHEMAS
// ============================================================================

const enrollmentCompletedSchema = z.object({
  tenantId: z.string().min(1),
  studentId: z.string().min(1),
  schoolId: z.string().min(1),
  academicYearId: z.string().min(1),
  gradeLevel: z.string().min(1),
  studentName: z.string().optional(),
  userId: z.string().optional(),
  jwtToken: z.string().optional(),
});

const studentWithdrawnSchema = z.object({
  tenantId: z.string().min(1),
  studentId: z.string().min(1),
  schoolId: z.string().min(1),
  userId: z.string().optional(),
  jwtToken: z.string().optional(),
});

type EnrollmentCompletedEvent = z.infer<typeof enrollmentCompletedSchema>;
type StudentWithdrawnEvent = z.infer<typeof studentWithdrawnSchema>;

@Controller('internal/webhooks')
@UseGuards(InternalApiKeyGuard)
export class EnrollmentWebhookController {
  private readonly logger = new Logger(EnrollmentWebhookController.name);

  constructor(
    private readonly studentAccountsService: StudentAccountsService,
    private readonly invoicesService: InvoicesService,
    private readonly feeStructuresService: FeeStructuresService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  @Post('enrollment-completed')
  async handleEnrollmentCompleted(@Body() body: unknown): Promise<{
    accountId: string;
    invoiceId?: string;
    feeCount: number;
  }> {
    const parsed = enrollmentCompletedSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const event = parsed.data;

    const context: RequestContext = {
      tenantId: event.tenantId,
      userId: event.userId || 'system',
      email: '',
      jwtToken: event.jwtToken || '',
      role: 'TenantAdmin',
      schoolId: event.schoolId,
    };

    this.logger.log({
      action: 'enrollment_webhook.received',
      studentId: event.studentId,
      schoolId: event.schoolId,
    });

    // 1. Create billing account (idempotent getOrCreate)
    let studentName = event.studentName || 'Unknown Student';
    if (!event.studentName) {
      const studentInfo = await this.identityClient.getStudentInfo(event.studentId, context);
      if (studentInfo) {
        studentName = `${studentInfo.firstName} ${studentInfo.lastName}`;
      }
    }

    const account = await this.studentAccountsService.getOrCreate(
      event.schoolId,
      event.studentId,
      studentName,
      context,
    );

    // 2. Look up auto-apply fee structures
    const admissionFees = await this.feeStructuresService.getEnrollmentFees(
      event.schoolId,
      event.gradeLevel,
      context,
    );

    let invoiceId: string | undefined;

    // 3. Auto-generate draft invoice if admission fees exist
    if (admissionFees.length > 0) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const invoice = await this.invoicesService.generate(
        event.schoolId,
        {
          feeStructureIds: admissionFees.map((f) => f.feeStructureId),
          studentAccountId: account.accountId,
          academicYear: event.academicYearId,
          billingPeriod: 'Admission',
          dueDate: dueDate.toISOString(),
          notes: 'Auto-generated on enrollment',
        },
        context,
      );

      invoiceId = invoice.id;

      this.logger.log({
        action: 'invoice.auto_generated',
        studentId: event.studentId,
        invoiceId,
        feeCount: admissionFees.length,
        grandTotal: invoice.grandTotal,
      });

      // 4. Publish event for admin notification
      this.eventsService.publishBillingAccountCreated(
        event.tenantId,
        event.schoolId,
        event.studentId,
        account.accountId,
        invoiceId,
      ).catch((err) =>
        this.logger.error(`Failed to publish BillingAccountCreated: ${err.message}`),
      );
    }

    return {
      accountId: account.accountId,
      invoiceId,
      feeCount: admissionFees.length,
    };
  }

  @Post('student-withdrawn')
  async handleStudentWithdrawn(@Body() body: unknown): Promise<{
    cancelledCount: number;
    skippedCount: number;
  }> {
    const parsed = studentWithdrawnSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const event = parsed.data;

    const context: RequestContext = {
      tenantId: event.tenantId,
      userId: event.userId || 'system',
      email: '',
      jwtToken: event.jwtToken || '',
      role: 'TenantAdmin',
      schoolId: event.schoolId,
    };

    this.logger.log({
      action: 'withdrawal_webhook.received',
      studentId: event.studentId,
      schoolId: event.schoolId,
    });

    // Find all invoices for this student
    const invoiceResult = await this.invoicesService.listForStudents(
      event.schoolId,
      [event.studentId],
      context,
      { limit: 500 },
    );

    let cancelledCount = 0;
    let skippedCount = 0;

    for (const invoice of invoiceResult.items) {
      if (invoice.status === 'draft') {
        try {
          await this.invoicesService.update(
            event.schoolId,
            invoice.id,
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
          studentId: event.studentId,
        });
        skippedCount++;
      }
    }

    return { cancelledCount, skippedCount };
  }
}

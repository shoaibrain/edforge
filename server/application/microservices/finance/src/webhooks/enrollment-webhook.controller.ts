/**
 * Enrollment Webhook Controller
 *
 * Handles enrollment lifecycle events from the academics service:
 * - EnrollmentCompleted → delegates to EnrollmentBillingService
 * - StudentWithdrawn → delegates to EnrollmentBillingService
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
import { EnrollmentBillingService } from './enrollment-billing.service';
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
  // MVP fields — optional for deployment ordering safety (finance may deploy before academics)
  enrollmentId: z.string().optional(),
  enrollmentType: z.enum(['new_admission', 'transfer', 'returning', 're_enrollment']).optional(),
  enrollmentDate: z.string().optional(),
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
    private readonly enrollmentBillingService: EnrollmentBillingService,
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
      enrollmentId: event.enrollmentId,
    });

    return this.enrollmentBillingService.handleEnrollment(
      {
        tenantId: event.tenantId,
        schoolId: event.schoolId,
        studentId: event.studentId,
        gradeLevel: event.gradeLevel,
        enrollmentDate: event.enrollmentDate || new Date().toISOString().split('T')[0],
        academicYearId: event.academicYearId,
        studentName: event.studentName,
        enrollmentId: event.enrollmentId,
        enrollmentType: event.enrollmentType,
      },
      context,
    );
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

    return this.enrollmentBillingService.handleWithdrawal(
      event.schoolId,
      event.studentId,
      context,
    );
  }
}

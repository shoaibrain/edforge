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
  Req,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
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
  // Accepts both academics ('new') and finance ('new_admission') enum values.
  // Normalized to 'new_admission' in the handler before passing to billing service.
  enrollmentType: z.enum(['new', 'new_admission', 'transfer', 'returning', 're_enrollment']).optional(),
  enrollmentDate: z.string().optional(),
  termStartDate: z.string().optional(),
  termEndDate: z.string().optional(),
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
  async handleEnrollmentCompleted(@Body() body: unknown, @Req() req: Request): Promise<{
    accountId: string;
    invoiceId?: string;
    feeCount: number;
  }> {
    const parsed = enrollmentCompletedSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const event = parsed.data;

    // JWT is sent as Authorization header by academics httpClient (by design).
    // Fall back to body field for future direct callers.
    const authHeader = (req.headers['authorization'] as string) || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (event.jwtToken || '');
    const jwtSource = authHeader.startsWith('Bearer ') ? 'header' : (event.jwtToken ? 'body' : 'none');

    // Normalize academics enum ('new') → finance enum ('new_admission').
    // The two services use different enum values for the same concept.
    // Finance fee-structure.entity.ts uses 'new_admission'; academics enrollment.schema.ts uses 'new'.
    if (event.enrollmentType === 'new') {
      (event as any).enrollmentType = 'new_admission';
    }

    // Normalize grade level to uppercase to prevent case-sensitivity mismatches
    // (e.g., 'pk' → 'PK'). ORDERED_GRADES in shared-types uses uppercase.
    if (event.gradeLevel) {
      (event as any).gradeLevel = event.gradeLevel.toUpperCase();
    }

    const context: RequestContext = {
      tenantId: event.tenantId,
      userId: event.userId || 'system',
      email: '',
      jwtToken,
      role: 'TenantAdmin',
      schoolId: event.schoolId,
    };

    this.logger.log({
      action: 'enrollment_webhook.received',
      studentId: event.studentId,
      schoolId: event.schoolId,
      enrollmentId: event.enrollmentId,
      jwtSource,
      jwtPresent: !!jwtToken,
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
        termStartDate: event.termStartDate,
        termEndDate: event.termEndDate,
      },
      context,
    );
  }

  @Post('student-withdrawn')
  async handleStudentWithdrawn(@Body() body: unknown, @Req() req: Request): Promise<{
    cancelledCount: number;
    skippedCount: number;
  }> {
    const parsed = studentWithdrawnSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const event = parsed.data;

    // JWT extraction — same pattern as enrollment-completed
    const authHeader = (req.headers['authorization'] as string) || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (event.jwtToken || '');
    const jwtSource = authHeader.startsWith('Bearer ') ? 'header' : (event.jwtToken ? 'body' : 'none');

    const context: RequestContext = {
      tenantId: event.tenantId,
      userId: event.userId || 'system',
      email: '',
      jwtToken,
      role: 'TenantAdmin',
      schoolId: event.schoolId,
    };

    this.logger.log({
      action: 'withdrawal_webhook.received',
      studentId: event.studentId,
      schoolId: event.schoolId,
      jwtSource,
      jwtPresent: !!jwtToken,
    });

    return this.enrollmentBillingService.handleWithdrawal(
      event.schoolId,
      event.studentId,
      context,
    );
  }
}

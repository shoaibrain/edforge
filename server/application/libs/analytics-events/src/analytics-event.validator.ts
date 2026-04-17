/**
 * Zod validator for AnalyticsEvent.
 *
 * Scope: this validator runs on `source = edforge.analytics` events only.
 * Domain events from academics/finance/identity services use their own
 * BaseDomainEvent shape and are NOT validated against this schema — the
 * Layer 5 aggregator handles both paths.
 */

import { z } from 'zod';
import type { AnalyticsEvent } from './analytics-event.interface';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const analyticsEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().regex(UUID_REGEX, 'eventId must be a UUID'),
  ts: z.string().datetime({ offset: true }),
  tenantId: z.string().min(1, 'tenantId required'),
  tenantTier: z.literal('BASIC'),
  userId: z.string().min(1, 'userId required'),
  role: z.enum(['SystemAdmin', 'TenantAdmin', 'Teacher', 'Parent', 'Student']),
  schoolId: z.string().min(1).optional(),
  feature: z.string().min(1, 'feature required'),
  action: z.string().min(1, 'action required'),
  correlationId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class AnalyticsEventValidationError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super(
      `AnalyticsEvent validation failed: ${issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'AnalyticsEventValidationError';
    this.issues = issues;
  }
}

export function validateAnalyticsEvent(raw: unknown): AnalyticsEvent {
  const parsed = analyticsEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalyticsEventValidationError(parsed.error.issues);
  }
  return parsed.data as AnalyticsEvent;
}

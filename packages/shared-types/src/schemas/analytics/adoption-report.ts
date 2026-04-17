/**
 * GET /analytics/tenants/{tenantId}/adoption-report — adoption report card.
 *
 * NOTE: `weekKey` semantics (ISO Mon-Sun vs Sun-Fri school week) are
 * determined by the tenant's `regional.defaultWeekStartsOn` setting, NOT
 * hardcoded in the schema. The string format is the same; the calendar
 * boundary it represents differs per tenant.
 */

import { z } from 'zod';
import {
  adoptionMetricKeySchema,
  adoptionStatusSchema,
} from './primitives';

export const adoptionMetricEntrySchema = z.object({
  value: z.number(),
  threshold: z.number(),
  status: adoptionStatusSchema,
});
export type AdoptionMetricEntry = z.infer<typeof adoptionMetricEntrySchema>;

export const adoptionReportSchema = z.object({
  tenantId: z.string().min(1),
  /** ISO week key (e.g. "2026-W16"). Boundary is per-tenant via settings. */
  weekKey: z.string().min(1),
  /**
   * Tenant's week-start setting at report-generation time. Frontend uses
   * this to label/display the week range correctly (Sun-Fri vs Mon-Sun).
   * Storage uses ISO weeks regardless; this is the *interpretation* hint.
   * Optional for backward compat with v0.24.0 callers; v0.25+ Lambda always
   * sets it.
   */
  weekStartsOn: z.enum(['sunday', 'monday', 'saturday']).optional(),
  /** True if tenant is within 21 days of provisioning — relaxed thresholds apply. */
  inGracePeriod: z.boolean(),
  /** Number of holidays excluded from this period's denominator (per tenant locale). */
  holidaysExcluded: z.number().int().min(0).optional(),
  perMetric: z.record(adoptionMetricKeySchema, adoptionMetricEntrySchema),
  overall: adoptionStatusSchema,
});
export type AdoptionReport = z.infer<typeof adoptionReportSchema>;

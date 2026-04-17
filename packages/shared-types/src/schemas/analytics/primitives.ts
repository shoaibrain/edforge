/**
 * Shared analytics primitives — locale-agnostic.
 *
 * NOTE: nothing in this file references Nepal / BS specifically. The
 * `dateSecondary.system` enum is intentionally open-ended so tenants in
 * Saudi Arabia (Hijri), Thailand (Buddhist), or Iran (Persian) can be
 * served by the same response shape.
 */

import { z } from 'zod';

/** Aggregation granularity for time-series queries. */
export const granularitySchema = z.enum(['day', 'week', 'month']);
export type Granularity = z.infer<typeof granularitySchema>;

/** Adoption status for a single metric or an overall weekly score. */
export const adoptionStatusSchema = z.enum(['PASS', 'PARTIAL', 'FAIL']);
export type AdoptionStatus = z.infer<typeof adoptionStatusSchema>;

/**
 * Adoption metric keys — universal concepts, not Nepal-specific.
 * Two of them (`parentPortalReach`, `studentPortalReach`) require modules
 * out of V1 BASIC scope; consumers should hide them from the UI when not
 * applicable.
 */
export const adoptionMetricKeySchema = z.enum([
  'teacherLoginCadence',
  'attendanceCoverage',
  'gradeSubmissionCadence',
  'adminActivity',
  'parentPortalReach',
  'studentPortalReach',
]);
export type AdoptionMetricKey = z.infer<typeof adoptionMetricKeySchema>;

/**
 * Generic secondary-calendar entry. Examples:
 *   { system: 'BS', value: '2083-01-02' }              // Bikram Sambat
 *   { system: 'HIJRI', value: '1447-09-28' }           // Islamic
 *   { system: 'THAI_BUDDHIST', value: '2569-04-15' }   // Thai Buddhist
 *
 * `system` is a free-form string so adding a new calendar requires no
 * shared-types release. Consumers should treat unknown `system` values as
 * opaque and pass them through to display.
 */
export const dateSecondarySchema = z.object({
  system: z.string().min(1),
  value: z.string().min(1),
});
export type DateSecondary = z.infer<typeof dateSecondarySchema>;

/**
 * Attendance policy resolver response — Attendance Domain epic (Sprint 2, S2.T5).
 *
 * Shape returned by `GET /academics/attendance/policy?schoolId=`. The resolver
 * computes the effective attendance mode + counting policy via
 * `school override → (inherited tenant default) → archetype default → platform`.
 */
import { z } from 'zod';
import { attendancePolicySchema, attendanceCountingPolicySchema } from '../common-policies';

/** Where a resolved value came from. (`tenant` reserved for a future live
 *  workspace-default fallback; the tenant default is inherited into the school
 *  config at create time today, so the resolver emits `school` for it.) */
export const attendancePolicySourceSchema = z.enum(['school', 'tenant', 'archetype', 'platform']);
export type AttendancePolicySource = z.infer<typeof attendancePolicySourceSchema>;

export const attendancePolicyResponseSchema = z.object({
  schoolId: z.string(),
  /** Resolved attendance mode for this school. */
  effectiveMode: attendancePolicySchema,
  /** Provenance of the mode. */
  modeSource: attendancePolicySourceSchema,
  /** Resolved counting policy (archetype / platform; per-school override is a future add). */
  countingPolicy: attendanceCountingPolicySchema,
  /** Provenance of the counting policy. */
  countingSource: attendancePolicySourceSchema,
  /** Tenant archetype used for the fallback (omitted when unresolved). */
  archetype: z.string().optional(),
});
export type AttendancePolicyResponseDto = z.infer<typeof attendancePolicyResponseSchema>;

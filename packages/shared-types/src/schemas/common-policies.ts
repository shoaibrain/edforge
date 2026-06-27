/**
 * Shared attendance-policy primitives — Attendance Domain epic (Sprint 2, §2.3 / D5).
 *
 * Cross-domain contract consumed by BOTH:
 *   - identity  (tenant workspace `policySettingsSchema` + per-school config), and
 *   - academics (the attendance policy resolver).
 *
 * Kept a leaf module (imports only `zod`) so both domains import from here
 * without a cyclic edge. The archetype-keyed DEFAULT VALUES live in
 * `archetype/attendance-policy-defaults.ts`; this file is only the contract.
 */
import { z } from 'zod';

/**
 * How a school's daily attendance is AGGREGATED from per-section records.
 *
 * Recording is always per-section (Ed-Fi `StudentSectionAttendanceEvent`); a
 * "homeroom" is just whichever section is first on a student's day, derived —
 * never stored. This policy only governs how section records roll up to
 * "did the student attend school today":
 *  - `daily_presence`       — present for the day if the student has >=1 `Present`
 *                             record in ANY section that day (PABSON default).
 *                             Once present, subsequent sections lock the row as
 *                             already-present (a late arrival can still flip
 *                             Absent->Present; Present->Absent is not allowed).
 *  - `per_section_granular` — present for the day if `Present` in >= X% of the
 *                             student's scheduled sections that day, where X is
 *                             `attendanceCountingPolicy.granularPresenceThresholdPct`
 *                             (default 50). No cross-section locking; audit-friendly.
 */
export const attendancePolicySchema = z.enum(['daily_presence', 'per_section_granular']);
export type AttendancePolicy = z.infer<typeof attendancePolicySchema>;

/** How an excused absence is treated when computing the attendance rate. */
export const excusedTreatmentSchema = z.enum(['absent_for_rate', 'present_for_rate']);
export type ExcusedTreatment = z.infer<typeof excusedTreatmentSchema>;

/**
 * How attendance statuses roll up to metrics (rate / ADA / chronic absenteeism).
 * Archetype-defaulted, tenant/school-overridable (epic §2.3). Every field has a
 * researched default so `attendanceCountingPolicySchema.parse({})` materializes
 * the platform default.
 *
 * Researched defaults (PABSON/Nepal IEMIS + Ed-Fi):
 *  - attending = present/late/tardy/remote; half-day counts 0.5.
 *  - `excused` REDUCES the attendance rate (Nepal: approved leave is a non-
 *    attended day) but COUNTS toward chronic absenteeism (US ED / Ed-Fi count
 *    excused + unexcused). That is why rate and chronic diverge on excused.
 */
export const attendanceCountingPolicySchema = z.object({
  /** Statuses counted as "attending" in the rate numerator. */
  attendingCategories: z.array(z.string()).default(['present', 'late', 'tardy', 'remote']),
  /** Fractional day weight per partial status (applied to numerator AND denominator). */
  partialDayWeights: z.record(z.number()).default({ half_day: 0.5 }),
  /** Excused reduces the attendance rate by default (Nepal/IEMIS). */
  excusedTreatment: excusedTreatmentSchema.default('absent_for_rate'),
  /** Chronic absenteeism counts excused + unexcused (US ED / Ed-Fi). */
  chronicCountsExcused: z.boolean().default(true),
  /** Absent >= this percent of instructional days => chronically absent. */
  chronicThresholdPct: z.number().min(0).max(100).default(10),
  /** Attendance rate below this percent => flagged at-risk on the dashboard. */
  atRiskThresholdPct: z.number().min(0).max(100).default(90),
  /**
   * Under `per_section_granular`: a student is present for the day if they are
   * `Present` in >= this percent of their scheduled sections that day. Ignored
   * under `daily_presence` (which needs only one Present record). Lives on the
   * counting policy so all aggregation knobs are school-overridable together.
   */
  granularPresenceThresholdPct: z.number().min(1).max(100).default(50),
});
export type AttendanceCountingPolicy = z.infer<typeof attendanceCountingPolicySchema>;

/** The platform-default counting policy (schema defaults materialized once). */
export const PLATFORM_ATTENDANCE_COUNTING_POLICY: AttendanceCountingPolicy =
  attendanceCountingPolicySchema.parse({});

/**
 * Weight a single attendance status toward the attendance-rate numerator under a
 * counting policy. The one place the policy's rate semantics are interpreted, so
 * every rate computation (daily summary, ADA, reports) stays consistent.
 *
 *   1   — full attending day (present / late / tardy / remote by default)
 *   0.5 — partial-day status (half_day by default, via `partialDayWeights`)
 *   0   — non-attending (absent; excused under the default `absent_for_rate`)
 *
 * Excused follows the policy's `excusedTreatment` (Nepal/IEMIS default reduces
 * the rate → 0; `present_for_rate` → 1). A partial-day weight takes precedence
 * over membership in `attendingCategories` so a fractional status never counts
 * as a whole day.
 */
export function attendanceRateWeight(
  status: string,
  policy: AttendanceCountingPolicy = PLATFORM_ATTENDANCE_COUNTING_POLICY,
): number {
  if (status === 'excused') {
    return policy.excusedTreatment === 'present_for_rate' ? 1 : 0;
  }
  const partial = policy.partialDayWeights[status];
  if (partial !== undefined) {
    return partial;
  }
  return policy.attendingCategories.includes(status) ? 1 : 0;
}

/** Platform-default attendance policy — per-section granular aggregation, the
 *  audit-friendly default that matches non-archetype section-driven behavior. */
export const PLATFORM_ATTENDANCE_POLICY: AttendancePolicy = 'per_section_granular';

/**
 * Coerce a persisted attendance-policy value to the current enum.
 *
 * The pre-realignment enum was `daily | period | both`; rows written before the
 * derived-attendance model still carry those values. Applied at the DDB read
 * boundary (identity school config + workspace settings) so legacy data never
 * fails the new enum's validation:
 *   daily -> daily_presence, both -> daily_presence, period -> per_section_granular.
 * Returns `undefined` for null/unknown so callers fall through to the resolver default.
 */
const LEGACY_ATTENDANCE_POLICY_MAP: Record<string, AttendancePolicy> = {
  daily: 'daily_presence',
  both: 'daily_presence',
  period: 'per_section_granular',
};

export function coerceAttendancePolicy(
  value: string | null | undefined,
): AttendancePolicy | undefined {
  if (value == null) return undefined;
  if (value === 'daily_presence' || value === 'per_section_granular') return value;
  return LEGACY_ATTENDANCE_POLICY_MAP[value];
}

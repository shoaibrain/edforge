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
 * How a school takes attendance:
 *  - `daily`  — one school-day roll-call per student per day (PABSON homeroom).
 *  - `period` — per subject-section (today's behavior; `period` is the legacy
 *               enum label — true per-period timetable attendance is deferred).
 *  - `both`   — daily is authoritative; subject sections are also recorded.
 */
export const attendancePolicySchema = z.enum(['daily', 'period', 'both']);
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
});
export type AttendanceCountingPolicy = z.infer<typeof attendanceCountingPolicySchema>;

/** The platform-default counting policy (schema defaults materialized once). */
export const PLATFORM_ATTENDANCE_COUNTING_POLICY: AttendanceCountingPolicy =
  attendanceCountingPolicySchema.parse({});

/** Platform-default attendance mode — section-driven, matching today's behavior. */
export const PLATFORM_ATTENDANCE_POLICY: AttendancePolicy = 'period';

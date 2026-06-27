/**
 * Archetype-keyed attendance policy + counting-policy defaults
 * (Attendance Domain epic §2.3 / D5).
 *
 * Keyed by `ActiveArchetype` so a new governance body fails at compile time.
 * Adding a new archetype = one row here, zero service code (mirrors the
 * `ARCHETYPE_DEFAULTS_TABLE` / `ARCHETYPE_SCHOOL_DAYS` pattern).
 */
import type { ActiveArchetype } from '../schemas/identity/tenant.schema';
import {
  PLATFORM_ATTENDANCE_COUNTING_POLICY,
  PLATFORM_ATTENDANCE_POLICY,
  type AttendancePolicy,
  type AttendanceCountingPolicy,
} from '../schemas/common-policies';

/**
 * Default attendance policy per archetype. PABSON counts a student present for
 * the day if any section marks them present (`daily_presence`); GENERIC audits
 * presence per-section (`per_section_granular`). Both aggregate from the same
 * per-section records — the policy only changes the rollup rule, never recording.
 */
export const ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS: Record<ActiveArchetype, AttendancePolicy> = {
  PABSON: 'daily_presence',
  GENERIC: 'per_section_granular',
};

/**
 * Default COUNTING policy per archetype. Identical today — the researched
 * Nepal/IEMIS + Ed-Fi defaults are sound cross-archetype — but the per-archetype
 * table exists so a future archetype (e.g. an ADM-funded US model that counts
 * excused as present-for-membership) can diverge without touching service code.
 */
export const ARCHETYPE_ATTENDANCE_COUNTING_DEFAULTS: Record<ActiveArchetype, AttendanceCountingPolicy> = {
  PABSON: PLATFORM_ATTENDANCE_COUNTING_POLICY,
  GENERIC: PLATFORM_ATTENDANCE_COUNTING_POLICY,
};

export interface ArchetypeAttendanceDefaults {
  mode: AttendancePolicy;
  countingPolicy: AttendanceCountingPolicy;
}

/**
 * Resolve archetype attendance defaults. An unknown or unresolved archetype
 * falls back to the platform default (`per_section_granular` + platform counting)
 * rather than throwing — the attendance policy resolver must degrade
 * gracefully when a tenant's archetype can't be read.
 */
export function getArchetypeAttendanceDefaults(archetype?: string): ArchetypeAttendanceDefaults {
  const key = archetype?.toUpperCase();
  // String-indexed views of the exhaustive `Record<ActiveArchetype, …>` consts:
  // an unknown archetype yields `undefined` honestly (so the `??` fallback is
  // real), instead of an `as ActiveArchetype` cast that hides the miss from TS.
  const modeByKey: Record<string, AttendancePolicy | undefined> = ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS;
  const countingByKey: Record<string, AttendanceCountingPolicy | undefined> =
    ARCHETYPE_ATTENDANCE_COUNTING_DEFAULTS;
  const mode = (key && modeByKey[key]) || PLATFORM_ATTENDANCE_POLICY;
  const countingPolicy = (key && countingByKey[key]) || PLATFORM_ATTENDANCE_COUNTING_POLICY;
  return { mode, countingPolicy };
}

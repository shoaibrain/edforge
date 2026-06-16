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
 * Default attendance MODE per archetype. PABSON takes one daily homeroom
 * roll-call; GENERIC keeps subject-section (`period`) attendance — today's
 * behavior, so leaving it unchanged is a no-op for non-PABSON tenants.
 */
export const ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS: Record<ActiveArchetype, AttendancePolicy> = {
  PABSON: 'daily',
  GENERIC: 'period',
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
 * falls back to the platform default (`period` mode + platform counting)
 * rather than throwing — the attendance policy resolver must degrade
 * gracefully when a tenant's archetype can't be read.
 */
export function getArchetypeAttendanceDefaults(archetype?: string): ArchetypeAttendanceDefaults {
  const key = archetype?.toUpperCase() as ActiveArchetype | undefined;
  const mode = (key && ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS[key]) || PLATFORM_ATTENDANCE_POLICY;
  const countingPolicy =
    (key && ARCHETYPE_ATTENDANCE_COUNTING_DEFAULTS[key]) || PLATFORM_ATTENDANCE_COUNTING_POLICY;
  return { mode, countingPolicy };
}

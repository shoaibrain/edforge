/**
 * Archetype activation requirements — Sprint S0.6
 *
 * Declares the per-archetype gate a school must pass before it can
 * transition from `setup → active`. The gate is **data**, not code:
 * the service layer reads from this table and never branches on
 * `tenant.archetype === 'PABSON'`. Invariant #8 in the sprint plan
 * (Part J): *core archetype-neutral, edges archetype-specific*.
 *
 * **Adding a new archetype** = add an entry here + ship the
 * corresponding ARCHETYPE_DEFAULTS row in tenant-locale-defaults.ts.
 * No service-layer code change needed.
 *
 * **Adding a new requirement key** = extend `ActivationRequirementKey`
 * + handle the new key in the service's `checkActivationRequirement()`
 * dispatcher. The data table here stays canonical.
 */

import { ActiveArchetype } from '../locale/tenant-locale-defaults';

/**
 * Canonical set of activation requirements that any archetype can
 * compose from. Each key has a matching checker in the identity
 * service (schools.service.ts) — keep them in lockstep.
 */
export type ActivationRequirementKey =
  | 'academic_year_active'
  | 'grading_periods'
  | 'bell_schedule'
  | 'calendar_generated';

export interface ActivationRequirementSpec {
  /** Stable key used by the service to dispatch the right checker. */
  key: ActivationRequirementKey;
  /** Human-readable label suitable for the AdminWeb setup checklist. */
  label: string;
  /** Minimum count of the underlying resource. Most are 1; PABSON terms is 4. */
  minCount: number;
}

export interface ArchetypeActivationConfig {
  archetype: ActiveArchetype;
  requirements: ActivationRequirementSpec[];
}

/**
 * The PABSON setup checklist matches the Saraswati pilot's operational
 * reality: a school cannot meaningfully run without a current academic
 * year, all four terms (PABSON private schools are universally 4-term
 * — see `docs/saraswati-academic-setup-evidence.md` §8), a default bell
 * schedule, and a generated calendar (proves `generate-calendar` was
 * run; without it attendance falls through to graceful-degradation
 * "no calendar means allow everything" mode).
 *
 * GENERIC keeps the V1 minimum so non-PABSON / non-archetype tenants
 * can still operate.
 */
export const ARCHETYPE_ACTIVATION_REQUIREMENTS: Record<
  ActiveArchetype,
  ArchetypeActivationConfig
> = {
  PABSON: {
    archetype: 'PABSON',
    requirements: [
      {
        key: 'academic_year_active',
        label: 'At least one academic year with status = active',
        minCount: 1,
      },
      {
        key: 'grading_periods',
        label: 'Four grading periods (terms) across active academic years',
        minCount: 4,
      },
      {
        key: 'bell_schedule',
        label: 'A default bell schedule',
        minCount: 1,
      },
      {
        key: 'calendar_generated',
        label: 'Calendar generated for the active academic year',
        minCount: 1,
      },
    ],
  },
  GENERIC: {
    archetype: 'GENERIC',
    requirements: [
      {
        key: 'academic_year_active',
        label: 'At least one academic year with status = active',
        minCount: 1,
      },
    ],
  },
};

/**
 * Resolve activation config for an archetype string. Falls back to
 * GENERIC for an unrecognized or missing archetype — fail-loud would
 * block tenant operations on a Cognito-claim typo, which is strictly
 * worse than under-gating.
 */
export function getActivationRequirements(
  archetype: string | undefined | null,
): ArchetypeActivationConfig {
  if (archetype) {
    const key = archetype.toUpperCase() as ActiveArchetype;
    if (ARCHETYPE_ACTIVATION_REQUIREMENTS[key]) {
      return ARCHETYPE_ACTIVATION_REQUIREMENTS[key];
    }
  }
  return ARCHETYPE_ACTIVATION_REQUIREMENTS.GENERIC;
}

/**
 * Per-requirement check result. Shape is shared between:
 *   - the service-layer activation gate (transitionStatus)
 *   - the GET /:schoolId/activation-requirements endpoint
 *   - the frontend setup checklist
 *
 * The frontend renders one row per result, ticked when `met: true`.
 * A school is activatable iff every result has `met: true`.
 */
export interface ActivationRequirementCheck {
  key: ActivationRequirementKey;
  label: string;
  /** Minimum count required by the archetype. */
  required: number;
  /** Actual count observed for this school right now. */
  current: number;
  /** Whether `current >= required`. */
  met: boolean;
}

export interface ActivationRequirementsResponse {
  /** The tenant's archetype (e.g. 'PABSON', 'GENERIC'). */
  archetype: string;
  /** Per-requirement check, in declaration order. */
  requirements: ActivationRequirementCheck[];
  /** True iff every requirement is met. The activation-gate is otherwise refused. */
  canActivate: boolean;
}

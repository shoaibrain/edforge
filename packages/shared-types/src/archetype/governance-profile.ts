/**
 * `GovernanceProfile` — the single per-governance-body aggregator (Sprint GB0).
 *
 * A **view over the already-shipped archetype tables, never a copy.** Every
 * slot type is the *real* source type — indexed-access into `ArchetypeDefaults`
 * for the six slots that table backs, or the source table's own element type
 * for the rest — so the profile shape cannot drift from its backing constants.
 *
 * Types only. The runtime composition `getGovernanceProfile(archetype)` lands
 * in GB0.3 and a deep-equal drift guard (GB0.6) proves the view never diverges
 * from its sources.
 *
 * See RFC 0001 — docs/archetype-framework/rfcs/0001-governance-profile.md.
 */

import type { ActiveArchetype } from '../schemas/identity/tenant.schema';
import type { ArchetypeDefaults } from '../schemas/archetype-defaults.schema';
import { ARCHETYPE_DEFAULTS, type RegionalSettings } from '../locale/tenant-locale-defaults';
import { ARCHETYPE_DEFAULTS_TABLE } from './archetype-defaults';
import { ARCHETYPE_BELL_PRESETS, type BellSchedulePresetSet } from './bell-schedule-presets';
import { ARCHETYPE_ACTIVATION_REQUIREMENTS, type ArchetypeActivationConfig } from './activation-requirements';
import { ARCHETYPE_SCHOOL_DAYS, schoolDayNumbersToNames } from './school-config-defaults';

/**
 * School-config defaults slot. Backed by `ARCHETYPE_SCHOOL_DAYS` (GB1.2a) and
 * projected to day names by the composer below (GB1.2b). Deliberately minimal —
 * the operating week is the only school-config fact the aggregator needs today;
 * extend it in lockstep with its source rather than inventing fields ahead of use.
 */
export interface SchoolConfigDefaults {
  /** Operating days of the school week (PABSON: sun–fri). */
  readonly schoolDays: readonly string[];
}

/**
 * One governance body, one object — the surface a consumer imports, the
 * conformance suite iterates, and the "adding a governance body" runbook points
 * at. Composes (never duplicates) the existing tables:
 *
 *   regional                       ← ARCHETYPE_DEFAULTS (tenant-locale-defaults.ts)
 *   grading/promotionDefaults/     ← ARCHETYPE_DEFAULTS_TABLE (archetype-defaults.ts,
 *   examPattern/boardExams/          typed by archetype-defaults.schema.ts)
 *   primaryCurriculumRef/complianceForms
 *   bellPresets                    ← ARCHETYPE_BELL_PRESETS
 *   activation                     ← ARCHETYPE_ACTIVATION_REQUIREMENTS
 *   schoolConfigDefaults           ← getDefaultConfigForArchetype (GB1.2b)
 *   complianceRequiredDescriptors  ← NET-NEW first-class data (GB0.2b)
 */
export interface GovernanceProfile {
  readonly archetype: ActiveArchetype;
  readonly regional: Readonly<RegionalSettings>;
  readonly grading: ReadonlyArray<Readonly<ArchetypeDefaults['letterGrades'][number]>>;
  readonly promotionDefaults: Readonly<ArchetypeDefaults['promotionDefaults']>;
  readonly examPattern: ReadonlyArray<ArchetypeDefaults['examPattern'][number]>;
  readonly boardExams: ReadonlyArray<Readonly<ArchetypeDefaults['boardExams'][number]>>;
  readonly primaryCurriculumRef: ArchetypeDefaults['primaryCurriculumRef'];
  readonly complianceForms: ReadonlyArray<ArchetypeDefaults['complianceForms'][number]>;
  readonly bellPresets: Readonly<BellSchedulePresetSet>;
  readonly activation: Readonly<ArchetypeActivationConfig>;
  readonly schoolConfigDefaults: SchoolConfigDefaults;
  /** Ed-Fi descriptors this body's compliance submissions require (← ARCHETYPE_DEFAULTS_TABLE; GB0.2b). */
  readonly complianceRequiredDescriptors: ReadonlyArray<ArchetypeDefaults['complianceRequiredDescriptors'][number]>;
}

/**
 * Compose the `GovernanceProfile` for a governance body (GB0.3 / GB1.2b).
 *
 * A pure view: every slot indexes an existing source constant. The lone
 * derivation is `schoolConfigDefaults.schoolDays`, projected from
 * `ARCHETYPE_SCHOOL_DAYS` (numeric source) to day names — a freshly-built array,
 * so it stays out of the GB0.6 by-reference drift guard while still tracing to a
 * single archetype-keyed source. Adding a new governance body needs **zero edits
 * here** — populate the source tables + the enum and this function (and the
 * conformance suite) light up automatically.
 */
export function getGovernanceProfile(archetype: ActiveArchetype): GovernanceProfile {
  const defaults = ARCHETYPE_DEFAULTS_TABLE[archetype];
  return {
    archetype,
    regional: ARCHETYPE_DEFAULTS[archetype],
    grading: defaults.letterGrades,
    promotionDefaults: defaults.promotionDefaults,
    examPattern: defaults.examPattern,
    boardExams: defaults.boardExams,
    primaryCurriculumRef: defaults.primaryCurriculumRef,
    complianceForms: defaults.complianceForms,
    bellPresets: ARCHETYPE_BELL_PRESETS[archetype],
    activation: ARCHETYPE_ACTIVATION_REQUIREMENTS[archetype],
    schoolConfigDefaults: { schoolDays: schoolDayNumbersToNames(ARCHETYPE_SCHOOL_DAYS[archetype]) },
    complianceRequiredDescriptors: defaults.complianceRequiredDescriptors,
  };
}

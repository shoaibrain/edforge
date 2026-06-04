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

/**
 * School-config defaults slot. **GB0.3 ships this stubbed**; GB1.2b finalizes it
 * from `getDefaultConfigForArchetype` (which does not exist yet). Deliberately
 * minimal until then — extend it in lockstep with GB1.2a so the slot tracks the
 * real config shape rather than inventing one ahead of its source.
 */
export interface SchoolConfigDefaults {
  /** Operating days of the school week (PABSON: sun–fri). */
  schoolDays: string[];
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
  archetype: ActiveArchetype;
  regional: RegionalSettings;
  grading: ArchetypeDefaults['letterGrades'];
  promotionDefaults: ArchetypeDefaults['promotionDefaults'];
  examPattern: ArchetypeDefaults['examPattern'];
  boardExams: ArchetypeDefaults['boardExams'];
  primaryCurriculumRef: ArchetypeDefaults['primaryCurriculumRef'];
  complianceForms: ArchetypeDefaults['complianceForms'];
  bellPresets: BellSchedulePresetSet;
  activation: ArchetypeActivationConfig;
  schoolConfigDefaults: SchoolConfigDefaults;
  /** Ed-Fi descriptors this body's compliance submissions require (← ARCHETYPE_DEFAULTS_TABLE; GB0.2b). */
  complianceRequiredDescriptors: ArchetypeDefaults['complianceRequiredDescriptors'];
}

/**
 * GB0.3 stub for `schoolConfigDefaults` — replaced in GB1.2b by
 * `getDefaultConfigForArchetype(archetype)`. Until that lands, supply the known
 * school-week shape per body (PABSON runs a Sun–Fri week per the archetype
 * model; GENERIC a Mon–Fri week). This is the ONLY inlined value in the
 * aggregator, intentionally temporary, and NOT covered by the GB0.6 drift guard
 * (it has no source table yet).
 */
const SCHOOL_DAYS_STUB: Record<ActiveArchetype, readonly string[]> = {
  PABSON: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  GENERIC: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
};

/**
 * Compose the `GovernanceProfile` for a governance body (GB0.3).
 *
 * A pure view: it indexes the existing source constants and inlines nothing
 * domain-specific except the marked `schoolConfigDefaults` stub. Adding a new
 * governance body needs **zero edits here** — populate the source tables + the
 * enum and this function (and the conformance suite) light up automatically.
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
    schoolConfigDefaults: { schoolDays: [...SCHOOL_DAYS_STUB[archetype]] },
    complianceRequiredDescriptors: defaults.complianceRequiredDescriptors,
  };
}

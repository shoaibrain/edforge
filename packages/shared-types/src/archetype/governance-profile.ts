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
import type { RegionalSettings } from '../locale/tenant-locale-defaults';
import type { BellSchedulePresetSet } from './bell-schedule-presets';
import type { ArchetypeActivationConfig } from './activation-requirements';

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

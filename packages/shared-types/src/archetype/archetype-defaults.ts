/**
 * Archetype Defaults Data Table — Sprint 0.4 (V1 Master EPIC Breakdown)
 *
 * Per-archetype academic policy defaults read by:
 * - Sprint A.2 Course extension (curriculumRef)
 * - Sprint A.3 Exam entity (examPattern, examType from boardExams)
 * - Sprint D.1 GradingPolicy (gpaScale, letterGrades — incl. NG per v3.4.1 H2)
 * - Sprint D.3-D.6 ExternalAssessment family (boardExams definitions)
 * - Sprint E.1 Flash I/II reporting (complianceForms)
 *
 * **Adding a new archetype** = add one row below + extend
 * `ACTIVE_ARCHETYPES` in `locale/tenant-locale-defaults.ts`. NO service
 * code change required. Invariant 8: core archetype-neutral, edges
 * archetype-specific.
 *
 * **v3.4 research-resolved decisions baked in:**
 * - Letter grades include `NG` (Not Graded) with isTerminalFail=true (v3.4.1 H2)
 * - `complianceForms` lists only IEMIS_FLASH_I + IEMIS_FLASH_II — Forms 7/2/19
 *   are NOT modern CEHRD per v3.4 E.1.0 §7 research
 * - PABSON gradeLadder uses CEHRD bands incl. ECD/PPC/KG per pilot fixture
 * - BLE/SEE/NEB-12 carry `hasSupplementary=true` per D.4.0 §7.2 + D.6.5 research
 */

import type { ActiveArchetype } from '../locale/tenant-locale-defaults';
import type { ArchetypeDefaults } from '../schemas/archetype-defaults.schema';

// ============================================
// PABSON — Nepal private-school archetype
// ============================================
//
// Source-of-truth for: CDC NCF 2076 + PABSON (Private and Boarding
// Schools' Organisation Nepal) operational reality + CEHRD compliance
// reporting cadence + NEB/Municipality exam structure.
//
// References (research artifacts in docs/pilot-greenlight/):
// - a2-subject-vs-course-decision.md §1 (CDC curriculum structure)
// - d4-ble-design.md §4 + §6 (BLE 50/50 + letter grades + NG)
// - e1-flash-csv-schema.md §1 + §13 (CEHRD compliance cadence)

const PABSON: ArchetypeDefaults = {
  archetype: 'PABSON',
  schemaVersion: '1',

  gradeLadder: ['ECD', 'PPC', 'KG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],

  boardExams: [
    {
      examType: 'BLE',
      grade: 8,
      authority: 'municipality',
      internalWeight: 0.5,
      externalWeight: 0.5,
      passingThresholdPct: 35,
      hasSupplementary: true,
      maxNgForSupplementary: 3,
    },
    {
      examType: 'SEE',
      grade: 10,
      authority: 'NEB',
      internalWeight: 0.25,
      externalWeight: 0.75,
      passingThresholdPct: 35,
      hasSupplementary: true,
      maxNgForSupplementary: 2,
    },
    {
      examType: 'NEB_11',
      grade: 11,
      authority: 'NEB',
      internalWeight: 0.25,
      externalWeight: 0.75,
      passingThresholdPct: 35,
    },
    {
      examType: 'NEB_12',
      grade: 12,
      authority: 'NEB',
      internalWeight: 0.25,
      externalWeight: 0.75,
      passingThresholdPct: 35,
      hasSupplementary: true,
      maxNgForSupplementary: 2,
    },
  ],

  gpaScale: 4.0,

  // CEHRD letter-grade bands per CDC documentation + Sprint D.1
  // (v3.4.1 H2: NG must be enumerated as terminal-fail; without it the
  // BLE result-import path 4xx's on rows the municipality publishes
  // with NG.)
  letterGrades: [
    { letter: 'A+', minPct: 90, maxPct: 100, gpaPoints: 4.0, isPassing: true },
    { letter: 'A',  minPct: 80, maxPct: 89.99, gpaPoints: 3.6, isPassing: true },
    { letter: 'B+', minPct: 70, maxPct: 79.99, gpaPoints: 3.2, isPassing: true },
    { letter: 'B',  minPct: 60, maxPct: 69.99, gpaPoints: 2.8, isPassing: true },
    { letter: 'C+', minPct: 50, maxPct: 59.99, gpaPoints: 2.4, isPassing: true },
    { letter: 'C',  minPct: 40, maxPct: 49.99, gpaPoints: 2.0, isPassing: true },
    { letter: 'D+', minPct: 35, maxPct: 39.99, gpaPoints: 1.6, isPassing: true },
    { letter: 'D',  minPct: 20, maxPct: 34.99, gpaPoints: 1.2, isPassing: false },
    { letter: 'E',  minPct:  0, maxPct: 19.99, gpaPoints: 0.8, isPassing: false },
    {
      letter: 'NG',
      minPct: 0,
      maxPct: 0,
      gpaPoints: 0,
      isPassing: false,
      isTerminalFail: true,
      displayName: 'Not Graded',
    },
  ],

  examPattern: ['unit_test', 'terminal', 'send_up', 'pre_board', 'final'],

  primaryCurriculumRef: 'CDC_NCF_2076',

  // v3.4 E.1.0 §7: Forms 7/2/19 are NOT modern CEHRD; excluded from V1.
  complianceForms: ['IEMIS_FLASH_I', 'IEMIS_FLASH_II'],

  language: ['en-NP', 'ne-NP'],
  currency: 'NPR',
  calendarSystem: 'bikram_sambat',
  weekStart: 'sunday',
};

// ============================================
// GENERIC — non-Nepal fallback (Sprint F.2 synthetic smoke)
// ============================================
//
// Vanilla K-12 US-style profile. Sprint F.2 provisions a synthetic
// GENERIC tenant to prove the archetype-agnostic engine works without
// any PABSON-specific assumption leaking into core code.

const GENERIC: ArchetypeDefaults = {
  archetype: 'GENERIC',
  schemaVersion: '1',

  gradeLadder: [
    'K',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  ],

  boardExams: [],

  gpaScale: 4.0,

  letterGrades: [
    { letter: 'A', minPct: 90, maxPct: 100, gpaPoints: 4.0, isPassing: true },
    { letter: 'B', minPct: 80, maxPct: 89.99, gpaPoints: 3.0, isPassing: true },
    { letter: 'C', minPct: 70, maxPct: 79.99, gpaPoints: 2.0, isPassing: true },
    { letter: 'D', minPct: 60, maxPct: 69.99, gpaPoints: 1.0, isPassing: true },
    { letter: 'F', minPct:  0, maxPct: 59.99, gpaPoints: 0.0, isPassing: false },
  ],

  examPattern: ['unit_test', 'terminal', 'final'],

  primaryCurriculumRef: 'CCSS',

  complianceForms: [],

  language: ['en-US'],
  currency: 'USD',
  calendarSystem: 'gregorian',
  weekStart: 'monday',
};

// ============================================
// Lookup table
// ============================================

export const ARCHETYPE_DEFAULTS_TABLE: Record<ActiveArchetype, ArchetypeDefaults> = {
  PABSON,
  GENERIC,
};

/**
 * Resolve archetype defaults for an archetype string.
 *
 * @throws when archetype is unrecognized — fail-loud is correct here
 *   because EPIC-D entity creation must NOT silently substitute defaults
 *   from a different archetype. (Compare to activation-requirements'
 *   GENERIC-fallback behavior — different semantics: activation gates
 *   should be lax on misconfig, academic policy must NOT.)
 */
export function getArchetypeDefaults(archetype: string): ArchetypeDefaults {
  const key = archetype.toUpperCase() as ActiveArchetype;
  const found = ARCHETYPE_DEFAULTS_TABLE[key];
  if (!found) {
    throw new Error(`ARCHETYPE_NOT_FOUND: ${archetype}`);
  }
  return found;
}

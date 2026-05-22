/**
 * Archetype Defaults Schema — Sprint 0.4 (V1 Master EPIC Breakdown)
 *
 * Zod schema for the per-archetype academic-policy defaults that EPIC-D
 * sprints (D.1 GradingPolicy + D.2 PromotionRule + D.3 ExternalAssessment
 * family + D.4 BLE + D.5 SEE + D.6 NEB-11/12) read at tenant provisioning
 * time and use throughout EdForge's archetype-agnostic engine.
 *
 * **Invariant 8 anchor:** The service layer reads from this schema's
 * data tables (`packages/shared-types/src/archetype/archetype-defaults.ts`)
 * and never branches on `tenant.archetype === 'PABSON'`. Adding a new
 * archetype = add one row to the data table; no service code change.
 *
 * Aligns with:
 * - v1-master-epic-breakdown.md §0.3 (v3.4 research-resolved decisions)
 * - v3.4.1 H2: GradingPolicy MUST accept NG (Not Graded) as terminal letter-grade
 * - v3.4 E.1.0 §7: Forms 7/2/19 EXCLUDED (not modern CEHRD)
 * - Ed-Fi V6 alignment via Course/AcademicSubjectDescriptor pattern (A.2.0)
 */

import { z } from 'zod';
import { ACTIVE_ARCHETYPES } from '../locale/tenant-locale-defaults';

// ============================================
// Letter grade row (used by both GradingPolicy and archetype defaults)
// ============================================

/**
 * One letter-grade row in the per-archetype grading scale.
 *
 * **v3.4.1 H2 cross-cut:** PABSON profile must include `NG` (Not Graded)
 * with `isPassing=false, isTerminalFail=true, gpaPoints=0`. The BLE/SEE
 * external-exam result-import paths (D.4.6, D.5.4) write `NG` directly
 * when the external authority publishes it. Without `isTerminalFail`
 * the system can't distinguish `NG` (no in-term retake; requires
 * supplementary/Grade-Increment process) from `F` (allowed to retake
 * within term).
 */
export const archetypeLetterGradeSchema = z.object({
  letter: z.string().min(1).max(4),
  minPct: z.number().min(0).max(100),
  maxPct: z.number().min(0).max(100),
  gpaPoints: z.number().min(0).max(10),
  isPassing: z.boolean(),
  isTerminalFail: z.boolean().optional(),
  displayName: z.string().optional(),
});
export type ArchetypeLetterGrade = z.infer<typeof archetypeLetterGradeSchema>;

// ============================================
// Board exam definition (BLE, SEE, NEB-11/12 etc.)
// ============================================

/**
 * One row in `boardExams[]`. Captures the structural shape of a national
 * /municipal external exam: at which grade it sits, which authority owns
 * it, and the 50/50 vs 25/75 weight split between internal CAS and
 * external written sections.
 *
 * Sprint D.3 ExternalAssessment family entities (D.3.1, D.3.4) reference
 * these rows via `examType` lookup.
 */
export const boardExamDefinitionSchema = z.object({
  examType: z.string().min(1).max(40),         // e.g. 'BLE', 'SEE', 'NEB_11', 'NEB_12'
  grade: z.union([z.number().int().min(1).max(12), z.string()]),
  authority: z.string().min(1).max(40),        // e.g. 'municipality', 'NEB'
  internalWeight: z.number().min(0).max(1),    // CAS fraction of total
  externalWeight: z.number().min(0).max(1),    // External-written fraction
  passingThresholdPct: z.number().min(0).max(100).optional(),
  hasSupplementary: z.boolean().optional(),    // BLE/SEE/NEB-12 Grade Increment exam
  maxNgForSupplementary: z.number().int().min(0).max(20).optional(),
}).refine(
  (e) => Math.abs(e.internalWeight + e.externalWeight - 1) < 0.001,
  { message: 'internalWeight + externalWeight must sum to 1.0' },
);
export type BoardExamDefinition = z.infer<typeof boardExamDefinitionSchema>;

// ============================================
// Exam pattern (term-level cadence)
// ============================================

/**
 * Term-level exam cadence used by Sprint A.3 Exam entity's `examType`
 * field. PABSON adds `pre_board` (mock exam before SEE/NEB).
 */
export const examPatternKeySchema = z.enum([
  'unit_test',
  'terminal',
  'send_up',
  'pre_board',
  'final',
  'monthly_test',
]);
export type ExamPatternKey = z.infer<typeof examPatternKeySchema>;

// ============================================
// Compliance form key (Sprint E.1 reporting)
// ============================================

/**
 * Per-archetype required compliance submissions. Sprint E.1 reads from
 * here to render the operator's compliance dashboard.
 *
 * **v3.4 E.1.0 §7 finding:** Forms 7/2/19 are NOT in modern CEHRD
 * public sources (likely legacy district-era). PABSON profile's
 * `complianceForms` lists only `IEMIS_FLASH_I` + `IEMIS_FLASH_II`.
 */
export const complianceFormKeySchema = z.string().regex(
  /^[A-Z][A-Z0-9_]+$/,
  'Compliance form key must be SCREAMING_SNAKE_CASE',
);

// ============================================
// Curriculum reference (A.2.0 Course extension)
// ============================================

/**
 * Curriculum-reference enum for Sprint A.2 Course extension. Two-track
 * support (CDC + Cambridge IGCSE) via parallel Course rows sharing the
 * same `academicSubject` descriptor but different `curriculumRef`.
 */
export const curriculumRefSchema = z.enum([
  'CDC_NCF_2076',
  'CAMBRIDGE_IGCSE',
  'IB_MYP',
  'TEKS',
  'CCSS',
]);
export type CurriculumRef = z.infer<typeof curriculumRefSchema>;

// ============================================
// ArchetypeDefaults — top-level schema
// ============================================

/**
 * Per-archetype defaults aggregating every academic-policy knob that
 * EPIC-D sprints depend on.
 *
 * **Lookup path:** `ARCHETYPE_DEFAULTS[archetype]` returns this shape.
 * Service layer calls `archetypeDefaultsService.getDefaults(archetype)`
 * which wraps the lookup with cache + not-found semantics.
 *
 * **Adding a new archetype** = add one row to the data table at
 * `packages/shared-types/src/archetype/archetype-defaults.ts`. No
 * service code change. Invariant 8.
 */
export const archetypeDefaultsSchema = z.object({
  archetype: z.enum(ACTIVE_ARCHETYPES),
  schemaVersion: z.literal('1'),

  // Grade structure
  gradeLadder: z.array(z.string()).min(1),

  // Board / external exams (Sprint D.3-D.6)
  boardExams: z.array(boardExamDefinitionSchema),

  // GradingPolicy defaults (Sprint D.1)
  gpaScale: z.number().min(2).max(10),
  letterGrades: z.array(archetypeLetterGradeSchema).min(1),

  // Term-level exam cadence (Sprint A.3)
  examPattern: z.array(examPatternKeySchema).min(1),

  // Curriculum framework (Sprint A.2)
  primaryCurriculumRef: curriculumRefSchema,

  // Compliance reporting (Sprint E.1)
  complianceForms: z.array(complianceFormKeySchema),

  // Locale (overlaps with locale/tenant-locale-defaults.ts — duplicated
  // here so archetype-defaults is self-contained for callers who only
  // import this one module. The two tables are kept in sync by
  // workspace-settings.entity.spec.ts in identity.)
  language: z.array(z.string().min(2).max(10)).min(1),
  currency: z.string().min(3).max(3),
  calendarSystem: z.enum(['gregorian', 'bikram_sambat', 'hijri']),
  weekStart: z.enum(['sunday', 'monday']),

  // Optional descriptive fields for AdminWeb UI / school setup
  defaultMission: z.string().optional(),
  defaultExamRulesText: z.string().optional(),
});

export type ArchetypeDefaults = z.infer<typeof archetypeDefaultsSchema>;

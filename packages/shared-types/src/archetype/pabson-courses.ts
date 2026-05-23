/**
 * PABSON Course Catalog — Sprint A.2.4
 *
 * Best-guess seed of CDC NCF 2076 courses spanning Saraswati's V1 grade
 * band (Grades 4-10). Used by the A.2.5 backfill script to instantiate
 * Course rows on PABSON dev-tenant schools that lack a course catalog.
 *
 * **Architecture: Edge layer (per `a2-sprint-plan.md` §1.5).**
 *   - This catalog is **archetype-scoped** (PABSON only). Lives under
 *     `archetype/`, not `descriptors/` or `schemas/academics/`.
 *   - Each template instantiates into a Core `Course` row via the
 *     backfill script — same Core entity shape every archetype produces.
 *   - The `academicSubject` + `curriculumRef` + `subjectArea` fields on
 *     each template are Core descriptors; the *selection* of which
 *     descriptors PABSON uses (and the canonical names like
 *     "C. Mathematics") is the Edge concern.
 *
 * **Scope (V1):**
 *   - Grades 4-10 only.
 *   - Grades 1-3 (integrated/thematic, CDC NCF 2076 §1.1) → V1.5 via
 *     Ed-Fi `LearningStandardGrade`.
 *   - Grades 11-12 (NEB stream electives) → Sprint D.6 / V1.5.
 *
 * **`stateSubjectCode` left undefined** — V1 best-guess scope per CEO
 * direction. Operators populate authoritative CDC codes when source
 * doc is in hand. Field is `stateSubjectCode?` (optional in schema).
 *
 * **Naming convention:** template `code` is `NCF-<SUBJ>-G<grade-band>`.
 *   - `NCF` namespace = CDC NCF 2076 curriculum
 *   - `<SUBJ>` = short subject mnemonic (ENG, NEP, MATH, SCI, SOC,
 *      EPH, HPE, OCS, OPMATH)
 *   - `G<band>` = grade band (G45, G68, G910)
 * Backfill script may rename per-school if needed (operator-visible).
 *
 * **Iteration policy:** values here are seed defaults. Operators or
 * post-V1 sprints can update names + add `stateSubjectCode` values
 * without breaking the shape. Adding new templates = additive minor
 * bump. Removing templates = breaking change, requires migration.
 *
 * **Sources:**
 *   - A.2.0 research §1.1, §1.2 (CDC subject structure + canonical lists)
 *   - A.2.0 research §4.1 (PABSON naming: "C. Mathematics", "EPH")
 *   - Master plan §0.3 (15-value AcademicSubjectDescriptor enum)
 *
 * @see docs/pilot-greenlight/a2-subject-vs-course-decision.md
 * @see docs/pilot-greenlight/a2-sprint-plan.md §4 A.2.4
 */

import type { AcademicSubjectDescriptor } from '../descriptors/academic-subject';
import type { CurriculumRef } from '../schemas/archetype-defaults.schema';

/**
 * Shape of a single PABSON Course catalog template.
 *
 * The backfill script (A.2.5) reads templates from `PABSON_COURSE_CATALOG`
 * and synthesises full `Course` rows by adding per-school identifiers
 * (`courseId`, `tenantId`, `schoolId`) + Course-entity required fields
 * (`credits`, `subjectArea`, `courseType`, `prerequisites`, etc.) that
 * are not catalog-level concerns.
 */
export interface PabsonCourseTemplate {
  /** Template code, namespaced `NCF-<SUBJ>-G<band>`. Unique within catalog. */
  code: string;
  /** Operator-facing display name; PABSON-canonical (e.g. "C. Mathematics"). */
  name: string;
  /** Grade levels this course spans. CDC subject is grade-banded. */
  gradeLevels: ReadonlyArray<string>;
  /** Curriculum-specific subject identity (Core descriptor, A.2.1). */
  academicSubject: AcademicSubjectDescriptor;
  /** CDC/NEB subject code; V1 left undefined (best-guess scope). */
  stateSubjectCode?: string;
  /** Curriculum reference (Core descriptor); constant `CDC_NCF_2076` for PABSON V1. */
  curriculumRef: CurriculumRef;
  /** Required across all PABSON schools (CDC mandate). Drives operator UI defaults. */
  isCompulsory: boolean;
  /** Counts toward SEE-prep / BLE core; false for SEE-elective optional courses. */
  isCore: boolean;
}

/**
 * Best-guess CDC NCF 2076 catalog for PABSON V1.
 *
 * 21 templates covering Grades 4-10. Iterate as authoritative CDC
 * source doc surfaces; this is the seed, not the final state.
 */
export const PABSON_COURSE_CATALOG: ReadonlyArray<PabsonCourseTemplate> = [
  // ---------- Grades 4-5 (Basic Level, Subject-Based) — 6 compulsory ----------
  {
    code: 'NCF-ENG-G45',
    name: 'English',
    gradeLevels: ['4', '5'],
    academicSubject: 'english',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-NEP-G45',
    name: 'Nepali',
    gradeLevels: ['4', '5'],
    academicSubject: 'nepali',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-MATH-G45',
    name: 'Mathematics',
    gradeLevels: ['4', '5'],
    academicSubject: 'mathematics',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-SCI-G45',
    name: 'Science',
    gradeLevels: ['4', '5'],
    academicSubject: 'science',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-SOC-G45',
    name: 'Social Studies',
    gradeLevels: ['4', '5'],
    academicSubject: 'social_studies',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-EPH-G45',
    name: 'Environment, Population & Health',
    gradeLevels: ['4', '5'],
    academicSubject: 'environment_population_health',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },

  // ---------- Grades 6-8 (Basic Level → BLE) — 6 compulsory + 1 optional ----------
  {
    code: 'NCF-ENG-G68',
    name: 'English',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'english',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-NEP-G68',
    name: 'Nepali',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'nepali',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-MATH-G68',
    name: 'C. Mathematics',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'mathematics',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-SCI-G68',
    name: 'Science',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'science',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-SOC-G68',
    name: 'Social Studies',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'social_studies',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-EPH-G68',
    name: 'EPH',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'environment_population_health',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-OCS-G68',
    name: 'Opt. Computer Science',
    gradeLevels: ['6', '7', '8'],
    academicSubject: 'optional_computer_science',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: false,
    isCore: false,
  },

  // ---------- Grades 9-10 (Secondary Level → SEE) — 6 compulsory + 2 optional ----------
  {
    code: 'NCF-ENG-G910',
    name: 'C. English',
    gradeLevels: ['9', '10'],
    academicSubject: 'english',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-NEP-G910',
    name: 'C. Nepali',
    gradeLevels: ['9', '10'],
    academicSubject: 'nepali',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-MATH-G910',
    name: 'C. Mathematics',
    gradeLevels: ['9', '10'],
    academicSubject: 'mathematics',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-SCI-G910',
    name: 'Science',
    gradeLevels: ['9', '10'],
    academicSubject: 'science',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-SOC-G910',
    name: 'Social Studies',
    gradeLevels: ['9', '10'],
    academicSubject: 'social_studies',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-HPE-G910',
    name: 'Health, Physical & Creative Arts',
    gradeLevels: ['9', '10'],
    academicSubject: 'health_physical_creative_arts',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: true,
    isCore: true,
  },
  {
    code: 'NCF-OPMATH-G910',
    name: 'Opt. Mathematics',
    gradeLevels: ['9', '10'],
    academicSubject: 'optional_mathematics',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: false,
    isCore: false,
  },
  {
    code: 'NCF-OCS-G910',
    name: 'Opt. Computer Science',
    gradeLevels: ['9', '10'],
    academicSubject: 'optional_computer_science',
    curriculumRef: 'CDC_NCF_2076',
    isCompulsory: false,
    isCore: false,
  },
];

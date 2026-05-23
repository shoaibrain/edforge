/**
 * AcademicSubjectDescriptor — Sprint A.2 Course extension
 *
 * Curriculum-specific subject identity attached to Course rows. Aligned
 * with Ed-Fi V6 conceptually (subject as descriptor on Course, not a
 * separate Subject entity) but extended with Nepal-archetype-relevant
 * subjects that the strict Ed-Fi V6 `AcademicSubjectDescriptor` does
 * not enumerate (e.g. Nepali, EPH, Optional Mathematics).
 *
 * **Relationship to existing `courseSubjectAreaSchema`** (in
 * `schemas/academics/course.schema.ts`): these are DISTINCT fields
 * serving different roles. Not duplicates.
 *
 *   - `subjectArea` (existing) = Ed-Fi V6 Core rollup, coarse-grained.
 *      Used for dashboard grouping + federal interop.
 *      Values: `mathematics | english_language_arts | science | …`
 *
 *   - `academicSubject` (this enum) = curriculum-specific subject
 *      identity, granular. Used for exam mark entry, CDC tracking,
 *      NEB code mapping, BLE/SEE result-import.
 *      Values per master plan §0.3 + A.2.0 research §1.
 *
 * **Architecture: Core + Edges (per `a2-sprint-plan.md` §1.5).**
 *   - This enum is **Core** — archetype-blind, Ed-Fi V6 aligned in
 *     concept. Pure data; no archetype branching depends on it.
 *   - The `curriculumRef` discriminator (in `archetype-defaults.schema.ts`)
 *     is the *edge marker* that pairs with this descriptor to model
 *     archetype multiplicity: two Course rows can share
 *     `academicSubject:'mathematics'` but differ on
 *     `curriculumRef:'CDC_NCF_2076' | 'CAMBRIDGE_IGCSE'`.
 *
 * @see docs/pilot-greenlight/a2-sprint-plan.md §1.5
 * @see docs/pilot-greenlight/a2-subject-vs-course-decision.md §2 (Ed-Fi V6 model)
 */

import { z } from 'zod';

/**
 * Curriculum-specific academic-subject descriptor.
 *
 * V1 enum covers the subjects taught in Nepal CDC NCF 2076 (Grades 4-10
 * SEE-prep), with Cambridge IGCSE / IB MYP parallel tracks supported via
 * the `curriculumRef` discriminator on the Course row.
 *
 * **Extension policy (post-V1):** new values land via shared-types minor
 * version bumps; existing Course rows are not migrated (additive only).
 *
 * **Value semantics:**
 *   - `mathematics` — general math; CDC "C. Mathematics" + Cambridge Core/Extended Math + US Algebra all map here
 *   - `science` — general/integrated science (Grade-band 4-8); for Grade 11-12 NEB use `physics`/`chemistry`/`biology`
 *   - `english` — English (any curriculum); maps to Ed-Fi rollup `english_language_arts`
 *   - `nepali` — Nepali language; maps to Ed-Fi rollup `world_languages`
 *   - `social_studies` — Social Studies; both compulsory (CDC G4-10) and Grade 11-12 elective forms
 *   - `environment_population_health` — CDC EPH (compulsory G4-8)
 *   - `health_physical_creative_arts` — CDC G9-10 Health/Physical/Creative Arts compulsory
 *   - `local_subject` — region-specific subject (e.g. local language, regional studies)
 *   - `optional_mathematics` — CDC SEE-prep optional Math (G9-10)
 *   - `optional_computer_science` — CDC optional Computer Science (G6-10)
 *   - `optional_economics` — Grade 11-12 elective (NEB)
 *   - `accounting` — Grade 11-12 commerce-stream elective
 *   - `physics` / `chemistry` / `biology` — Grade 11-12 NEB science-stream electives
 */
export const academicSubjectSchema = z.enum([
  'mathematics',
  'science',
  'english',
  'nepali',
  'social_studies',
  'environment_population_health',
  'health_physical_creative_arts',
  'local_subject',
  'optional_mathematics',
  'optional_computer_science',
  'optional_economics',
  'accounting',
  'physics',
  'chemistry',
  'biology',
]);

export type AcademicSubjectDescriptor = z.infer<typeof academicSubjectSchema>;

/**
 * Ordered tuple of all valid descriptor values. Useful for spec coverage
 * + UI-side enumeration without re-importing the Zod schema.
 */
export const ACADEMIC_SUBJECT_DESCRIPTORS = academicSubjectSchema.options;

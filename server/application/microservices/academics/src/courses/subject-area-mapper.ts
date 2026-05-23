/**
 * Subject-Area Mapper — Sprint A.2.3
 *
 * Pure-function mapping table from the Sprint A.2.1 granular
 * `AcademicSubjectDescriptor` (curriculum-specific subject identity)
 * down to the existing coarse `SubjectArea` enum (Ed-Fi V6 rollup).
 *
 * **One-way semantics.** Granular → coarse is total + deterministic.
 * The reverse (coarse → granular) is ambiguous (e.g. `world_languages`
 * could be `english` or `nepali`), and is intentionally NOT provided
 * here. Backfill scripts that need to populate `academicSubject` on
 * legacy `subjectArea`-only rows must disambiguate via additional
 * signals (e.g. school country + grade level + course name keywords).
 *
 * **Why this exists despite `subjectArea` being required at the API:**
 *   - A.2.5 backfill instantiates Course rows from the PABSON catalog
 *     (which carries `academicSubject` natively); the backfill uses
 *     this mapper to fill `subjectArea` from the catalog's descriptor.
 *   - Future V1.5 path: if `subjectArea` becomes optional at the API,
 *     the service-layer `createCourse` would auto-derive via this map.
 *   - Documented mapping = catches drift when new descriptor values
 *     land (spec coverage forces a code edit).
 *
 * **Architecture: Core layer (per `a2-sprint-plan.md` §1.5).** This
 * mapper is archetype-blind. PABSON-specific seed data lives in
 * `packages/shared-types/src/archetype/pabson-courses.ts`.
 *
 * **Mapping rationale:**
 *   - `english` → `english_language_arts` (closest Ed-Fi V6 rollup)
 *   - `nepali` → `world_languages` (per Ed-Fi V6 categorization of
 *      non-English languages)
 *   - `environment_population_health`, `health_physical_creative_arts`
 *      → `physical_education` (Ed-Fi V6 lumps Health under PE)
 *   - `local_subject` → `other` (no curriculum-neutral parent)
 *   - `optional_*` → mapped to the parent discipline:
 *     `optional_mathematics` → `mathematics`, etc.
 *   - `accounting` → `business`
 *   - `physics`/`chemistry`/`biology` → `science` (Ed-Fi V6 rolls
 *      individual sciences under the generic "Science" descriptor)
 */

import type {
  AcademicSubjectDescriptor,
} from '@aibrains/shared-types';
import type { SubjectArea } from '../common/entities/course.entity';

/**
 * Total mapping from granular curriculum-specific subject identity
 * (Sprint A.2.1) to Ed-Fi V6 coarse rollup. All 15 descriptor values
 * are covered; absence of a key is a TS compile error (Record type).
 */
export const ACADEMIC_SUBJECT_TO_SUBJECT_AREA: Record<
  AcademicSubjectDescriptor,
  SubjectArea
> = {
  mathematics: 'mathematics',
  science: 'science',
  english: 'english_language_arts',
  nepali: 'world_languages',
  social_studies: 'social_studies',
  environment_population_health: 'physical_education',
  health_physical_creative_arts: 'physical_education',
  local_subject: 'other',
  optional_mathematics: 'mathematics',
  optional_computer_science: 'technology',
  optional_economics: 'business',
  accounting: 'business',
  physics: 'science',
  chemistry: 'science',
  biology: 'science',
};

/**
 * Pure function: granular → coarse subject-area mapping.
 *
 * @param descriptor — A.2.1 AcademicSubjectDescriptor (curriculum-specific)
 * @returns The Ed-Fi V6 SubjectArea rollup value
 *
 * @example
 *   deriveSubjectAreaFromAcademicSubject('mathematics')  // → 'mathematics'
 *   deriveSubjectAreaFromAcademicSubject('nepali')       // → 'world_languages'
 *   deriveSubjectAreaFromAcademicSubject('accounting')   // → 'business'
 */
export function deriveSubjectAreaFromAcademicSubject(
  descriptor: AcademicSubjectDescriptor,
): SubjectArea {
  return ACADEMIC_SUBJECT_TO_SUBJECT_AREA[descriptor];
}

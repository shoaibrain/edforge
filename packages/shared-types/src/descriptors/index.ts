/**
 * Descriptors — Ed-Fi V6 aligned + archetype-extended descriptors used
 * by Core domain entities. Barrel export for Sprint A.2.1 onwards.
 *
 * **Architecture: Core layer.** Descriptors here are archetype-blind:
 * the same value list applies to every tenant, every archetype. Edge
 * data (catalogs, seeds) that *consumes* descriptors lives under
 * `packages/shared-types/src/archetype/`.
 *
 * @see docs/pilot-greenlight/a2-sprint-plan.md §1.5
 */

export {
  academicSubjectSchema,
  ACADEMIC_SUBJECT_DESCRIPTORS,
  type AcademicSubjectDescriptor,
} from './academic-subject';

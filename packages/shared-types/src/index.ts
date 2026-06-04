/**
 * @aibrains/shared-types
 * 
 * Shared Zod schemas, TypeScript types, and validators for EdForge monorepo.
 * 
 * This package is the SINGLE SOURCE OF TRUTH for data validation and types
 * used by both frontend and backend.
 * 
 * ## Usage
 * 
 * ```typescript
 * // Import schemas for validation
 * import { 
 *   updateUserSchema, 
 *   passwordSchema,
 *   loginSchema 
 * } from '@aibrains/shared-types';
 * 
 * // Import inferred types
 * import type { 
 *   UpdateUserDto,
 *   LoginDto,
 *   UserResponseDto 
 * } from '@aibrains/shared-types';
 * 
 * // Validate data
 * const result = updateUserSchema.safeParse(userData);
 * if (!result.success) {
 *   console.log(result.error.flatten());
 * }
 * ```
 * 
 * ## Backend (NestJS) Usage
 * 
 * ```typescript
 * import { createZodDto } from 'nestjs-zod';
 * import { updateUserSchema } from '@aibrains/shared-types';
 * 
 * class UpdateUserDtoClass extends createZodDto(updateUserSchema) {}
 * ```
 */

// Re-export Zod for convenience
export { z } from 'zod';
export type { ZodSchema, ZodType, ZodError } from 'zod';

// ============================================
// Validators
// ============================================

export * from './validators';

// ============================================
// All Schemas and Types
// ============================================

export * from './schemas';

// ============================================
// Ed-Fi Mappers (for compliance export)
// ============================================

export * from './mappers';

// ============================================
// Utility Functions
// ============================================

export { formatCurrency, formatNPR } from './utils/currency';
export type { CurrencyFormatOpts } from './utils/currency';
export * from './utils/bikram-sambat';
export * from './utils/date-format';
export * from './utils/school-hours';
export * from './utils/session-gap-detector';

// ============================================
// Domain Event Taxonomy (Sprint C0.c.2)
// ============================================
// Zod schemas + registry for the V1 domain event types. See
// docs/pilot-greenlight/event-infrastructure.md and
// docs/pilot-greenlight/sprint-plan.md §C0.c for the architecture.

export * from './events';

// ============================================
// Tenant Locale Defaults
// ============================================
// Canonical home of country + archetype regional constants. The prior
// workspace-only package `@edforge/tenant-locale-defaults` was retired in
// 0.27.0 after its non-publishable nature silently broke AdminWeb's
// CodeBuild rebuild — see docs/MIDNIGHT_LOCKIN_IMPLEMENTATION_REVIEW.md.
//
// Explicit named re-export to avoid collisions with other shared-types
// members that have the SAME NAME but DIFFERENT SHAPE:
//   - `CalendarSystem`, `TimeFormat`, `Archetype`, `ActiveArchetype` are
//     already published via schemas/identity (Zod-derived; structurally
//     identical). Locale's own declarations are omitted from the barrel
//     but remain accessible via the subpath `'./locale/tenant-locale-defaults'`.
//   - `COUNTRY_OPTIONS` collides with a stripped `{value,label}` version in
//     `identity/country-config.ts`. The locale version is the rich one with
//     `.info` (used by AdminWeb tenant-create dropdown); it's re-exported
//     as `TENANT_COUNTRY_OPTIONS` to disambiguate.
export type {
  DateFormat,
  WeekStartsOn,
  NumberFormat,
  RegionalSettings,
  CountryCode,
  CountryOption,
  ArchetypeOption,
} from './locale/tenant-locale-defaults';
export {
  COUNTRY_DEFAULTS,
  FALLBACK_DEFAULTS,
  resolveRegionalDefaults,
  ACTIVE_ARCHETYPES,
  ARCHETYPE_DEFAULTS,
  resolveArchetypeDefaults,
  isActiveArchetype,
  ARCHETYPE_OPTIONS,
  // Rename: richer version (with `info` field) used by AdminWeb tenant form.
  COUNTRY_OPTIONS as TENANT_COUNTRY_OPTIONS,
} from './locale/tenant-locale-defaults';

// ============================================
// Archetype activation requirements (Sprint S0.6)
// ============================================
// Data-driven gate for school setup → active transitions. Replaces the
// prior single-rule "must have ≥1 academic year" check. See
// docs/edforge-pabson-sprint-plan.md Part B / invariant 8.
export type {
  ActivationRequirementKey,
  ActivationRequirementSpec,
  ArchetypeActivationConfig,
  ActivationRequirementCheck,
  ActivationRequirementsResponse,
} from './archetype/activation-requirements';
export {
  ARCHETYPE_ACTIVATION_REQUIREMENTS,
  getActivationRequirements,
} from './archetype/activation-requirements';

// ============================================
// External reporting templates (Sprint E.1.2 — V1 Master EPIC Breakdown)
// ============================================
// CEHRD IEMIS Flash I + II column-mapping descriptors. Runtime template
// configs live in S3 (Lambda hot-reads at invocation). TS exports here
// lock the schema-version + column dimensions for type safety.
export * from './external-reporting';

// ============================================
// Descriptors — Core Ed-Fi V6 aligned (Sprint A.2.1)
// ============================================
// Archetype-blind descriptor enums attached to Core entities. The
// `AcademicSubjectDescriptor` here is the curriculum-specific subject
// identity (distinct from the coarser `courseSubjectAreaSchema` Ed-Fi
// V6 rollup also exported from this package). See
// docs/pilot-greenlight/a2-sprint-plan.md §1.5 for the Core/Edges
// architecture principle that governs descriptor placement.
export * from './descriptors';

// ============================================
// Archetype defaults (Sprint 0.4 — V1 Master EPIC Breakdown)
// ============================================
// Per-archetype academic policy defaults: gradeLadder, boardExams,
// gpaScale, letterGrades (incl. NG per v3.4.1 H2), examPattern,
// primaryCurriculumRef, complianceForms. Read by EPIC-D entities
// (D.1 GradingPolicy + D.2 PromotionRule + D.3-D.6 ExternalAssessment).
// Adding a new archetype = one row in the data table, zero service code
// change. Invariant 8.
export type {
  ArchetypeDefaults,
  ArchetypeLetterGrade,
  BoardExamDefinition,
  ExamPatternKey,
  CurriculumRef,
  PromotionDefaults,
} from './schemas/archetype-defaults.schema';
export {
  archetypeDefaultsSchema,
  archetypeLetterGradeSchema,
  boardExamDefinitionSchema,
  examPatternKeySchema,
  curriculumRefSchema,
  complianceFormKeySchema,
  promotionDefaultsSchema,
} from './schemas/archetype-defaults.schema';
export {
  ARCHETYPE_DEFAULTS_TABLE,
  getArchetypeDefaults,
} from './archetype/archetype-defaults';

// ============================================
// Governance-body profile aggregator (Sprint GB0)
// ============================================
// One per-governance-body view that composes the tables above + bell presets
// + activation + school-config defaults + required descriptors. Types only in
// GB0.2; `getGovernanceProfile` (GB0.3) is the runtime composer. See RFC 0001.
export type {
  GovernanceProfile,
  SchoolConfigDefaults,
} from './archetype/governance-profile';
export { getGovernanceProfile } from './archetype/governance-profile';

// ============================================
// PABSON Course catalog seed (Sprint A.2.4)
// ============================================
// Best-guess CDC NCF 2076 Course templates for Grades 4-10. Edge data
// consumed by the A.2.5 backfill script + (post-V1) any seed-from-
// archetype endpoint. PABSON-archetype-scoped; Core Course entity is
// archetype-blind. Iterate as authoritative CDC source doc surfaces.
export type { PabsonCourseTemplate } from './archetype/pabson-courses';
export { PABSON_COURSE_CATALOG } from './archetype/pabson-courses';

// ============================================
// Archetype holiday seed registry (Sprint C3.2)
// ============================================
// Per-(archetype, region, year) curated holiday lists. Operators
// retrieve via GET /holiday-seeds and pipe into generate-calendar.
// Fallback ladder: archetype-exact → country-generic → none.
export type {
  HolidaySeed,
  HolidaySeedBlock,
  HolidaySeedSingleDay,
  HolidaySeedCategory,
  HolidaySeedSource,
  ResolvedHolidaySeed,
} from './locale/holiday-seeds';
export {
  HOLIDAY_SEEDS,
  resolveHolidaySeed,
  listHolidaySeedKeys,
} from './locale/holiday-seeds';

// ============================================
// Archetype bell-schedule presets (Sprint C3.4 + C3.5)
// ============================================
// Per-archetype canonical academic + exam-day shifts that the operator
// can apply via POST /schools/:id/bell-schedules/preset. Presets are
// data, not code — adding a new archetype requires only a new entry in
// ARCHETYPE_BELL_PRESETS, no service-side branching.
export type {
  BellSchedulePresetType,
  BellSchedulePreset,
  BellSchedulePresetPeriod,
  BellSchedulePresetSet,
} from './archetype/bell-schedule-presets';
export {
  ARCHETYPE_BELL_PRESETS,
  resolveBellSchedulePreset,
  computeInstructionalMinutes,
} from './archetype/bell-schedule-presets';

// ============================================
// Nepal administrative divisions (Sprint A.4)
// ============================================
// CEHRD-canonical reference data for the post-2017 federal structure:
// 7 provinces × 77 districts × 4 municipality types. Single source of
// truth used by both inbound (xlsx import, Sprint D/E) and outbound
// (Flash I/II export, Sprint I/K/L) paths to prevent district-naming
// drift across the round-trip. Used at render time by the
// AddressFieldsNepal component (Sprint A.8).
export type {
  NepalProvinceCode,
  NepalProvince,
  NepalDistrict,
  NepalMunicipalityType,
} from './locale/nepal-administrative-divisions';
export {
  NEPAL_ADMIN_DIVISIONS_CATALOG_VERSION,
  NEPAL_PROVINCES,
  NEPAL_DISTRICTS,
  NEPAL_MUNICIPALITY_TYPES,
  findNepalProvince,
  findNepalDistrict,
  nepalDistrictsForProvince,
} from './locale/nepal-administrative-divisions';

// ============================================
// Phone format (Sprint A.5)
// ============================================
// Archetype-aware phone-format helper for the <PhoneInput> shared component
// (Sprint A.11). Returns dial code + validation regex + UI placeholder per
// archetype/country pairing. Orthogonal to phoneSchema (E.164, broad) — UI
// validation is tighter, backend stays permissive.
export type { PhoneFormat } from './locale/phone-format';
export {
  phoneFormatForArchetype,
  isValidPhoneForArchetype,
  stripPhoneToLocalDigits,
} from './locale/phone-format';

// ============================================
// IEMIS — Nepal CEHRD integration primitives (Sprint 1+)
// ============================================

export {
  iemisSchoolCodeSchema,
  iemisStudentIdSchema,
  iemisStaffIdSchema,
  isValidIemisSchoolCode,
  isValidIemisStudentId,
  isValidIemisStaffId,
  IEMIS_SCHOOL_CODE_REGEX,
  IEMIS_STUDENT_ID_REGEX,
  IEMIS_STAFF_ID_REGEX,
} from './identity/iemis-codes';
export type { IemisSchoolCode, IemisStudentId, IemisStaffId } from './identity/iemis-codes';

export {
  IemisPermission,
  TENANT_ADMIN_IEMIS_PERMISSIONS,
  PLATFORM_OPERATOR_IEMIS_PERMISSIONS,
  isIemisPermission,
} from './identity/iemis-permissions';

// ============================================
// Ed-Fi descriptor catalog + resolver (Sprint 2)
// ============================================

export * from './ed-fi/descriptors';

// ============================================
// Events
// ============================================

export * from './events/enrollment-billing.events';
export * from './events/iemis-audit.events';

// ============================================
// Legacy Common Types (for backwards compatibility)
// ============================================

// These are now re-exported from schemas/common.ts
// Keeping explicit exports here for any code that imports directly
export type { 
  BaseEntity,
  RequestContext,
  Address,
  EntityStatus,
  PaginationQuery,
  ErrorResponse,
} from './schemas/common';

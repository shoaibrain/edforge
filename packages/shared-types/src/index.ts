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

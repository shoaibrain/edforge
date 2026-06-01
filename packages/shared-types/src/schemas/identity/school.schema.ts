/**
 * School Schemas - Identity Service
 * 
 * Zod schemas for school management DTOs.
 */

import { z } from 'zod';
import { emailSchema, urlSchema, phoneSchema, isoDateSchema, createPaginatedResponseSchema } from '../common';
import {
  schoolCategoryDescriptorSchema,
  schoolTypeDescriptorSchema,
  schoolGradeLevelDescriptorSchema,
  charterStatusDescriptorSchema,
  administrativeFundingControlDescriptorSchema,
} from './education-org-descriptors';
import {
  educationOrgIdentificationCodeSchema,
  institutionTelephoneSchema,
  accountabilityRatingSchema,
} from './education-organization.schema';
import { getGradeIndex, isValidGradeRange, ORDERED_GRADES, validateSchoolTypeGradeRange } from './grade-levels';
import { iemisSchoolCodeSchema } from '../../identity/iemis-codes';
// Sprint C.0.5 — optional PDF-rendering metadata sub-document. Independent
// from the flat `logoUrl` field; PDF render endpoints in C.1+ prefer
// `branding.logoS3Key` and fall back to `logoUrl`.
import { schoolBrandingSchema } from './school-branding.schema';

// ============================================
// Enums
// ============================================

export const schoolTypeSchema = z.enum([
  'elementary',
  'middle',
  'high',
  'k12',
  'charter',
  'private',
  'vocational',
  'special_education',
]);
export type SchoolType = z.infer<typeof schoolTypeSchema>;

export const schoolStatusSchema = z.enum([
  'active',
  'inactive',
  'setup',
  'suspended',
  'closed',
]);
export type SchoolStatus = z.infer<typeof schoolStatusSchema>;

export const academicCalendarTypeSchema = z.enum(['semester', 'quarter', 'trimester', 'annual']);
export type AcademicCalendarType = z.infer<typeof academicCalendarTypeSchema>;

export const calendarSystemSchema = z.enum(['gregorian', 'bikram_sambat']);
export type CalendarSystemType = z.infer<typeof calendarSystemSchema>;

// ============================================
// Contact Info Schema
// ============================================

export const schoolContactInfoSchema = z.object({
  primaryEmail: emailSchema,
  primaryPhone: z.string().min(7).max(20),
  secondaryPhone: z.string().min(7).max(20).optional(),
  website: urlSchema.optional(),
  fax: z.string().max(20).optional(),
  schoolEmail: emailSchema.optional(),
});

export type SchoolContactInfoDto = z.infer<typeof schoolContactInfoSchema>;

// ============================================
// School Grade Range Schema (e.g., K-5, 6-8)
// ============================================

export const schoolGradeRangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

export type SchoolGradeRangeDto = z.infer<typeof schoolGradeRangeSchema>;

// ============================================
// School Grade Levels (Phase 1 — catalog/template/selection model)
// ============================================
//
// `enabledGradeLevels` is the authoritative list of grade-level CODES a
// school operates. Each code MUST exist in the shared-types
// `ORDERED_GRADES` catalog. A school selects from the global catalog —
// it does NOT invent new codes. This keeps Ed-Fi exports lossless and
// cross-school analytics coherent.
//
// `gradeLevelLabels` is an optional per-locale override map for the
// default catalog labels:
//   { 'PG': { 'ne-NP': 'प्ले ग्रुप', 'en': 'Playgroup (अ)' } }
// Keys are grade codes (must be in `enabledGradeLevels`); inner keys
// are locale identifiers (BCP-47-ish). If absent, the catalog's
// default labels apply.
//
// Phase 0 added PG/NUR/LKG/UKG codes to ORDERED_GRADES; Phase 1 wires
// schools to opt into using them via this field. The legacy
// `gradeRange: { start, end }` remains for backward compat — when
// `enabledGradeLevels` is absent on a read, it's derived from the
// range. See schoolEntityToDto in identity/schools/schools.service.ts.

export const gradeLevelLabelsSchema = z.record(
  // outer key: grade code
  z.string().min(1).max(8),
  // inner key: locale identifier (BCP 47-ish). Upper bound `max(35)`
  // accommodates valid BCP 47 tags like `nan-Hant-TW` (11),
  // `cmn-Hans-CN` (11), `en-US-POSIX` (11), and grandfathered/extension
  // forms up to the ~35-char practical maximum. Earlier `max(10)`
  // rejected legitimate tags.
  z.record(z.string().min(2).max(35), z.string().min(1).max(50)),
);
export type GradeLevelLabels = z.infer<typeof gradeLevelLabelsSchema>;

/**
 * Refinement: every grade code in enabledGradeLevels must exist in
 * ORDERED_GRADES, and gradeLevelLabels keys must be a subset of
 * enabledGradeLevels (no orphan label entries).
 */
function validateEnabledGradeLevels(
  enabled: string[],
  labels: GradeLevelLabels | undefined,
): string | null {
  if (enabled.length === 0) {
    return 'enabledGradeLevels must contain at least one grade code';
  }
  for (const code of enabled) {
    if (!ORDERED_GRADES.includes(code as (typeof ORDERED_GRADES)[number])) {
      return `Unknown grade code: '${code}'. All codes must be in the shared-types catalog (ORDERED_GRADES).`;
    }
  }
  if (labels) {
    const enabledSet = new Set(enabled);
    for (const code of Object.keys(labels)) {
      if (!enabledSet.has(code)) {
        return `gradeLevelLabels has entry for '${code}' which is not in enabledGradeLevels`;
      }
    }
  }
  return null;
}

/**
 * Dedicated PATCH payload for /schools/:schoolId/grade-levels.
 *
 * Distinct from the generic updateSchoolSchema because:
 *   - Different ABAC permission (gradelevels:edit, not school:edit)
 *   - Focused audit-event shape (SchoolGradeLevelsUpdated)
 *   - Validation refinement against the catalog
 */
export const updateSchoolGradeLevelsSchema = z.object({
  enabledGradeLevels: z.array(z.string().min(1).max(8)),
  gradeLevelLabels: gradeLevelLabelsSchema.optional(),
}).refine(
  (data) => validateEnabledGradeLevels(data.enabledGradeLevels, data.gradeLevelLabels) === null,
  (data) => ({
    message: validateEnabledGradeLevels(data.enabledGradeLevels, data.gradeLevelLabels) ?? 'invalid grade levels',
    path: ['enabledGradeLevels'],
  }),
);

export type UpdateSchoolGradeLevelsDto = z.infer<typeof updateSchoolGradeLevelsSchema>;

// ============================================
// School Address Schema (Enhanced with coordinates)
// ============================================

/**
 * **Canonical Nepal-aware address pattern** for the EdForge codebase. The
 * shape of `wardNumber/municipality/district/province` here was the reference
 * pattern when extending `addressSchema` (common.ts, used by Student / Family
 * / Guardian) and `staffAddressSchema` (identity/staff.schema.ts) in Sprint A
 * — see `docs/decisions/region-aware-forms-divergence.md`.
 *
 * Unique to school addresses: NPL-conditional refinement requiring district +
 * province (lines 112–121 below). The legacy and staff schemas deliberately
 * do NOT replicate this refinement — see the rationale in the divergence ADR.
 *
 * If field shapes diverge across the three address schemas in the future,
 * fix it here first (canonical) then propagate.
 */
export const schoolAddressSchema = z.object({
  street1: z.string().min(1).max(200),
  street2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  // Nepal-specific fields
  wardNumber: z.string().max(10).optional(),
  municipality: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  // Generic international field
  region: z.string().max(100).optional(),
  // Coordinates
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().optional(),
}).refine(
  (data) => {
    const country = data.country || 'USA';
    if (country === 'USA') {
      return !!data.state && data.state.length >= 1 && !!data.zipCode && data.zipCode.length >= 1;
    }
    return true;
  },
  { message: 'US addresses require state and zip code', path: ['state'] },
).refine(
  (data) => {
    const country = data.country || 'USA';
    if (country === 'NPL') {
      return !!data.district && !!data.province;
    }
    return true;
  },
  { message: 'Nepal addresses require district and province', path: ['district'] },
);

export type SchoolAddressDto = z.infer<typeof schoolAddressSchema>;

// ============================================
// Create School Schema
// ============================================

export const createSchoolSchema = z.object({
  schoolCode: z.string().min(2).max(10),
  /**
   * External government/EMIS school code (e.g. Nepal IEMIS School Code).
   * Required for PABSON tenants (enforced at service layer since archetype
   * lookup is not in Zod scope). Immutable after creation.
   *
   * Format: 8–10 digits per `iemisSchoolCodeSchema` (S1.1). Loose
   * `z.string().min(1).max(32)` was replaced 2026-04-23 to prevent
   * malformed codes from landing in DDB — once a school is created with
   * a bad code it cannot be corrected (immutable).
   */
  emisSchoolCode: iemisSchoolCodeSchema.optional(),
  name: z.string().min(2).max(100),
  shortName: z.string().max(50).optional(),
  schoolType: schoolTypeSchema,
  gradeRange: schoolGradeRangeSchema,
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  website: urlSchema.optional(),
  address: schoolAddressSchema.optional(),
  contactInfo: schoolContactInfoSchema.optional(),
  principalName: z.string().max(100).optional(),
  principalEmail: emailSchema.optional(),
  timezone: z.string().default('America/Chicago'),
  locale: z.string().default('en-US'),
  academicCalendarType: academicCalendarTypeSchema.default('semester'),
  calendarSystem: calendarSystemSchema.default('gregorian'),
  logoUrl: urlSchema.optional(),
  /**
   * Sprint C.0.5 — optional PDF-rendering branding sub-document. Backward-
   * compatible: existing schools omit this field. PDF render endpoints
   * (C.1+) prefer `branding.logoS3Key` over `logoUrl` when present.
   */
  branding: schoolBrandingSchema.optional(),

  // Ed-Fi Education Organization Fields (optional for backwards compatibility)
  localEducationAgencyId: z.string().uuid().optional(),                          // LEA parent reference
  schoolCategories: z.array(schoolCategoryDescriptorSchema).optional(),          // Ed-Fi: schoolCategoryDescriptor
  schoolTypeDescriptor: schoolTypeDescriptorSchema.optional(),                   // Ed-Fi: schoolTypeDescriptor
  gradeLevels: z.array(schoolGradeLevelDescriptorSchema).optional(),             // Ed-Fi: gradeLevelDescriptor
  charterStatusDescriptor: charterStatusDescriptorSchema.optional(),             // Ed-Fi: charterStatusDescriptor
  administrativeFundingControlDescriptor: administrativeFundingControlDescriptorSchema.optional(),
  titleIPartASchoolDesignationDescriptor: z.string().max(200).optional(),        // Ed-Fi: descriptor URI
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(), // Ed-Fi: identification codes
  institutionTelephones: z.array(institutionTelephoneSchema).optional(),          // Ed-Fi: institution telephones
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),          // Ed-Fi: accountability ratings

  // Phase 1 — catalog/template/selection model. Both optional at create
  // time: when absent, `enabledGradeLevels` is derived on read from
  // `gradeRange.start..gradeRange.end` (backward compat). Operators who
  // need non-contiguous selection (Saraswati skips PK/K) supply this
  // explicitly. `gradeLevelLabels` is purely additive — per-locale
  // overrides for the catalog's default labels.
  enabledGradeLevels: z.array(z.string().min(1).max(8)).optional(),
  gradeLevelLabels: gradeLevelLabelsSchema.optional(),
}).refine(
  (data) => {
    const startIdx = getGradeIndex(data.gradeRange.start);
    const endIdx = getGradeIndex(data.gradeRange.end);
    return startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx;
  },
  { message: 'Start grade must be before or equal to end grade', path: ['gradeRange'] },
).refine(
  (data) => {
    const error = validateSchoolTypeGradeRange(data.schoolType, data.gradeRange);
    return error === null;
  },
  (data) => ({
    message: validateSchoolTypeGradeRange(data.schoolType, data.gradeRange) || 'Invalid school type / grade range combination',
    path: ['gradeRange'],
  }),
).refine(
  (data) => {
    if (!data.enabledGradeLevels) return true;
    return validateEnabledGradeLevels(data.enabledGradeLevels, data.gradeLevelLabels) === null;
  },
  (data) => ({
    message: (data.enabledGradeLevels
      ? validateEnabledGradeLevels(data.enabledGradeLevels, data.gradeLevelLabels)
      : null) ?? 'invalid grade levels',
    path: ['enabledGradeLevels'],
  }),
);

export type CreateSchoolDto = z.infer<typeof createSchoolSchema>;

// ============================================
// Update School Schema
// ============================================

export const updateSchoolSchema = z.object({
  /**
   * Listed explicitly so callers get a stable TypeScript type. At runtime the
   * identity service's `classifyUpdateFields` rejects any attempt to change
   * this field with a 400 (it's in FIELD_MUTABILITY.immutable). Kept optional
   * here so the generated `UpdateSchoolDto` remains a pure PATCH shape; the
   * immutability gate lives at the service boundary, not in Zod.
   *
   * Format enforced by `iemisSchoolCodeSchema` (S1.1) so an attempt to PATCH
   * with a malformed code fails at Zod parse before the immutability gate
   * fires — cleaner error message.
   */
  emisSchoolCode: iemisSchoolCodeSchema.optional(),
  name: z.string().min(2).max(100).optional(),
  shortName: z.string().max(50).optional(),
  schoolType: schoolTypeSchema.optional(),
  gradeRange: schoolGradeRangeSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  website: urlSchema.optional(),
  address: schoolAddressSchema.optional(),
  contactInfo: schoolContactInfoSchema.partial().optional(),
  principalName: z.string().max(100).optional(),
  principalEmail: emailSchema.optional(),
  status: schoolStatusSchema.optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  calendarSystem: calendarSystemSchema.optional(),
  currentAcademicYearId: z.string().uuid().optional(),
  logoUrl: urlSchema.optional(),
  /** Sprint C.0.5 — partial-update of branding fields. Caller PATCHes only the fields they want to change. */
  branding: schoolBrandingSchema.optional(),

  // Ed-Fi Education Organization Fields
  localEducationAgencyId: z.string().uuid().nullable().optional(),               // LEA parent reference (null to unlink)
  schoolCategories: z.array(schoolCategoryDescriptorSchema).optional(),
  schoolTypeDescriptor: schoolTypeDescriptorSchema.optional(),
  gradeLevels: z.array(schoolGradeLevelDescriptorSchema).optional(),
  charterStatusDescriptor: charterStatusDescriptorSchema.optional(),
  administrativeFundingControlDescriptor: administrativeFundingControlDescriptorSchema.optional(),
  titleIPartASchoolDesignationDescriptor: z.string().max(200).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  institutionTelephones: z.array(institutionTelephoneSchema).optional(),
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),

  // Phase 1 — generic update also accepts these so workflows that touch
  // grade levels alongside other school metadata can do so atomically.
  // The dedicated PATCH /schools/:schoolId/grade-levels endpoint
  // (updateSchoolGradeLevelsSchema) is the preferred path for
  // grade-levels-only changes since it gates on the gradelevels:edit
  // ABAC permission instead of generic school update.
  enabledGradeLevels: z.array(z.string().min(1).max(8)).optional(),
  gradeLevelLabels: gradeLevelLabelsSchema.optional(),
}).refine(
  (data) => {
    if (!data.gradeRange) return true;
    const startIdx = getGradeIndex(data.gradeRange.start);
    const endIdx = getGradeIndex(data.gradeRange.end);
    return startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx;
  },
  { message: 'Start grade must be before or equal to end grade', path: ['gradeRange'] },
).refine(
  (data) => {
    // Only validate when both schoolType and gradeRange are being updated together
    if (!data.schoolType || !data.gradeRange) return true;
    return validateSchoolTypeGradeRange(data.schoolType, data.gradeRange) === null;
  },
  (data) => ({
    message: (data.schoolType && data.gradeRange
      ? validateSchoolTypeGradeRange(data.schoolType, data.gradeRange)
      : 'Invalid school type / grade range combination') || 'Invalid combination',
    path: ['gradeRange'],
  }),
).refine(
  (data) => {
    if (!data.enabledGradeLevels) return true;
    return validateEnabledGradeLevels(data.enabledGradeLevels, data.gradeLevelLabels) === null;
  },
  (data) => ({
    message: (data.enabledGradeLevels
      ? validateEnabledGradeLevels(data.enabledGradeLevels, data.gradeLevelLabels)
      : null) ?? 'invalid grade levels',
    path: ['enabledGradeLevels'],
  }),
);

export type UpdateSchoolDto = z.infer<typeof updateSchoolSchema>;

// ============================================
// School Response Schema
// ============================================

export const schoolResponseSchema = z.object({
  schoolId: z.string().uuid(),
  schoolCode: z.string(),
  emisSchoolCode: z.string().optional(),
  name: z.string(),
  shortName: z.string().optional(),
  schoolType: schoolTypeSchema,
  gradeRange: schoolGradeRangeSchema,
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  address: schoolAddressSchema.optional(),
  contactInfo: schoolContactInfoSchema.optional(),
  principalName: z.string().optional(),
  principalEmail: z.string().optional(),
  status: schoolStatusSchema,
  timezone: z.string(),
  locale: z.string(),
  // S0.2: academicCalendarType is the AY-level concept on AcademicYear.calendarType.
  // Kept here as optional for backward compatibility — the response mapper no
  // longer emits it, but old consumers reading the field will see `undefined`
  // rather than a Zod parse failure. Drop entirely in a future major bump.
  academicCalendarType: academicCalendarTypeSchema.optional(),
  calendarSystem: calendarSystemSchema.default('gregorian'),
  currentAcademicYearId: z.string().uuid().optional(),
  studentCount: z.number().int().min(0).optional(),
  staffCount: z.number().int().min(0).optional(),
  teacherCount: z.number().int().min(0).optional(),
  logoUrl: z.string().optional(),
  /** Sprint C.0.5 — surfaced in GET so AdminWeb + Shell editor can read it. */
  branding: schoolBrandingSchema.optional(),

  // Ed-Fi Education Organization Fields
  localEducationAgencyId: z.string().uuid().optional(),
  schoolCategories: z.array(schoolCategoryDescriptorSchema).optional(),
  schoolTypeDescriptor: schoolTypeDescriptorSchema.optional(),
  gradeLevels: z.array(schoolGradeLevelDescriptorSchema).optional(),
  charterStatusDescriptor: charterStatusDescriptorSchema.optional(),
  administrativeFundingControlDescriptor: administrativeFundingControlDescriptorSchema.optional(),
  titleIPartASchoolDesignationDescriptor: z.string().optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  institutionTelephones: z.array(institutionTelephoneSchema).optional(),
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),

  // Phase 1 — catalog/template/selection model.
  // `enabledGradeLevels` is the school's operational grade codes (subset
  // of ORDERED_GRADES). For legacy rows that pre-date Phase 1 this is
  // derived from `gradeRange.start..gradeRange.end` in the service-side
  // schoolEntityToDto mapper, so consumers always see a populated array.
  enabledGradeLevels: z.array(z.string()).optional(),
  gradeLevelLabels: gradeLevelLabelsSchema.optional(),

  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type SchoolResponseDto = z.infer<typeof schoolResponseSchema>;

// ============================================
// School List Response Schema
// ============================================

export const schoolListResponseSchema = createPaginatedResponseSchema(schoolResponseSchema);
export type SchoolListResponseDto = z.infer<typeof schoolListResponseSchema>;

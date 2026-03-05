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
import { getGradeIndex, validateSchoolTypeGradeRange } from './grade-levels';

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

export const academicCalendarTypeSchema = z.enum(['semester', 'quarter', 'trimester']);
export type AcademicCalendarType = z.infer<typeof academicCalendarTypeSchema>;

// ============================================
// Contact Info Schema
// ============================================

export const schoolContactInfoSchema = z.object({
  primaryEmail: emailSchema,
  primaryPhone: z.string().min(10).max(20),
  secondaryPhone: z.string().min(10).max(20).optional(),
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
// School Address Schema (Enhanced with coordinates)
// ============================================

export const schoolAddressSchema = z.object({
  street1: z.string().min(1).max(200),
  street2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  zipCode: z.string().min(1).max(20),
  country: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().optional(),
});

export type SchoolAddressDto = z.infer<typeof schoolAddressSchema>;

// ============================================
// Create School Schema
// ============================================

export const createSchoolSchema = z.object({
  schoolCode: z.string().min(2).max(10),
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
  logoUrl: urlSchema.optional(),

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
);

export type CreateSchoolDto = z.infer<typeof createSchoolSchema>;

// ============================================
// Update School Schema
// ============================================

export const updateSchoolSchema = z.object({
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
  currentAcademicYearId: z.string().uuid().optional(),
  logoUrl: urlSchema.optional(),

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
);

export type UpdateSchoolDto = z.infer<typeof updateSchoolSchema>;

// ============================================
// School Response Schema
// ============================================

export const schoolResponseSchema = z.object({
  schoolId: z.string().uuid(),
  schoolCode: z.string(),
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
  academicCalendarType: academicCalendarTypeSchema,
  currentAcademicYearId: z.string().uuid().optional(),
  studentCount: z.number().int().min(0).optional(),
  staffCount: z.number().int().min(0).optional(),
  teacherCount: z.number().int().min(0).optional(),
  logoUrl: z.string().optional(),

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

  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type SchoolResponseDto = z.infer<typeof schoolResponseSchema>;

// ============================================
// School List Response Schema
// ============================================

export const schoolListResponseSchema = createPaginatedResponseSchema(schoolResponseSchema);
export type SchoolListResponseDto = z.infer<typeof schoolListResponseSchema>;

/**
 * School Schemas - Identity Service
 * 
 * Zod schemas for school management DTOs.
 */

import { z } from 'zod';
import { emailSchema, urlSchema, phoneSchema, isoDateSchema, createPaginatedResponseSchema } from '../common';

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
});

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
});

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
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type SchoolResponseDto = z.infer<typeof schoolResponseSchema>;

// ============================================
// School List Response Schema
// ============================================

export const schoolListResponseSchema = createPaginatedResponseSchema(schoolResponseSchema);
export type SchoolListResponseDto = z.infer<typeof schoolListResponseSchema>;

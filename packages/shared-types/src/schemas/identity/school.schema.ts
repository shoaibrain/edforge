/**
 * School Schemas - Identity Service
 * 
 * Zod schemas for school management DTOs.
 */

import { z } from 'zod';
import { emailSchema, urlSchema, isoDateSchema, createPaginatedResponseSchema } from '../common';

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

export const schoolStatusSchema = z.enum(['active', 'inactive', 'setup']);
export type SchoolStatus = z.infer<typeof schoolStatusSchema>;

export const academicCalendarTypeSchema = z.enum(['semester', 'quarter', 'trimester']);
export type AcademicCalendarType = z.infer<typeof academicCalendarTypeSchema>;

// ============================================
// Grade Range Schema
// ============================================

export const gradeRangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

export type GradeRangeDto = z.infer<typeof gradeRangeSchema>;

// ============================================
// School Address Schema
// ============================================

export const schoolAddressSchema = z.object({
  street1: z.string().min(1),
  street2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1),
  country: z.string().default('USA').optional(),
});

export type SchoolAddressDto = z.infer<typeof schoolAddressSchema>;

// ============================================
// Create School Schema
// ============================================

export const createSchoolSchema = z.object({
  schoolCode: z.string().min(2).max(10),
  name: z.string().min(2).max(100),
  shortName: z.string().optional(),
  schoolType: schoolTypeSchema,
  gradeRange: gradeRangeSchema,
  phone: z.string().optional(),
  email: emailSchema.optional(),
  website: urlSchema.optional(),
  address: schoolAddressSchema.optional(),
  principalName: z.string().optional(),
  principalEmail: emailSchema.optional(),
  timezone: z.string().default('America/Chicago').optional(),
  locale: z.string().default('en-US').optional(),
  academicCalendarType: academicCalendarTypeSchema.default('semester').optional(),
  logoUrl: urlSchema.optional(),
});

export type CreateSchoolDto = z.infer<typeof createSchoolSchema>;

// ============================================
// Update School Schema
// ============================================

export const updateSchoolSchema = z.object({
  name: z.string().optional(),
  shortName: z.string().optional(),
  schoolType: schoolTypeSchema.optional(),
  gradeRange: gradeRangeSchema.optional(),
  phone: z.string().optional(),
  email: emailSchema.optional(),
  website: urlSchema.optional(),
  address: schoolAddressSchema.optional(),
  principalName: z.string().optional(),
  principalEmail: emailSchema.optional(),
  status: schoolStatusSchema.optional(),
  timezone: z.string().optional(),
  currentAcademicYearId: z.string().optional(),
  logoUrl: urlSchema.optional(),
});

export type UpdateSchoolDto = z.infer<typeof updateSchoolSchema>;

// ============================================
// School Response Schema
// ============================================

export const schoolResponseSchema = z.object({
  schoolId: z.string(),
  schoolCode: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  schoolType: schoolTypeSchema,
  gradeRange: gradeRangeSchema,
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  address: schoolAddressSchema.optional(),
  principalName: z.string().optional(),
  principalEmail: z.string().optional(),
  status: schoolStatusSchema,
  timezone: z.string(),
  locale: z.string(),
  academicCalendarType: academicCalendarTypeSchema,
  currentAcademicYearId: z.string().optional(),
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


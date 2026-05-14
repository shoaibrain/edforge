/**
 * Department and School Configuration Schemas - Identity Service
 * 
 * Zod schemas for department and school configuration DTOs.
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { academicCalendarTypeSchema, calendarSystemSchema } from './school.schema';
import { timeFormatSchema } from './user.schema';

// ============================================
// Department Schemas
// ============================================

export const createDepartmentSchema = z.object({
  code: z.string().min(2).max(10),
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  headUserId: z.string().optional(),
});

export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  headUserId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;

export const departmentResponseSchema = z.object({
  departmentId: z.string(),
  schoolId: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().optional(),
  headUserId: z.string().optional(),
  headName: z.string().optional(),
  isActive: z.boolean(),
  teacherCount: z.number().int().min(0).optional(),
  courseCount: z.number().int().min(0).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type DepartmentResponseDto = z.infer<typeof departmentResponseSchema>;

export const departmentListResponseSchema = createPaginatedResponseSchema(departmentResponseSchema);
export type DepartmentListResponseDto = z.infer<typeof departmentListResponseSchema>;

// ============================================
// School Configuration Schemas
// ============================================

export const schoolGradingScaleTypeSchema = z.enum(['letter', 'percentage', 'points', 'custom']);
export type SchoolGradingScaleType = z.infer<typeof schoolGradingScaleTypeSchema>;

/**
 * Grade level configuration for school grading scale
 * (e.g., A = 90-100, B = 80-89, etc.)
 */
export const gradeLevelConfigSchema = z.object({
  letter: z.string().min(1),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  gpa: z.number().min(0).max(5).optional(),
});

export type GradeLevelConfigDto = z.infer<typeof gradeLevelConfigSchema>;

/**
 * School-level grading scale configuration
 */
export const schoolGradingScaleSchema = z.object({
  type: schoolGradingScaleTypeSchema,
  passingGrade: z.number().int().min(0).max(100),
  scale: z.array(gradeLevelConfigSchema),
});

export type SchoolGradingScaleDto = z.infer<typeof schoolGradingScaleSchema>;

export const schoolFeaturesSchema = z.object({
  attendance: z.boolean().default(true).optional(),
  grades: z.boolean().default(true).optional(),
  enrollment: z.boolean().default(true).optional(),
  curriculum: z.boolean().default(true).optional(),
  scheduling: z.boolean().default(true).optional(),
  specialPrograms: z.boolean().default(true).optional(),
  parentPortal: z.boolean().default(true).optional(),
  studentPortal: z.boolean().default(true).optional(),
});

export type SchoolFeaturesDto = z.infer<typeof schoolFeaturesSchema>;

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const updateSchoolConfigSchema = z.object({
  timezone: z.string().optional(),
  locale: z.string().optional(),
  dateFormat: z.string().optional(),
  timeFormat: timeFormatSchema.optional(),
  academicCalendarType: academicCalendarTypeSchema.optional(),
  gradingScale: schoolGradingScaleSchema.optional(),
  attendanceRequired: z.boolean().optional(),
  schoolDays: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
  endTime: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
  periodDuration: z.number().int().min(15).max(120).optional(),
  notificationsEnabled: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  features: schoolFeaturesSchema.optional(),
});

export type UpdateSchoolConfigDto = z.infer<typeof updateSchoolConfigSchema>;

export const schoolConfigResponseSchema = z.object({
  schoolId: z.string(),
  timezone: z.string(),
  locale: z.string(),
  // S0.4: calendarSystem is the school's primary calendar system (bikram_sambat
  // for PABSON, gregorian otherwise). It lives on the School entity itself but
  // is surfaced here as a read-through so frontend `DateInput` components can
  // route to the right picker from a single config-fetch.
  calendarSystem: calendarSystemSchema.optional(),
  dateFormat: z.string(),
  timeFormat: timeFormatSchema,
  // S0.2: academicCalendarType is duplicated with AcademicYear.calendarType
  // (the AY-level field is authoritative — a school could change calendar
  // shape between years). Kept here as optional for backward compatibility;
  // the response mapper no longer emits it.
  academicCalendarType: academicCalendarTypeSchema.optional(),
  gradingScale: schoolGradingScaleSchema,
  attendanceRequired: z.boolean(),
  schoolDays: z.array(z.number().int()),
  startTime: z.string(),
  endTime: z.string(),
  periodDuration: z.number().int(),
  notificationsEnabled: z.boolean(),
  emailNotifications: z.boolean(),
  smsNotifications: z.boolean(),
  features: schoolFeaturesSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type SchoolConfigResponseDto = z.infer<typeof schoolConfigResponseSchema>;


/**
 * Department and School Configuration Schemas - Identity Service
 * 
 * Zod schemas for department and school configuration DTOs.
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { academicCalendarTypeSchema } from './school.schema';
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

export const gradingScaleTypeSchema = z.enum(['letter', 'percentage', 'points', 'custom']);
export type GradingScaleType = z.infer<typeof gradingScaleTypeSchema>;

export const gradeLevelSchema = z.object({
  letter: z.string().min(1),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  gpa: z.number().min(0).max(5).optional(),
});

export type GradeLevelDto = z.infer<typeof gradeLevelSchema>;

export const gradingScaleSchema = z.object({
  type: gradingScaleTypeSchema,
  passingGrade: z.number().int().min(0).max(100),
  scale: z.array(gradeLevelSchema),
});

export type GradingScaleDto = z.infer<typeof gradingScaleSchema>;

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
  gradingScale: gradingScaleSchema.optional(),
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
  dateFormat: z.string(),
  timeFormat: timeFormatSchema,
  academicCalendarType: academicCalendarTypeSchema,
  gradingScale: gradingScaleSchema,
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


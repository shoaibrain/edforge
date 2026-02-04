/**
 * Classroom Schemas - Academics Service
 * 
 * Zod schemas for classroom/section management DTOs.
 */

import { z } from 'zod';
import { 
  isoDateSchema,
  timeSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums
// ============================================

export const dayOfWeekSchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;

export const classroomStatusSchema = z.enum(['active', 'inactive', 'archived']);
export type ClassroomStatus = z.infer<typeof classroomStatusSchema>;

export const subjectAreaSchema = z.enum([
  'mathematics',
  'english_language_arts',
  'science',
  'social_studies',
  'foreign_language',
  'physical_education',
  'art',
  'music',
  'technology',
  'elective',
  'other',
]);
export type SubjectArea = z.infer<typeof subjectAreaSchema>;

// ============================================
// Class Schedule Schema
// ============================================

export const classScheduleSchema = z.object({
  dayOfWeek: dayOfWeekSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  periodNumber: z.number().int().positive().max(20).optional(),
  periodName: z.string().max(50).optional(),
  room: z.string().max(50).optional(),
}).refine(
  data => data.startTime < data.endTime,
  { message: 'Start time must be before end time' }
);

export type ClassScheduleDto = z.infer<typeof classScheduleSchema>;

// ============================================
// Create Classroom Schema
// ============================================

export const createClassroomSchema = z.object({
  // Basic Info
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20),
  description: z.string().max(500).optional(),
  
  // Academic Info
  subject: z.string().min(1).max(100),
  subjectArea: subjectAreaSchema.optional(),
  gradeLevel: z.string().min(1).max(10),
  section: z.string().max(20).optional(),
  
  // School Info
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  
  // Teachers
  primaryTeacherId: z.string().uuid(),
  coTeacherIds: z.array(z.string().uuid()).max(5).optional(),
  
  // Location
  room: z.string().max(50).optional(),
  building: z.string().max(100).optional(),
  
  // Capacity
  capacity: z.number().int().positive().max(200).optional(),
  
  // Schedule
  schedule: z.array(classScheduleSchema).min(1).max(35),
  
  // Settings
  status: classroomStatusSchema.default('active'),
  allowSelfEnrollment: z.boolean().default(false),
  isVirtual: z.boolean().default(false),
  virtualMeetingUrl: z.string().url().optional(),
  
  // Course Info
  courseCode: z.string().max(20).optional(),
  credits: z.number().min(0).max(10).optional(),
});

export type CreateClassroomDto = z.infer<typeof createClassroomSchema>;

// ============================================
// Update Classroom Schema
// ============================================

export const updateClassroomSchema = createClassroomSchema.partial().omit({
  schoolId: true,
  academicYearId: true,
});

export type UpdateClassroomDto = z.infer<typeof updateClassroomSchema>;

// ============================================
// Classroom Response Schema
// ============================================

export const classroomResponseSchema = z.object({
  classroomId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string(),
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  
  // Basic Info
  name: z.string(),
  code: z.string(),
  description: z.string().optional(),
  
  // Academic Info
  subject: z.string(),
  subjectArea: subjectAreaSchema.optional(),
  gradeLevel: z.string(),
  section: z.string().optional(),
  
  // Teachers
  primaryTeacherId: z.string().uuid(),
  primaryTeacherName: z.string().optional(),
  coTeacherIds: z.array(z.string().uuid()).optional(),
  
  // Location
  room: z.string().optional(),
  building: z.string().optional(),
  
  // Capacity
  capacity: z.number().int().optional(),
  enrolledCount: z.number().int().min(0).optional(),
  
  // Schedule
  schedule: z.array(classScheduleSchema),
  
  // Settings
  status: classroomStatusSchema,
  allowSelfEnrollment: z.boolean(),
  isVirtual: z.boolean(),
  virtualMeetingUrl: z.string().optional(),
  
  // Course Info
  courseCode: z.string().optional(),
  credits: z.number().optional(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type ClassroomResponseDto = z.infer<typeof classroomResponseSchema>;

// ============================================
// Classroom List Response Schema
// ============================================

export const classroomListResponseSchema = createPaginatedResponseSchema(classroomResponseSchema);
export type ClassroomListResponseDto = z.infer<typeof classroomListResponseSchema>;

// ============================================
// Enroll Student Schema
// ============================================

export const enrollStudentInClassSchema = z.object({
  studentId: z.string().uuid(),
  classroomId: z.string().uuid(),
  enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional(),
});

export type EnrollStudentInClassDto = z.infer<typeof enrollStudentInClassSchema>;

// ============================================
// Bulk Enroll Schema
// ============================================

export const bulkEnrollStudentsSchema = z.object({
  classroomId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type BulkEnrollStudentsDto = z.infer<typeof bulkEnrollStudentsSchema>;

// ============================================
// Classroom Filter Schema
// ============================================

export const classroomFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  gradeLevel: z.string().optional(),
  subjectArea: subjectAreaSchema.optional(),
  status: classroomStatusSchema.optional(),
  searchTerm: z.string().max(100).optional(),
});

export type ClassroomFilterDto = z.infer<typeof classroomFilterSchema>;

/**
 * Assignment Schemas - Academics Service
 * 
 * Zod schemas for assignment management DTOs.
 */

import { z } from 'zod';
import { 
  isoDateSchema,
  dateSchema,
  urlSchema,
  createPaginatedResponseSchema,
} from '../common';
import { gradeCategoryTypeSchema } from './grade.schema';

// ============================================
// Enums
// ============================================

export const assignmentStatusSchema = z.enum([
  'draft',
  'published',
  'closed',
  'archived',
]);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const submissionTypeSchema = z.enum([
  'online_text',
  'online_upload',
  'external_url',
  'paper',
  'none',
  'discussion',
]);
export type SubmissionType = z.infer<typeof submissionTypeSchema>;

// ============================================
// Assignment Attachment Schema
// ============================================

export const assignmentAttachmentSchema = z.object({
  attachmentId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  url: urlSchema,
  mimeType: z.string().max(100).optional(),
  size: z.number().int().positive().optional(),
  uploadedAt: isoDateSchema.optional(),
});

export type AssignmentAttachmentDto = z.infer<typeof assignmentAttachmentSchema>;

// ============================================
// Rubric Criterion Schema
// ============================================

export const rubricCriterionSchema = z.object({
  criterionId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  maxPoints: z.number().min(0).max(1000),
  order: z.number().int().min(0).optional(),
  levels: z.array(z.object({
    levelId: z.string().uuid().optional(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    points: z.number().min(0),
  })).min(1).max(10).optional(),
});

export type RubricCriterionDto = z.infer<typeof rubricCriterionSchema>;

// ============================================
// Assignment Rubric Schema
// ============================================

export const assignmentRubricSchema = z.object({
  rubricId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  criteria: z.array(rubricCriterionSchema).min(1).max(20),
  totalPoints: z.number().min(0).optional(),
});

export type AssignmentRubricDto = z.infer<typeof assignmentRubricSchema>;

// ============================================
// Create Assignment Schema
// ============================================

export const createAssignmentSchema = z.object({
  // Basic Info
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  instructions: z.string().max(10000).optional(),
  
  // Classification
  classroomId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  categoryType: gradeCategoryTypeSchema.optional(),
  gradingPeriodId: z.string().uuid().optional(),
  
  // Points
  pointsPossible: z.number().min(0).max(10000),
  isExtraCredit: z.boolean().default(false),
  
  // Dates
  assignedDate: dateSchema,
  dueDate: dateSchema,
  dueDateTimeZone: z.string().default('America/New_York'),
  lockAfterDueDate: z.boolean().default(false),
  
  // Submission Settings
  submissionType: submissionTypeSchema.default('online_upload'),
  allowedFileTypes: z.array(z.string().max(50)).optional(),
  maxFileSize: z.number().int().positive().optional(), // in bytes
  maxAttempts: z.number().int().positive().max(100).optional(),
  allowLateSubmissions: z.boolean().default(true),
  latePenaltyPercent: z.number().min(0).max(100).optional(),
  latePenaltyPerDay: z.number().min(0).max(100).optional(),
  
  // Content
  attachments: z.array(assignmentAttachmentSchema).max(20).optional(),
  rubric: assignmentRubricSchema.optional(),
  
  // Settings
  status: assignmentStatusSchema.default('draft'),
  isGroupAssignment: z.boolean().default(false),
  groupSize: z.number().int().min(2).max(10).optional(),
  showRubricToStudents: z.boolean().default(true),
  anonymousGrading: z.boolean().default(false),
  
  // Standards (for Ed-Fi alignment later)
  learningStandardIds: z.array(z.string().uuid()).optional(),
});

export type CreateAssignmentDto = z.infer<typeof createAssignmentSchema>;

// ============================================
// Update Assignment Schema
// ============================================

export const updateAssignmentSchema = createAssignmentSchema.partial().omit({
  classroomId: true,
});

export type UpdateAssignmentDto = z.infer<typeof updateAssignmentSchema>;

// ============================================
// Assignment Response Schema
// ============================================

export const assignmentResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  classroomId: z.string().uuid(),
  classroomName: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  categoryName: z.string().optional(),
  categoryType: gradeCategoryTypeSchema.optional(),
  gradingPeriodId: z.string().uuid().optional(),
  
  // Basic Info
  title: z.string(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  
  // Points
  pointsPossible: z.number(),
  isExtraCredit: z.boolean(),
  
  // Dates
  assignedDate: dateSchema,
  dueDate: dateSchema,
  dueDateTimeZone: z.string(),
  lockAfterDueDate: z.boolean(),
  
  // Submission Settings
  submissionType: submissionTypeSchema,
  allowedFileTypes: z.array(z.string()).optional(),
  maxFileSize: z.number().optional(),
  maxAttempts: z.number().optional(),
  allowLateSubmissions: z.boolean(),
  latePenaltyPercent: z.number().optional(),
  latePenaltyPerDay: z.number().optional(),
  
  // Content
  attachments: z.array(assignmentAttachmentSchema).optional(),
  rubric: assignmentRubricSchema.optional(),
  
  // Settings
  status: assignmentStatusSchema,
  isGroupAssignment: z.boolean(),
  groupSize: z.number().optional(),
  showRubricToStudents: z.boolean(),
  anonymousGrading: z.boolean(),
  
  // Statistics
  submittedCount: z.number().int().min(0).optional(),
  gradedCount: z.number().int().min(0).optional(),
  totalStudents: z.number().int().min(0).optional(),
  averageScore: z.number().min(0).optional(),
  
  // Standards
  learningStandardIds: z.array(z.string().uuid()).optional(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type AssignmentResponseDto = z.infer<typeof assignmentResponseSchema>;

// ============================================
// Assignment List Response Schema
// ============================================

export const assignmentListResponseSchema = createPaginatedResponseSchema(assignmentResponseSchema);
export type AssignmentListResponseDto = z.infer<typeof assignmentListResponseSchema>;

// ============================================
// Assignment Filter Schema
// ============================================

export const assignmentFilterSchema = z.object({
  classroomId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  categoryType: gradeCategoryTypeSchema.optional(),
  gradingPeriodId: z.string().uuid().optional(),
  status: assignmentStatusSchema.optional(),
  dueDateFrom: dateSchema.optional(),
  dueDateTo: dateSchema.optional(),
  searchTerm: z.string().max(100).optional(),
});

export type AssignmentFilterDto = z.infer<typeof assignmentFilterSchema>;

// ============================================
// Student Submission Schema
// ============================================

export const studentSubmissionSchema = z.object({
  assignmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  content: z.string().max(50000).optional(),
  externalUrl: urlSchema.optional(),
  attachments: z.array(assignmentAttachmentSchema).max(20).optional(),
  submittedAt: isoDateSchema.optional(),
  attemptNumber: z.number().int().positive().default(1),
});

export type StudentSubmissionDto = z.infer<typeof studentSubmissionSchema>;

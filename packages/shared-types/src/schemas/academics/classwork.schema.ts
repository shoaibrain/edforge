/**
 * Classwork Schemas - Academics Service
 *
 * Zod schemas for classwork items (assignments, quizzes, materials, questions)
 * and organizational topics within class sections.
 *
 * Ed-Fi Aligned: Classwork items with type 'assignment' or 'quiz' bridge to
 * the Grade entity via itemId → AssignmentGrade.assignmentId.
 */

import { z } from 'zod';
import { isoDateSchema, dateSchema } from '../common';

// ============================================
// Enums
// ============================================

export const classworkItemTypeSchema = z.enum([
  'assignment',
  'quiz',
  'material',
  'question',
]);
export type ClassworkItemType = z.infer<typeof classworkItemTypeSchema>;

export const classworkItemStatusSchema = z.enum([
  'draft',
  'published',
  'scheduled',
]);
export type ClassworkItemStatus = z.infer<typeof classworkItemStatusSchema>;

export const classworkAssessmentCategorySchema = z.enum([
  'formative',
  'summative',
]);
export type ClassworkAssessmentCategory = z.infer<typeof classworkAssessmentCategorySchema>;

// ============================================
// Classwork Attachment Schema
// ============================================

export const classworkAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  fileType: z.string().max(100),
  fileUrl: z.string().max(2048),
  fileSize: z.number().int().positive().optional(),
});
export type ClassworkAttachmentDto = z.infer<typeof classworkAttachmentSchema>;

// ============================================
// Classwork Item Response Schema
// ============================================

export const classworkItemResponseSchema = z.object({
  itemId: z.string().uuid(),
  sectionId: z.string().uuid(),
  schoolId: z.string().uuid(),
  type: classworkItemTypeSchema,
  title: z.string(),
  description: z.string().optional(),
  topicId: z.string().uuid().optional(),
  topicName: z.string().optional(),
  sortOrder: z.number().int().min(0),
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
  assessmentCategory: classworkAssessmentCategorySchema.optional(),
  possiblePoints: z.number().min(0).optional(),
  dueDate: dateSchema.optional(),
  status: classworkItemStatusSchema,
  publishedAt: isoDateSchema.optional(),
  scheduledAt: isoDateSchema.optional(),
  attachments: z.array(classworkAttachmentSchema).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string(),
});
export type ClassworkItemResponseDto = z.infer<typeof classworkItemResponseSchema>;

// ============================================
// Classwork Topic Response Schema
// ============================================

export const classworkTopicResponseSchema = z.object({
  topicId: z.string().uuid(),
  sectionId: z.string().uuid(),
  schoolId: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number().int().min(0),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type ClassworkTopicResponseDto = z.infer<typeof classworkTopicResponseSchema>;

// ============================================
// Section Classwork Response (grouped)
// ============================================

export const sectionClassworkResponseSchema = z.object({
  sectionId: z.string().uuid(),
  topics: z.array(classworkTopicResponseSchema),
  items: z.array(classworkItemResponseSchema),
});
export type SectionClassworkResponseDto = z.infer<typeof sectionClassworkResponseSchema>;

// ============================================
// Create Classwork Item Schema
// ============================================

export const createClassworkItemSchema = z.object({
  sectionId: z.string().uuid(),
  schoolId: z.string().uuid(),
  type: classworkItemTypeSchema,
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  topicId: z.string().uuid().optional(),
  categoryId: z.string().optional(),
  categoryName: z.string().max(100).optional(),
  assessmentCategory: classworkAssessmentCategorySchema.optional(),
  possiblePoints: z.number().min(0).max(10000).optional(),
  dueDate: dateSchema.optional(),
  status: classworkItemStatusSchema.default('draft'),
});
export type CreateClassworkItemDto = z.infer<typeof createClassworkItemSchema>;

// ============================================
// Update Classwork Item Schema
// ============================================

export const updateClassworkItemSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  topicId: z.string().uuid().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().max(100).nullable().optional(),
  assessmentCategory: classworkAssessmentCategorySchema.nullable().optional(),
  possiblePoints: z.number().min(0).max(10000).nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  status: classworkItemStatusSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateClassworkItemDto = z.infer<typeof updateClassworkItemSchema>;

// ============================================
// Create Classwork Topic Schema
// ============================================

export const createClassworkTopicSchema = z.object({
  sectionId: z.string().uuid(),
  schoolId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type CreateClassworkTopicDto = z.infer<typeof createClassworkTopicSchema>;

// ============================================
// Update Classwork Topic Schema
// ============================================

export const updateClassworkTopicSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateClassworkTopicDto = z.infer<typeof updateClassworkTopicSchema>;

// ============================================
// Reorder Classwork Items Schema
// ============================================

export const reorderClassworkItemsSchema = z.object({
  schoolId: z.string().uuid(),
  sectionId: z.string().uuid(),
  items: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(['item', 'topic']),
    sortOrder: z.number().int().min(0),
    topicId: z.string().uuid().nullable().optional(),
  })).min(1).max(200),
});
export type ReorderClassworkItemsDto = z.infer<typeof reorderClassworkItemsSchema>;

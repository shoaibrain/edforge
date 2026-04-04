/**
 * Classwork Entity for Academics Service
 *
 * Represents instructional content items (assignments, quizzes, materials, questions)
 * and organizational topics within a class section.
 *
 * Bridge to Grades: When a ClassworkItem has type 'assignment' or 'quiz' with possiblePoints,
 * the itemId becomes the assignmentId on AssignmentGrade. Classwork is source of truth
 * for assignment metadata; Grade entity holds scoring data.
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: CLASSWORK#{schoolId}#{sectionId}#{itemId}
 *
 * GSI1 (School scope — list by section):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: CLASSWORK#{sectionId}#{itemId}
 *
 * ClassworkTopic:
 * - PK: TENANT#{tenantId}
 * - SK: CLASSWORK_TOPIC#{schoolId}#{sectionId}#{topicId}
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: CLASSWORK_TOPIC#{sectionId}#{topicId}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';

/**
 * Classwork item type — Ed-Fi aligned instructional content types
 */
export type ClassworkItemType = 'assignment' | 'quiz' | 'material' | 'question';

/**
 * Classwork item status
 */
export type ClassworkItemStatus = 'draft' | 'published' | 'scheduled';

/**
 * Assessment category (Ed-Fi aligned)
 */
export type ClassworkAssessmentCategory = 'formative' | 'summative';

/**
 * Classwork attachment
 */
export interface ClassworkAttachment {
  attachmentId: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  fileSize?: number;
}

/**
 * Classwork item entity — assignment, quiz, material, or question within a section
 */
export interface ClassworkItem extends BaseEntity {
  entityType: 'CLASSWORK';

  // Identity
  itemId: string;
  sectionId: string;
  schoolId: string;

  // Content
  type: ClassworkItemType;
  title: string;
  description?: string;

  // Organization
  topicId?: string;
  topicName?: string;
  sortOrder: number;

  // Assessment metadata (for graded items — bridges to AssignmentGrade)
  categoryId?: string;
  categoryName?: string;
  assessmentCategory?: ClassworkAssessmentCategory;
  possiblePoints?: number;
  dueDate?: string;

  // Status
  status: ClassworkItemStatus;
  publishedAt?: string;
  scheduledAt?: string;

  // Attachments
  attachments?: ClassworkAttachment[];

  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // CLASSWORK#{sectionId}#{itemId}
}

/**
 * Classwork topic entity — organizational grouping (e.g., Unit 1, Chapter 2)
 */
export interface ClassworkTopic extends BaseEntity {
  entityType: 'CLASSWORK_TOPIC';

  // Identity
  topicId: string;
  sectionId: string;
  schoolId: string;

  // Content
  name: string;
  sortOrder: number;

  // GSI Keys
  gsi1pk: string;
  gsi1sk: string;
}

/**
 * Create a new ClassworkItem entity with proper keys
 */
export function createClassworkItemEntity(
  tenantId: string,
  itemId: string,
  schoolId: string,
  sectionId: string,
  data: {
    type: ClassworkItemType;
    title: string;
    description?: string;
    topicId?: string;
    topicName?: string;
    sortOrder: number;
    categoryId?: string;
    categoryName?: string;
    assessmentCategory?: ClassworkAssessmentCategory;
    possiblePoints?: number;
    dueDate?: string;
    status: ClassworkItemStatus;
    attachments?: ClassworkAttachment[];
    createdBy: string;
  },
): ClassworkItem {
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.classwork(schoolId, sectionId, itemId),
    entityType: 'CLASSWORK',
    itemId,
    sectionId,
    schoolId,
    type: data.type,
    title: data.title,
    description: data.description,
    topicId: data.topicId,
    topicName: data.topicName,
    sortOrder: data.sortOrder,
    categoryId: data.categoryId,
    categoryName: data.categoryName,
    assessmentCategory: data.assessmentCategory,
    possiblePoints: data.possiblePoints,
    dueDate: data.dueDate,
    status: data.status,
    attachments: data.attachments,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `CLASSWORK#${sectionId}#${itemId}`,
  };
}

/**
 * Create a new ClassworkTopic entity with proper keys
 */
export function createClassworkTopicEntity(
  tenantId: string,
  topicId: string,
  schoolId: string,
  sectionId: string,
  data: {
    name: string;
    sortOrder: number;
    createdBy: string;
  },
): ClassworkTopic {
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.classworkTopic(schoolId, sectionId, topicId),
    entityType: 'CLASSWORK_TOPIC',
    topicId,
    sectionId,
    schoolId,
    name: data.name,
    sortOrder: data.sortOrder,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `CLASSWORK_TOPIC#${sectionId}#${topicId}`,
  };
}

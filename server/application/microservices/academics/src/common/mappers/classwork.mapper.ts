/**
 * Classwork Mapper
 *
 * Translates between ClassworkItem/ClassworkTopic entities and response DTOs.
 */

import { ClassworkItem, ClassworkTopic } from '../entities/classwork.entity';

export interface ClassworkItemResponseDto {
  itemId: string;
  sectionId: string;
  schoolId: string;
  type: string;
  title: string;
  description?: string;
  topicId?: string;
  topicName?: string;
  sortOrder: number;
  categoryId?: string;
  categoryName?: string;
  assessmentCategory?: string;
  possiblePoints?: number;
  dueDate?: string;
  status: string;
  publishedAt?: string;
  scheduledAt?: string;
  attachments?: {
    attachmentId: string;
    fileName: string;
    fileType: string;
    fileUrl: string;
    fileSize?: number;
  }[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ClassworkTopicResponseDto {
  topicId: string;
  sectionId: string;
  schoolId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SectionClassworkResponseDto {
  sectionId: string;
  topics: ClassworkTopicResponseDto[];
  items: ClassworkItemResponseDto[];
}

export function classworkItemEntityToDto(entity: ClassworkItem): ClassworkItemResponseDto {
  return {
    itemId: entity.itemId,
    sectionId: entity.sectionId,
    schoolId: entity.schoolId,
    type: entity.type,
    title: entity.title,
    description: entity.description,
    topicId: entity.topicId,
    topicName: entity.topicName,
    sortOrder: entity.sortOrder,
    categoryId: entity.categoryId,
    categoryName: entity.categoryName,
    assessmentCategory: entity.assessmentCategory,
    possiblePoints: entity.possiblePoints,
    dueDate: entity.dueDate,
    status: entity.status,
    publishedAt: entity.publishedAt,
    scheduledAt: entity.scheduledAt,
    attachments: entity.attachments,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
  };
}

export function classworkTopicEntityToDto(entity: ClassworkTopic): ClassworkTopicResponseDto {
  return {
    topicId: entity.topicId,
    sectionId: entity.sectionId,
    schoolId: entity.schoolId,
    name: entity.name,
    sortOrder: entity.sortOrder,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

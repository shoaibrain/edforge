/**
 * Education Service Center (ESC) Schemas - Identity Service
 *
 * Zod schemas for Education Service Center CRUD operations.
 * ESCs are regional service agencies that support LEAs and schools.
 *
 * Ed-Fi: EducationServiceCenter
 * https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { operationalStatusDescriptorSchema } from './education-org-descriptors';
import {
  educationOrgAddressSchema,
  educationOrgIdentificationCodeSchema,
  institutionTelephoneSchema,
  educationOrgCategorySchema,
  accountabilityRatingSchema,
} from './education-organization.schema';

// ============================================
// Create ESC Schema
// ============================================

export const createEducationServiceCenterSchema = z.object({
  // Ed-Fi Core Fields
  educationServiceCenterId: z.number().int().positive(),         // Ed-Fi: educationServiceCenterId (numeric)
  nameOfInstitution: z.string().min(1).max(75),                  // Ed-Fi: nameOfInstitution
  shortNameOfInstitution: z.string().max(75).optional(),         // Ed-Fi: shortNameOfInstitution
  webSite: z.string().url().optional(),                          // Ed-Fi: webSite

  // Status
  operationalStatusDescriptor: operationalStatusDescriptorSchema.default('Active'),

  // Hierarchy References
  stateEducationAgencyId: z.string().uuid().optional(),          // Parent SEA reference

  // Ed-Fi Sub-Collections
  categories: z.array(educationOrgCategorySchema).min(1),
  addresses: z.array(educationOrgAddressSchema).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  telephones: z.array(institutionTelephoneSchema).optional(),
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),
});

export type CreateEducationServiceCenterDto = z.infer<typeof createEducationServiceCenterSchema>;

// ============================================
// Update ESC Schema
// ============================================

export const updateEducationServiceCenterSchema = createEducationServiceCenterSchema.partial().omit({
  educationServiceCenterId: true, // Cannot change the Ed-Fi ID
});

export type UpdateEducationServiceCenterDto = z.infer<typeof updateEducationServiceCenterSchema>;

// ============================================
// ESC Response Schema
// ============================================

export const escResponseSchema = z.object({
  // Identifiers
  id: z.string().uuid(),                                         // Internal UUID
  educationServiceCenterId: z.number().int(),                    // Ed-Fi numeric ID
  tenantId: z.string().uuid(),

  // Ed-Fi Fields
  nameOfInstitution: z.string(),
  shortNameOfInstitution: z.string().optional(),
  webSite: z.string().optional(),
  operationalStatusDescriptor: operationalStatusDescriptorSchema,

  // Hierarchy References
  stateEducationAgencyId: z.string().uuid().optional(),

  // Sub-Collections
  categories: z.array(educationOrgCategorySchema),
  addresses: z.array(educationOrgAddressSchema).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  telephones: z.array(institutionTelephoneSchema).optional(),
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int().min(0),
});

export type EscResponseDto = z.infer<typeof escResponseSchema>;

// ============================================
// ESC List Response
// ============================================

export const escListResponseSchema = createPaginatedResponseSchema(escResponseSchema);
export type EscListResponseDto = z.infer<typeof escListResponseSchema>;

// ============================================
// ESC Filter Schema
// ============================================

export const escFilterSchema = z.object({
  seaId: z.string().uuid().optional(),                           // Filter by parent SEA
  operationalStatus: operationalStatusDescriptorSchema.optional(),
  search: z.string().optional(),                                 // Name search
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type EscFilterDto = z.infer<typeof escFilterSchema>;

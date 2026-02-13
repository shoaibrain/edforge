/**
 * Local Education Agency (LEA) Schemas - Identity Service
 *
 * Zod schemas for Local Education Agency (school district) CRUD operations.
 * LEAs sit below the SEA in the Ed-Fi hierarchy and contain schools.
 *
 * Ed-Fi: LocalEducationAgency
 * https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import {
  operationalStatusDescriptorSchema,
  leaCategoryDescriptorSchema,
  charterStatusDescriptorSchema,
} from './education-org-descriptors';
import {
  educationOrgAddressSchema,
  educationOrgIdentificationCodeSchema,
  institutionTelephoneSchema,
  educationOrgCategorySchema,
  accountabilityRatingSchema,
} from './education-organization.schema';

// ============================================
// Create LEA Schema
// ============================================

export const createLocalEducationAgencySchema = z.object({
  // Ed-Fi Core Fields
  localEducationAgencyId: z.number().int().positive(),           // Ed-Fi: localEducationAgencyId (numeric)
  nameOfInstitution: z.string().min(1).max(75),                  // Ed-Fi: nameOfInstitution
  shortNameOfInstitution: z.string().max(75).optional(),         // Ed-Fi: shortNameOfInstitution
  webSite: z.string().url().optional(),                          // Ed-Fi: webSite

  // LEA-Specific Fields
  leaCategoryDescriptor: leaCategoryDescriptorSchema,            // Ed-Fi: localEducationAgencyCategoryDescriptor
  charterStatusDescriptor: charterStatusDescriptorSchema.optional(), // Ed-Fi: charterStatusDescriptor

  // Status
  operationalStatusDescriptor: operationalStatusDescriptorSchema.default('Active'),

  // Hierarchy References (UUIDs — internal IDs)
  stateEducationAgencyId: z.string().uuid().optional(),          // Parent SEA reference
  educationServiceCenterId: z.string().uuid().optional(),        // Associated ESC reference
  parentLocalEducationAgencyId: z.string().uuid().optional(),    // Parent LEA (for intermediate LEAs)

  // Ed-Fi Sub-Collections
  categories: z.array(educationOrgCategorySchema).min(1),
  addresses: z.array(educationOrgAddressSchema).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  telephones: z.array(institutionTelephoneSchema).optional(),
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),
});

export type CreateLocalEducationAgencyDto = z.infer<typeof createLocalEducationAgencySchema>;

// ============================================
// Update LEA Schema
// ============================================

export const updateLocalEducationAgencySchema = createLocalEducationAgencySchema.partial().omit({
  localEducationAgencyId: true, // Cannot change the Ed-Fi ID
});

export type UpdateLocalEducationAgencyDto = z.infer<typeof updateLocalEducationAgencySchema>;

// ============================================
// LEA Response Schema
// ============================================

export const leaResponseSchema = z.object({
  // Identifiers
  id: z.string().uuid(),                                         // Internal UUID
  localEducationAgencyId: z.number().int(),                      // Ed-Fi numeric ID
  tenantId: z.string().uuid(),

  // Ed-Fi Fields
  nameOfInstitution: z.string(),
  shortNameOfInstitution: z.string().optional(),
  webSite: z.string().optional(),
  leaCategoryDescriptor: leaCategoryDescriptorSchema,
  charterStatusDescriptor: charterStatusDescriptorSchema.optional(),
  operationalStatusDescriptor: operationalStatusDescriptorSchema,

  // Hierarchy References
  stateEducationAgencyId: z.string().uuid().optional(),
  educationServiceCenterId: z.string().uuid().optional(),
  parentLocalEducationAgencyId: z.string().uuid().optional(),

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

export type LeaResponseDto = z.infer<typeof leaResponseSchema>;

// ============================================
// LEA List Response
// ============================================

export const leaListResponseSchema = createPaginatedResponseSchema(leaResponseSchema);
export type LeaListResponseDto = z.infer<typeof leaListResponseSchema>;

// ============================================
// LEA Filter Schema
// ============================================

export const leaFilterSchema = z.object({
  seaId: z.string().uuid().optional(),                           // Filter by parent SEA
  escId: z.string().uuid().optional(),                           // Filter by associated ESC
  leaCategoryDescriptor: leaCategoryDescriptorSchema.optional(),
  operationalStatus: operationalStatusDescriptorSchema.optional(),
  search: z.string().optional(),                                 // Name search
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type LeaFilterDto = z.infer<typeof leaFilterSchema>;

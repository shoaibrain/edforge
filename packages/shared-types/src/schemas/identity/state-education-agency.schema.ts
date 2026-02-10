/**
 * State Education Agency (SEA) Schemas - Identity Service
 *
 * Zod schemas for State Education Agency CRUD operations.
 * SEA is the root entity in the Ed-Fi education organization hierarchy.
 * One SEA per tenant (singleton).
 *
 * Ed-Fi: StateEducationAgency
 * https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/
 */

import { z } from 'zod';
import { isoDateSchema } from '../common';
import { operationalStatusDescriptorSchema } from './education-org-descriptors';
import {
  educationOrgAddressSchema,
  educationOrgIdentificationCodeSchema,
  institutionTelephoneSchema,
  educationOrgCategorySchema,
  accountabilityRatingSchema,
} from './education-organization.schema';

// ============================================
// Create SEA Schema
// ============================================

export const createStateEducationAgencySchema = z.object({
  // Ed-Fi Core Fields
  stateEducationAgencyId: z.number().int().positive(),           // Ed-Fi: stateEducationAgencyId (numeric)
  nameOfInstitution: z.string().min(1).max(75),                  // Ed-Fi: nameOfInstitution
  shortNameOfInstitution: z.string().max(75).optional(),         // Ed-Fi: shortNameOfInstitution
  webSite: z.string().url().optional(),                          // Ed-Fi: webSite

  // Status
  operationalStatusDescriptor: operationalStatusDescriptorSchema.default('Active'),

  // Ed-Fi Sub-Collections
  categories: z.array(educationOrgCategorySchema).min(1),
  addresses: z.array(educationOrgAddressSchema).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  telephones: z.array(institutionTelephoneSchema).optional(),
  accountabilityRatings: z.array(accountabilityRatingSchema).optional(),
});

export type CreateStateEducationAgencyDto = z.infer<typeof createStateEducationAgencySchema>;

// ============================================
// Update SEA Schema
// ============================================

export const updateStateEducationAgencySchema = createStateEducationAgencySchema.partial().omit({
  stateEducationAgencyId: true, // Cannot change the Ed-Fi ID
});

export type UpdateStateEducationAgencyDto = z.infer<typeof updateStateEducationAgencySchema>;

// ============================================
// SEA Response Schema
// ============================================

export const seaResponseSchema = z.object({
  // Identifiers
  id: z.string().uuid(),                                         // Internal UUID
  stateEducationAgencyId: z.number().int(),                      // Ed-Fi numeric ID
  tenantId: z.string().uuid(),

  // Ed-Fi Fields
  nameOfInstitution: z.string(),
  shortNameOfInstitution: z.string().optional(),
  webSite: z.string().optional(),
  operationalStatusDescriptor: operationalStatusDescriptorSchema,

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

export type SeaResponseDto = z.infer<typeof seaResponseSchema>;

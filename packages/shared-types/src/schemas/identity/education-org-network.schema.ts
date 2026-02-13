/**
 * Education Organization Network Schemas - Identity Service
 *
 * Zod schemas for EducationOrganizationNetwork and NetworkAssociation CRUD operations.
 * Networks group education organizations for reporting, collaboration, or governance.
 *
 * Ed-Fi: EducationOrganizationNetwork
 * https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/
 */

import { z } from 'zod';
import { isoDateSchema, dateSchema, createPaginatedResponseSchema } from '../common';
import { operationalStatusDescriptorSchema } from './education-org-descriptors';
import {
  educationOrgAddressSchema,
  educationOrgIdentificationCodeSchema,
  institutionTelephoneSchema,
  educationOrgCategorySchema,
  educationOrgTypeSchema,
} from './education-organization.schema';

// ============================================
// Network Purpose Descriptor
// ============================================

export const NETWORK_PURPOSE_DESCRIPTORS = [
  { value: 'Collaborative', label: 'Collaborative', uri: 'uri://ed-fi.org/NetworkPurposeDescriptor#Collaborative' },
  { value: 'Disciplinary', label: 'Disciplinary', uri: 'uri://ed-fi.org/NetworkPurposeDescriptor#Disciplinary' },
  { value: 'Governance', label: 'Governance', uri: 'uri://ed-fi.org/NetworkPurposeDescriptor#Governance' },
  { value: 'Shared Services', label: 'Shared Services', uri: 'uri://ed-fi.org/NetworkPurposeDescriptor#Shared Services' },
  { value: 'Other', label: 'Other', uri: 'uri://ed-fi.org/NetworkPurposeDescriptor#Other' },
] as const;

export const networkPurposeDescriptorSchema = z.enum([
  'Collaborative',
  'Disciplinary',
  'Governance',
  'Shared Services',
  'Other',
]);
export type NetworkPurposeDescriptor = z.infer<typeof networkPurposeDescriptorSchema>;

// ============================================
// Create Network Schema
// ============================================

export const createEducationOrgNetworkSchema = z.object({
  // Ed-Fi Core Fields
  educationOrganizationNetworkId: z.number().int().positive(),
  nameOfInstitution: z.string().min(1).max(75),
  shortNameOfInstitution: z.string().max(75).optional(),
  webSite: z.string().url().optional(),

  // Network-specific
  networkPurposeDescriptor: networkPurposeDescriptorSchema,

  // Status
  operationalStatusDescriptor: operationalStatusDescriptorSchema.default('Active'),

  // Ed-Fi Sub-Collections
  categories: z.array(educationOrgCategorySchema).min(1),
  addresses: z.array(educationOrgAddressSchema).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  telephones: z.array(institutionTelephoneSchema).optional(),
});
export type CreateEducationOrgNetworkDto = z.infer<typeof createEducationOrgNetworkSchema>;

// ============================================
// Update Network Schema
// ============================================

export const updateEducationOrgNetworkSchema = createEducationOrgNetworkSchema.partial().omit({
  educationOrganizationNetworkId: true,
});
export type UpdateEducationOrgNetworkDto = z.infer<typeof updateEducationOrgNetworkSchema>;

// ============================================
// Network Response Schema
// ============================================

export const networkResponseSchema = z.object({
  // Identifiers
  id: z.string().uuid(),
  educationOrganizationNetworkId: z.number().int(),
  tenantId: z.string().uuid(),

  // Ed-Fi Fields
  nameOfInstitution: z.string(),
  shortNameOfInstitution: z.string().optional(),
  webSite: z.string().optional(),
  networkPurposeDescriptor: networkPurposeDescriptorSchema,
  operationalStatusDescriptor: operationalStatusDescriptorSchema,

  // Sub-Collections
  categories: z.array(educationOrgCategorySchema),
  addresses: z.array(educationOrgAddressSchema).optional(),
  identificationCodes: z.array(educationOrgIdentificationCodeSchema).optional(),
  telephones: z.array(institutionTelephoneSchema).optional(),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int().min(0),
});
export type NetworkResponseDto = z.infer<typeof networkResponseSchema>;

// ============================================
// Network List Response
// ============================================

export const networkListResponseSchema = createPaginatedResponseSchema(networkResponseSchema);
export type NetworkListResponseDto = z.infer<typeof networkListResponseSchema>;

// ============================================
// Network Filter Schema
// ============================================

export const networkFilterSchema = z.object({
  networkPurpose: networkPurposeDescriptorSchema.optional(),
  operationalStatus: operationalStatusDescriptorSchema.optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type NetworkFilterDto = z.infer<typeof networkFilterSchema>;

// ============================================
// Network Association (Membership)
// ============================================

export const createNetworkAssociationSchema = z.object({
  networkId: z.string().uuid(),
  memberEducationOrganizationId: z.string().uuid(),
  memberType: educationOrgTypeSchema,
  beginDate: dateSchema,
  endDate: dateSchema.optional(),
});
export type CreateNetworkAssociationDto = z.infer<typeof createNetworkAssociationSchema>;

export const updateNetworkAssociationSchema = z.object({
  endDate: dateSchema.optional(),
});
export type UpdateNetworkAssociationDto = z.infer<typeof updateNetworkAssociationSchema>;

export const networkAssociationResponseSchema = z.object({
  id: z.string().uuid(),
  networkId: z.string().uuid(),
  memberEducationOrganizationId: z.string().uuid(),
  memberType: educationOrgTypeSchema,
  memberName: z.string(),
  beginDate: dateSchema,
  endDate: dateSchema.optional(),
  tenantId: z.string().uuid(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type NetworkAssociationResponseDto = z.infer<typeof networkAssociationResponseSchema>;

export const networkAssociationListResponseSchema = createPaginatedResponseSchema(
  networkAssociationResponseSchema,
);
export type NetworkAssociationListResponseDto = z.infer<typeof networkAssociationListResponseSchema>;

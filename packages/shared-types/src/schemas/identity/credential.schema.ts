/**
 * Credential Schemas - Identity Service
 * 
 * Zod schemas for staff credential management with Ed-Fi alignment.
 * Ed-Fi: Credential represents teaching licenses, certifications, endorsements.
 */

import { z } from 'zod';
import { 
  dateSchema, 
  isoDateSchema,
  createPaginatedResponseSchema 
} from '../common';

// ============================================
// Enums (Ed-Fi aligned)
// ============================================

/**
 * Credential type (Ed-Fi: credentialTypeDescriptor)
 */
export const credentialTypeSchema = z.enum([
  'certification',         // Teaching certification
  'license',               // Professional license
  'endorsement',           // Subject/grade endorsement
  'degree',                // Academic degree
  'registration',          // Professional registration
  'permit',                // Work permit
  'clearance',             // Background clearance
  'training',              // Training completion
  'other',
]);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

/**
 * Credential field/subject area (Ed-Fi: credentialFieldDescriptor)
 */
export const credentialFieldSchema = z.enum([
  'elementary_education',
  'secondary_education',
  'special_education',
  'early_childhood',
  'mathematics',
  'science',
  'english_language_arts',
  'social_studies',
  'foreign_language',
  'physical_education',
  'music',
  'art',
  'technology',
  'counseling',
  'administration',
  'library_media',
  'other',
]);
export type CredentialField = z.infer<typeof credentialFieldSchema>;

/**
 * Verification status
 */
export const verificationStatusSchema = z.enum([
  'pending',
  'verified',
  'rejected',
  'expired',
  'revoked',
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

/**
 * Grade level (Ed-Fi aligned)
 */
export const gradeLevelDescriptorSchema = z.enum([
  'pre_k',
  'kindergarten',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'adult_education',
  'ungraded',
]);
export type GradeLevelDescriptor = z.infer<typeof gradeLevelDescriptorSchema>;

// ============================================
// Create Credential Schema
// ============================================

export const createCredentialSchema = z.object({
  // Ed-Fi Core Fields
  credentialIdentifier: z.string().min(1).max(60),     // Ed-Fi: credentialIdentifier
  credentialTypeDescriptor: credentialTypeSchema,       // Ed-Fi: credentialTypeDescriptor
  credentialFieldDescriptor: credentialFieldSchema.optional(), // Ed-Fi: credentialFieldDescriptor
  issuanceDate: dateSchema,                             // Ed-Fi: issuanceDate
  expirationDate: dateSchema.optional(),                // Ed-Fi: expirationDate
  
  // Issuing Authority (Ed-Fi: stateOfIssueStateAbbreviationDescriptor)
  issuingState: z.string().max(50).optional(),
  issuingOrganization: z.string().max(150),
  
  // Grade Levels (Ed-Fi: credentialGradeLevels)
  gradeLevels: z.array(gradeLevelDescriptorSchema).optional(),
  
  // Academic Subjects (simplified)
  subjects: z.array(z.string().max(60)).optional(),
  
  // EdForge Extensions
  name: z.string().min(1).max(150),                    // Human-readable name
  description: z.string().max(500).optional(),
  documentUrl: z.string().url().optional(),            // Link to scanned document
  documentFileName: z.string().max(255).optional(),
  
  // Verification
  verificationStatus: verificationStatusSchema.default('pending'),
  verificationNotes: z.string().max(500).optional(),
  verifiedBy: z.string().uuid().optional(),
  verifiedAt: isoDateSchema.optional(),
  
  // Renewal tracking
  isRenewable: z.boolean().default(true),
  renewalReminderDays: z.number().int().min(0).max(365).default(90),
});

export type CreateCredentialDto = z.infer<typeof createCredentialSchema>;

// ============================================
// Update Credential Schema
// ============================================

export const updateCredentialSchema = createCredentialSchema.partial().omit({
  credentialIdentifier: true,  // Cannot change identifier
}).extend({
  verificationStatus: verificationStatusSchema.optional(),
});

export type UpdateCredentialDto = z.infer<typeof updateCredentialSchema>;

// ============================================
// Credential Response Schema
// ============================================

export const credentialResponseSchema = z.object({
  // Identifiers
  credentialId: z.string().uuid(),
  staffId: z.string().uuid(),
  tenantId: z.string().uuid(),
  
  // Ed-Fi Core
  credentialIdentifier: z.string(),
  credentialTypeDescriptor: credentialTypeSchema,
  credentialFieldDescriptor: credentialFieldSchema.optional(),
  issuanceDate: z.string(),
  expirationDate: z.string().optional(),
  
  // Issuing Authority
  issuingState: z.string().optional(),
  issuingOrganization: z.string(),
  
  // Grade Levels & Subjects
  gradeLevels: z.array(gradeLevelDescriptorSchema).optional(),
  subjects: z.array(z.string()).optional(),
  
  // EdForge Extensions
  name: z.string(),
  description: z.string().optional(),
  documentUrl: z.string().optional(),
  documentFileName: z.string().optional(),
  
  // Verification
  verificationStatus: verificationStatusSchema,
  verificationNotes: z.string().optional(),
  verifiedBy: z.string().optional(),
  verifiedByName: z.string().optional(),
  verifiedAt: z.string().optional(),
  
  // Renewal
  isRenewable: z.boolean(),
  renewalReminderDays: z.number(),
  
  // Computed
  isExpired: z.boolean(),
  daysUntilExpiration: z.number().optional(),
  isExpiringSoon: z.boolean(),  // Within renewal reminder period
  
  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CredentialResponseDto = z.infer<typeof credentialResponseSchema>;

// ============================================
// Credential List Response
// ============================================

export const credentialListResponseSchema = createPaginatedResponseSchema(credentialResponseSchema);
export type CredentialListResponseDto = z.infer<typeof credentialListResponseSchema>;

// ============================================
// Credential Filter Schema
// ============================================

export const credentialFilterSchema = z.object({
  staffId: z.string().uuid().optional(),
  credentialType: credentialTypeSchema.optional(),
  credentialField: credentialFieldSchema.optional(),
  verificationStatus: verificationStatusSchema.optional(),
  isExpired: z.boolean().optional(),
  isExpiringSoon: z.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CredentialFilterDto = z.infer<typeof credentialFilterSchema>;

// ============================================
// Verify Credential Schema
// ============================================

export const verifyCredentialSchema = z.object({
  verificationStatus: z.enum(['verified', 'rejected']),
  verificationNotes: z.string().max(500).optional(),
});

export type VerifyCredentialDto = z.infer<typeof verifyCredentialSchema>;

// ============================================
// Credential Expiration Alert
// ============================================

export const credentialExpirationAlertSchema = z.object({
  credentialId: z.string().uuid(),
  staffId: z.string().uuid(),
  staffName: z.string(),
  credentialName: z.string(),
  expirationDate: z.string(),
  daysUntilExpiration: z.number(),
  schoolId: z.string().uuid(),
  schoolName: z.string(),
});

export type CredentialExpirationAlertDto = z.infer<typeof credentialExpirationAlertSchema>;

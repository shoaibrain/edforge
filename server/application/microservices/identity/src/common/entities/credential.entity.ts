/**
 * Credential Entity - Identity Service
 * 
 * DynamoDB Entity for Staff credential/certification management with Ed-Fi alignment.
 * 
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: STAFF#{staffId}#CRED#{credentialId}
 * 
 * GSI1 (Credential Type Lookup):
 * - gsi1pk: CREDTYPE#{credentialTypeDescriptor}
 * - gsi1sk: EXPIRY#{expirationDate}
 *
 * Sprint S3.2 — GSI1 attribute names lowercased to match the DDB index
 * definition (server/lib/tenant-template/ecs-dynamodb.ts:53-54). The
 * uppercase variant silently failed to populate the GSI since this entity
 * was first written. Companion fix to S3.1 (calendar-date).
 */

import { BaseEntity } from './base.entity';

// ============================================
// Credential Types (Ed-Fi aligned)
// ============================================

export type CredentialType = 
  | 'certification'
  | 'license'
  | 'endorsement'
  | 'degree'
  | 'registration'
  | 'permit'
  | 'clearance'
  | 'training'
  | 'other';

export type CredentialField = 
  | 'elementary_education'
  | 'secondary_education'
  | 'special_education'
  | 'early_childhood'
  | 'mathematics'
  | 'science'
  | 'english_language_arts'
  | 'social_studies'
  | 'foreign_language'
  | 'physical_education'
  | 'music'
  | 'art'
  | 'technology'
  | 'counseling'
  | 'administration'
  | 'library_media'
  | 'other';

export type VerificationStatus = 
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'revoked';

export type GradeLevelDescriptor = 
  | 'pre_k'
  | 'kindergarten'
  | 'first'
  | 'second'
  | 'third'
  | 'fourth'
  | 'fifth'
  | 'sixth'
  | 'seventh'
  | 'eighth'
  | 'ninth'
  | 'tenth'
  | 'eleventh'
  | 'twelfth'
  | 'adult_education'
  | 'ungraded';

// ============================================
// Credential Entity Interface
// ============================================

export interface Credential extends BaseEntity {
  entityType: 'CREDENTIAL';
  
  // Identifiers
  credentialId: string;
  staffId: string;
  
  // Ed-Fi Core Fields
  credentialIdentifier: string;           // Ed-Fi: unique credential ID
  credentialTypeDescriptor: CredentialType;
  credentialFieldDescriptor?: CredentialField;
  issuanceDate: string;                   // YYYY-MM-DD
  expirationDate?: string;                // YYYY-MM-DD
  
  // Issuing Authority
  issuingState?: string;
  issuingOrganization: string;
  
  // Grade Levels & Subjects
  gradeLevels?: GradeLevelDescriptor[];
  subjects?: string[];
  
  // EdForge Extensions
  name: string;                           // Human-readable name
  description?: string;
  documentUrl?: string;                   // S3 URL for scanned document
  documentFileName?: string;
  
  // Verification
  verificationStatus: VerificationStatus;
  verificationNotes?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  
  // Renewal
  isRenewable: boolean;
  renewalReminderDays: number;
  
  // GSI Keys — see entity-header comment for the S3.2 casing rename rationale.
  gsi1pk?: string;  // CREDTYPE#{credentialTypeDescriptor}
  gsi1sk?: string;  // EXPIRY#{expirationDate}
}

// ============================================
// Entity Key Builders
// ============================================

export const CredentialKeyBuilder = {
  /**
   * Credential: STAFF#{staffId}#CRED#{credentialId}
   */
  credential: (staffId: string, credentialId: string): string => 
    `STAFF#${staffId}#CRED#${credentialId}`,
  
  /**
   * Credentials for staff (prefix): STAFF#{staffId}#CRED#
   */
  credentialsPrefix: (staffId: string): string => 
    `STAFF#${staffId}#CRED#`,
  
  /**
   * gsi1pk (Type lookup): CREDTYPE#{type}
   */
  typeLookup: (credentialType: CredentialType): string =>
    `CREDTYPE#${credentialType}`,

  /**
   * gsi1sk (Expiry): EXPIRY#{date}
   */
  expirySort: (expirationDate: string): string => 
    `EXPIRY#${expirationDate || '9999-12-31'}`,  // Far future for no expiry
};

// ============================================
// Factory Function
// ============================================

export function createCredentialEntity(
  tenantId: string,
  staffId: string,
  credentialId: string,
  data: Omit<Credential, 'tenantId' | 'entityKey' | 'entityType' | 'credentialId' | 'staffId' | 'gsi1pk' | 'gsi1sk'>
): Credential {
  return {
    tenantId,
    entityKey: CredentialKeyBuilder.credential(staffId, credentialId),
    entityType: 'CREDENTIAL',
    credentialId,
    staffId,
    ...data,
    // GSI Keys
    gsi1pk: CredentialKeyBuilder.typeLookup(data.credentialTypeDescriptor),
    gsi1sk: CredentialKeyBuilder.expirySort(data.expirationDate || ''),
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if a credential is expired
 */
export function isCredentialExpired(credential: Credential): boolean {
  if (!credential.expirationDate) return false;
  return new Date(credential.expirationDate) < new Date();
}

/**
 * Check if a credential is expiring soon (within reminder period)
 */
export function isCredentialExpiringSoon(credential: Credential): boolean {
  if (!credential.expirationDate) return false;
  
  const expiryDate = new Date(credential.expirationDate);
  const today = new Date();
  const daysUntilExpiry = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  return daysUntilExpiry >= 0 && daysUntilExpiry <= credential.renewalReminderDays;
}

/**
 * Calculate days until expiration
 */
export function daysUntilExpiration(credential: Credential): number | undefined {
  if (!credential.expirationDate) return undefined;
  
  const expiryDate = new Date(credential.expirationDate);
  const today = new Date();
  return Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

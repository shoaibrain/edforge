/**
 * Credential Ed-Fi Mapper
 * 
 * Converts EdForge Credential data to Ed-Fi Data Standard format.
 * Ed-Fi Data Standard v6.0
 */

import type { CredentialResponseDto } from '../../schemas/identity/credential.schema';

/**
 * Ed-Fi Credential Resource
 * Based on Ed-Fi Data Standard v6.0 Credential resource
 */
export interface EdFiCredential {
  credentialIdentifier: string;
  stateOfIssueStateAbbreviationDescriptor?: string;
  credentialFieldDescriptor?: string;
  credentialTypeDescriptor: string;
  issuanceDate: string;
  expirationDate?: string;
  namespace?: string;
  gradeLevels?: EdFiCredentialGradeLevel[];
  academicSubjects?: EdFiCredentialAcademicSubject[];
  endorsements?: EdFiCredentialEndorsement[];
  _ext?: EdForgeCredentialExtension;
}

export interface EdFiCredentialGradeLevel {
  gradeLevelDescriptor: string;
}

export interface EdFiCredentialAcademicSubject {
  academicSubjectDescriptor: string;
}

export interface EdFiCredentialEndorsement {
  credentialEndorsement: string;
}

export interface EdForgeCredentialExtension {
  edforge_credentialId: string;
  edforge_staffId: string;
  edforge_tenantId: string;
  edforge_verificationStatus: string;
  edforge_isRenewable: boolean;
  edforge_renewalReminderDays: number;
}

/**
 * Map EdForge credential type to Ed-Fi credentialTypeDescriptor
 */
function mapCredentialTypeToEdFi(type: string): string {
  const typeMap: Record<string, string> = {
    'certification': 'uri://ed-fi.org/CredentialTypeDescriptor#Certification',
    'license': 'uri://ed-fi.org/CredentialTypeDescriptor#Licensure',
    'endorsement': 'uri://ed-fi.org/CredentialTypeDescriptor#Endorsement',
    'degree': 'uri://ed-fi.org/CredentialTypeDescriptor#Other',
    'registration': 'uri://ed-fi.org/CredentialTypeDescriptor#Registration',
    'permit': 'uri://ed-fi.org/CredentialTypeDescriptor#Other',
    'clearance': 'uri://ed-fi.org/CredentialTypeDescriptor#Other',
    'training': 'uri://ed-fi.org/CredentialTypeDescriptor#Other',
    'other': 'uri://ed-fi.org/CredentialTypeDescriptor#Other',
  };
  return typeMap[type] || 'uri://ed-fi.org/CredentialTypeDescriptor#Other';
}

/**
 * Map EdForge credential field to Ed-Fi credentialFieldDescriptor
 */
function mapCredentialFieldToEdFi(field?: string): string | undefined {
  if (!field) return undefined;
  
  const fieldMap: Record<string, string> = {
    'elementary_education': 'uri://ed-fi.org/CredentialFieldDescriptor#Elementary Education',
    'secondary_education': 'uri://ed-fi.org/CredentialFieldDescriptor#Secondary Education',
    'special_education': 'uri://ed-fi.org/CredentialFieldDescriptor#Special Education',
    'early_childhood': 'uri://ed-fi.org/CredentialFieldDescriptor#Early Childhood Education',
    'mathematics': 'uri://ed-fi.org/CredentialFieldDescriptor#Mathematics',
    'science': 'uri://ed-fi.org/CredentialFieldDescriptor#Science',
    'english_language_arts': 'uri://ed-fi.org/CredentialFieldDescriptor#English Language Arts',
    'social_studies': 'uri://ed-fi.org/CredentialFieldDescriptor#Social Studies',
    'foreign_language': 'uri://ed-fi.org/CredentialFieldDescriptor#Foreign Language',
    'physical_education': 'uri://ed-fi.org/CredentialFieldDescriptor#Physical Education',
    'music': 'uri://ed-fi.org/CredentialFieldDescriptor#Music',
    'art': 'uri://ed-fi.org/CredentialFieldDescriptor#Art',
    'technology': 'uri://ed-fi.org/CredentialFieldDescriptor#Technology Education',
    'counseling': 'uri://ed-fi.org/CredentialFieldDescriptor#School Counseling',
    'administration': 'uri://ed-fi.org/CredentialFieldDescriptor#School Administration',
    'library_media': 'uri://ed-fi.org/CredentialFieldDescriptor#Library/Media',
    'other': 'uri://ed-fi.org/CredentialFieldDescriptor#Other',
  };
  return fieldMap[field] || 'uri://ed-fi.org/CredentialFieldDescriptor#Other';
}

/**
 * Map EdForge grade level to Ed-Fi gradeLevelDescriptor
 */
function mapGradeLevelToEdFi(gradeLevel: string): string {
  const levelMap: Record<string, string> = {
    'pre_k': 'uri://ed-fi.org/GradeLevelDescriptor#Preschool/Prekindergarten',
    'kindergarten': 'uri://ed-fi.org/GradeLevelDescriptor#Kindergarten',
    'first': 'uri://ed-fi.org/GradeLevelDescriptor#First grade',
    'second': 'uri://ed-fi.org/GradeLevelDescriptor#Second grade',
    'third': 'uri://ed-fi.org/GradeLevelDescriptor#Third grade',
    'fourth': 'uri://ed-fi.org/GradeLevelDescriptor#Fourth grade',
    'fifth': 'uri://ed-fi.org/GradeLevelDescriptor#Fifth grade',
    'sixth': 'uri://ed-fi.org/GradeLevelDescriptor#Sixth grade',
    'seventh': 'uri://ed-fi.org/GradeLevelDescriptor#Seventh grade',
    'eighth': 'uri://ed-fi.org/GradeLevelDescriptor#Eighth grade',
    'ninth': 'uri://ed-fi.org/GradeLevelDescriptor#Ninth grade',
    'tenth': 'uri://ed-fi.org/GradeLevelDescriptor#Tenth grade',
    'eleventh': 'uri://ed-fi.org/GradeLevelDescriptor#Eleventh grade',
    'twelfth': 'uri://ed-fi.org/GradeLevelDescriptor#Twelfth grade',
    'adult_education': 'uri://ed-fi.org/GradeLevelDescriptor#Adult Education',
    'ungraded': 'uri://ed-fi.org/GradeLevelDescriptor#Ungraded',
  };
  return levelMap[gradeLevel] || 'uri://ed-fi.org/GradeLevelDescriptor#Other';
}

/**
 * Convert EdForge Credential to Ed-Fi Credential format
 */
export function toEdFiCredential(credential: CredentialResponseDto): EdFiCredential {
  const edfiCredential: EdFiCredential = {
    credentialIdentifier: credential.credentialIdentifier,
    credentialTypeDescriptor: mapCredentialTypeToEdFi(credential.credentialTypeDescriptor),
    credentialFieldDescriptor: mapCredentialFieldToEdFi(credential.credentialFieldDescriptor),
    issuanceDate: credential.issuanceDate,
    expirationDate: credential.expirationDate,
    stateOfIssueStateAbbreviationDescriptor: credential.issuingState 
      ? `uri://ed-fi.org/StateAbbreviationDescriptor#${credential.issuingState}`
      : undefined,
    namespace: 'uri://edforge.io/Credential',
  };

  // Map grade levels
  if (credential.gradeLevels && credential.gradeLevels.length > 0) {
    edfiCredential.gradeLevels = credential.gradeLevels.map(gl => ({
      gradeLevelDescriptor: mapGradeLevelToEdFi(gl),
    }));
  }

  // Map subjects to academic subjects
  if (credential.subjects && credential.subjects.length > 0) {
    edfiCredential.academicSubjects = credential.subjects.map(subject => ({
      academicSubjectDescriptor: `uri://ed-fi.org/AcademicSubjectDescriptor#${subject}`,
    }));
  }

  // EdForge extension data
  edfiCredential._ext = {
    edforge_credentialId: credential.credentialId,
    edforge_staffId: credential.staffId,
    edforge_tenantId: credential.tenantId,
    edforge_verificationStatus: credential.verificationStatus,
    edforge_isRenewable: credential.isRenewable,
    edforge_renewalReminderDays: credential.renewalReminderDays,
  };

  return edfiCredential;
}

/**
 * Batch convert EdForge Credentials to Ed-Fi format
 */
export function toEdFiCredentialBatch(credentials: CredentialResponseDto[]): EdFiCredential[] {
  return credentials.map(toEdFiCredential);
}

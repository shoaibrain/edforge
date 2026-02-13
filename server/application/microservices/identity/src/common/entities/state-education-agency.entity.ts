/**
 * State Education Agency (SEA) Entity - Identity Service
 *
 * DynamoDB Entity for the root education organization in a tenant.
 * One SEA per tenant (singleton).
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SEA#{seaId}
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

// ============================================
// SEA Sub-Types (match shared-types schemas)
// ============================================

export interface EdOrgAddress {
  addressTypeDescriptor: string;
  streetNumberName: string;
  apartmentRoomSuiteNumber?: string;
  city: string;
  stateAbbreviationDescriptor: string;
  postalCode: string;
  nameOfCounty?: string;
  countyFIPSCode?: string;
  latitude?: string;
  longitude?: string;
}

export interface EdOrgIdentificationCode {
  identificationCode: string;
  educationOrganizationIdentificationSystemDescriptor: string;
}

export interface InstitutionTelephone {
  telephoneNumber: string;
  institutionTelephoneNumberTypeDescriptor: string;
}

export interface EdOrgCategory {
  educationOrganizationCategoryDescriptor: string;
}

export interface AccountabilityRating {
  schoolYear: number;
  title: string;
  rating: string;
  ratingOrganization?: string;
  ratingDate?: string;
}

// ============================================
// SEA Entity Interface
// ============================================

export interface StateEducationAgency extends BaseEntity {
  entityType: 'STATE_EDUCATION_AGENCY';

  // Identifiers
  id: string;                                 // Internal UUID
  stateEducationAgencyId: number;             // Ed-Fi numeric ID

  // Ed-Fi Core Fields
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;

  // Ed-Fi Sub-Collections
  categories: EdOrgCategory[];
  addresses?: EdOrgAddress[];
  identificationCodes?: EdOrgIdentificationCode[];
  telephones?: InstitutionTelephone[];
  accountabilityRatings?: AccountabilityRating[];
}

// ============================================
// Factory Function
// ============================================

export function createSEAEntity(
  tenantId: string,
  seaId: string,
  data: Omit<StateEducationAgency, 'tenantId' | 'entityKey' | 'entityType' | 'id'>
): StateEducationAgency {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.sea(seaId),
    entityType: 'STATE_EDUCATION_AGENCY',
    id: seaId,
    ...data,
  };
}

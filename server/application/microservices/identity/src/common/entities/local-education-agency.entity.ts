/**
 * Local Education Agency (LEA) Entity - Identity Service
 *
 * DynamoDB Entity for school districts / local education agencies.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: LEA#{leaId}
 * - GSI1PK: TENANT#{tenantId}#SEA#{seaId}  (query LEAs by parent SEA)
 * - GSI1SK: LEA#{leaId}
 */

import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import {
  EdOrgAddress,
  EdOrgIdentificationCode,
  InstitutionTelephone,
  EdOrgCategory,
  AccountabilityRating,
} from './state-education-agency.entity';

// ============================================
// LEA Entity Interface
// ============================================

export interface LocalEducationAgency extends BaseEntity {
  entityType: 'LOCAL_EDUCATION_AGENCY';

  // Identifiers
  id: string;                                 // Internal UUID
  localEducationAgencyId: number;             // Ed-Fi numeric ID

  // Ed-Fi Core Fields
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;

  // LEA-Specific
  leaCategoryDescriptor: string;
  charterStatusDescriptor?: string;

  // Hierarchy References (internal UUIDs)
  stateEducationAgencyId?: string;
  educationServiceCenterId?: string;
  parentLocalEducationAgencyId?: string;

  // Ed-Fi Sub-Collections
  categories: EdOrgCategory[];
  addresses?: EdOrgAddress[];
  identificationCodes?: EdOrgIdentificationCode[];
  telephones?: InstitutionTelephone[];
  accountabilityRatings?: AccountabilityRating[];

  // GSI Keys
  gsi1pk?: string;  // TENANT#{tenantId}#SEA#{seaId}
  gsi1sk?: string;  // LEA#{leaId}
}

// ============================================
// Factory Function
// ============================================

export function createLEAEntity(
  tenantId: string,
  leaId: string,
  data: Omit<LocalEducationAgency, 'tenantId' | 'entityKey' | 'entityType' | 'id' | 'gsi1pk' | 'gsi1sk'>
): LocalEducationAgency {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.lea(leaId),
    entityType: 'LOCAL_EDUCATION_AGENCY',
    id: leaId,
    ...data,
    // GSI1: query LEAs by parent SEA
    gsi1pk: data.stateEducationAgencyId
      ? GSIKeyBuilder.seaChildren(tenantId, data.stateEducationAgencyId)
      : undefined,
    gsi1sk: data.stateEducationAgencyId
      ? EntityKeyBuilder.lea(leaId)
      : undefined,
  };
}

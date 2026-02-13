/**
 * Education Service Center (ESC) Entity - Identity Service
 *
 * DynamoDB Entity for regional education service agencies.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: ESC#{escId}
 * - GSI1PK: TENANT#{tenantId}#SEA#{seaId}  (query ESCs by parent SEA)
 * - GSI1SK: ESC#{escId}
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
// ESC Entity Interface
// ============================================

export interface EducationServiceCenter extends BaseEntity {
  entityType: 'EDUCATION_SERVICE_CENTER';

  // Identifiers
  id: string;                                 // Internal UUID
  educationServiceCenterId: number;           // Ed-Fi numeric ID

  // Ed-Fi Core Fields
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;

  // Hierarchy References
  stateEducationAgencyId?: string;

  // Ed-Fi Sub-Collections
  categories: EdOrgCategory[];
  addresses?: EdOrgAddress[];
  identificationCodes?: EdOrgIdentificationCode[];
  telephones?: InstitutionTelephone[];
  accountabilityRatings?: AccountabilityRating[];

  // GSI Keys
  gsi1pk?: string;  // TENANT#{tenantId}#SEA#{seaId}
  gsi1sk?: string;  // ESC#{escId}
}

// ============================================
// Factory Function
// ============================================

export function createESCEntity(
  tenantId: string,
  escId: string,
  data: Omit<EducationServiceCenter, 'tenantId' | 'entityKey' | 'entityType' | 'id' | 'gsi1pk' | 'gsi1sk'>
): EducationServiceCenter {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.esc(escId),
    entityType: 'EDUCATION_SERVICE_CENTER',
    id: escId,
    ...data,
    // GSI1: query ESCs by parent SEA
    gsi1pk: data.stateEducationAgencyId
      ? GSIKeyBuilder.seaChildren(tenantId, data.stateEducationAgencyId)
      : undefined,
    gsi1sk: data.stateEducationAgencyId
      ? EntityKeyBuilder.esc(escId)
      : undefined,
  };
}

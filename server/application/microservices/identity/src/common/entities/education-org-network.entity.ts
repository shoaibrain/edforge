/**
 * Education Organization Network Entity - Identity Service
 *
 * DynamoDB Entity for education organization networks.
 * Networks group organizations for reporting, collaboration, or governance.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: NETWORK#{networkId}
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import {
  EdOrgAddress,
  EdOrgIdentificationCode,
  InstitutionTelephone,
  EdOrgCategory,
} from './state-education-agency.entity';

// ============================================
// Network Entity Interface
// ============================================

export interface EducationOrgNetwork extends BaseEntity {
  entityType: 'EDUCATION_ORG_NETWORK';

  // Identifiers
  id: string;                                      // Internal UUID
  educationOrganizationNetworkId: number;          // Ed-Fi numeric ID

  // Ed-Fi Core Fields
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  networkPurposeDescriptor: string;
  operationalStatusDescriptor: string;

  // Ed-Fi Sub-Collections
  categories: EdOrgCategory[];
  addresses?: EdOrgAddress[];
  identificationCodes?: EdOrgIdentificationCode[];
  telephones?: InstitutionTelephone[];
}

// ============================================
// Factory Function
// ============================================

export function createNetworkEntity(
  tenantId: string,
  networkId: string,
  data: Omit<EducationOrgNetwork, 'tenantId' | 'entityKey' | 'entityType' | 'id'>
): EducationOrgNetwork {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.network(networkId),
    entityType: 'EDUCATION_ORG_NETWORK',
    id: networkId,
    ...data,
  };
}

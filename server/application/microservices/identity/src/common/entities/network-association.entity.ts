/**
 * Network Association Entity - Identity Service
 *
 * DynamoDB Entity for network membership (linking orgs to networks).
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: NETWORK#{networkId}#MEMBER#{orgId}
 * - GSI1PK: TENANT#{tenantId}#ORG#{orgId}  (query networks by org)
 * - GSI1SK: NETWORK#{networkId}
 */

import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';

// ============================================
// Network Association Entity Interface
// ============================================

export interface NetworkAssociation extends BaseEntity {
  entityType: 'NETWORK_ASSOCIATION';

  // Identifiers
  id: string;                                      // Internal UUID
  networkId: string;                               // UUID of the network
  memberEducationOrganizationId: string;           // UUID of the member org
  memberType: string;                              // EducationOrgType enum value
  memberName: string;                              // Denormalized name for display

  // Dates
  beginDate: string;
  endDate?: string;

  // GSI Keys
  gsi1pk?: string;  // TENANT#{tenantId}#ORG#{orgId}
  gsi1sk?: string;  // NETWORK#{networkId}
}

// ============================================
// Factory Function
// ============================================

export function createNetworkAssociationEntity(
  tenantId: string,
  associationId: string,
  data: Omit<NetworkAssociation, 'tenantId' | 'entityKey' | 'entityType' | 'id' | 'gsi1pk' | 'gsi1sk'>
): NetworkAssociation {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.networkMember(data.networkId, data.memberEducationOrganizationId),
    entityType: 'NETWORK_ASSOCIATION',
    id: associationId,
    ...data,
    // GSI1: query networks an org belongs to
    gsi1pk: GSIKeyBuilder.orgNetworks(tenantId, data.memberEducationOrganizationId),
    gsi1sk: EntityKeyBuilder.network(data.networkId),
  };
}

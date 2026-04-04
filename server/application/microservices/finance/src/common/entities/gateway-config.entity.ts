/**
 * Gateway Config Entity
 *
 * Stores payment gateway configuration per school.
 * One config per gateway per school.
 *
 * PK: tenantId
 * SK: GATEWAY_CONFIG#{schoolId}#{gateway}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: GATEWAY_CONFIG#{displayOrder}#{gateway}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { PaymentGateway } from '@aibrains/shared-types';

export interface GatewayConfigEntity extends BaseEntity {
  entityType: 'GATEWAY_CONFIG';
  configId: string;
  schoolId: string;
  gateway: PaymentGateway;
  isEnabled: boolean;
  isTestMode: boolean;
  displayName: string;
  displayOrder: number;
  credentials: Record<string, string>;

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
}

export function createGatewayConfigEntity(
  tenantId: string,
  schoolId: string,
  gateway: PaymentGateway,
  data: {
    isEnabled: boolean;
    isTestMode: boolean;
    displayName?: string;
    displayOrder?: number;
    credentials: Record<string, string>;
  },
  userId: string,
): GatewayConfigEntity {
  const configId = uuid();
  const now = new Date().toISOString();

  const displayName = data.displayName || gateway.charAt(0).toUpperCase() + gateway.slice(1);

  return {
    tenantId,
    entityKey: EntityKeyBuilder.gatewayConfig(schoolId, gateway),
    entityType: 'GATEWAY_CONFIG',
    configId,
    schoolId,
    gateway,
    isEnabled: data.isEnabled,
    isTestMode: data.isTestMode,
    displayName,
    displayOrder: data.displayOrder ?? 0,
    credentials: data.credentials,

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('GATEWAY_CONFIG', `${String(data.displayOrder ?? 0).padStart(3, '0')}#${gateway}`),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}

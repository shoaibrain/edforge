/**
 * Common Types
 * 
 * Shared base types used across all services
 */

export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: string; // Discriminator for entity type
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
}


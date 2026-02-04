/**
 * Session Entity for Identity Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SESSION#{sessionId}
 * 
 * GSI2 (Token Lookup):
 * - GSI2PK: TOKEN#{accessTokenHash}
 * - GSI2SK: {expiresAt} (for TTL sorting)
 * 
 * TTL: Sessions auto-expire after 24 hours
 */

import { 
  BaseEntity, 
  SessionStatus,
  EntityKeyBuilder 
} from './base.entity';

/**
 * Session entity stored in DynamoDB
 */
export interface Session extends BaseEntity {
  entityType: 'SESSION';
  
  // Session identity
  sessionId: string;
  userId: string;
  
  // Tokens (hashed for security)
  accessTokenHash: string;
  refreshTokenHash: string;
  
  // Expiration
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  
  // Session metadata
  status: SessionStatus;
  deviceInfo?: DeviceInfo;
  ipAddress?: string;
  userAgent?: string;
  
  // DynamoDB TTL (Unix timestamp in seconds)
  ttl: number;
  
  // GSI Keys
  gsi2pk: string;  // TOKEN#{accessTokenHash}
  gsi2sk: string;  // {expiresAt} for sorting
}

/**
 * Device information for session tracking
 */
export interface DeviceInfo {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  os?: string;
  browser?: string;
  deviceId?: string;
}

/**
 * Create a new Session entity with proper keys
 */
export function createSessionEntity(
  tenantId: string,
  sessionId: string,
  userId: string,
  accessTokenHash: string,
  refreshTokenHash: string,
  accessTokenExpiresAt: Date,
  refreshTokenExpiresAt: Date,
  createdBy: string,
  metadata?: {
    deviceInfo?: DeviceInfo;
    ipAddress?: string;
    userAgent?: string;
  }
): Session {
  const now = new Date().toISOString();
  const accessExpiry = accessTokenExpiresAt.toISOString();
  const refreshExpiry = refreshTokenExpiresAt.toISOString();
  
  // TTL is the refresh token expiry in Unix seconds
  const ttl = Math.floor(refreshTokenExpiresAt.getTime() / 1000);
  
  return {
    tenantId,
    entityKey: EntityKeyBuilder.session(sessionId),
    entityType: 'SESSION',
    sessionId,
    userId,
    accessTokenHash,
    refreshTokenHash,
    accessTokenExpiresAt: accessExpiry,
    refreshTokenExpiresAt: refreshExpiry,
    status: 'active',
    deviceInfo: metadata?.deviceInfo,
    ipAddress: metadata?.ipAddress,
    userAgent: metadata?.userAgent,
    ttl,
    gsi2pk: `TOKEN#${accessTokenHash}`,
    gsi2sk: accessExpiry,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy,
    version: 1,
  };
}

/**
 * Session token expiry configuration
 */
export const SESSION_CONFIG = {
  // Access token expires in 1 hour
  ACCESS_TOKEN_EXPIRY_SECONDS: 60 * 60,
  
  // Refresh token expires in 24 hours
  REFRESH_TOKEN_EXPIRY_SECONDS: 60 * 60 * 24,
  
  // Maximum sessions per user
  MAX_SESSIONS_PER_USER: 5,
};


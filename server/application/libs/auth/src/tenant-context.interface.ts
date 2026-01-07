/**
 * TenantContext Interface
 * 
 * Type-safe interface for tenant credentials extracted from JWT tokens.
 * Used by all controllers instead of `any` type for better type safety.
 * 
 * COGNITO JWT CLAIMS MAPPING:
 * - sub → userId (unique Cognito user identifier)
 * - cognito:username → username (Cognito username, may include tenant suffix)
 * - custom:tenantId → tenantId (EdForge tenant identifier)
 * - custom:tenantTier → tenantTier (subscription tier: BASIC, ADVANCED, PREMIUM)
 * - custom:tenantName → tenantName (human-readable tenant name)
 * - custom:userRole → globalRole (TenantAdmin or StandardUser)
 * - email → email (user's email address)
 * - iss → userPoolId (extracted from issuer URL)
 * - aud → appClientId (Cognito app client ID)
 */

/**
 * Supported tenant subscription tiers
 */
export type TenantTier = 'BASIC' | 'ADVANCED' | 'PREMIUM';

/**
 * Global user roles (tenant-wide, not school-specific)
 */
export type GlobalRole = 'TenantAdmin' | 'StandardUser';

/**
 * TenantContext - Extracted from validated JWT token
 * 
 * This interface provides type safety for all tenant-related operations.
 * It's populated by JwtStrategy.validate() and accessed via @TenantCredentials decorator.
 */
export interface TenantContext {
  /**
   * Unique Cognito user identifier (from JWT 'sub' claim)
   * Format: UUID (e.g., "74687438-40c1-70da-3f79-5b4970026a37")
   */
  userId: string;

  /**
   * Cognito username (from JWT 'cognito:username' claim)
   * May include tenant suffix (e.g., "johndoe-d7555559-f5dc-4b3b-89a8-8c81b3bc48b6")
   */
  username: string;

  /**
   * EdForge tenant identifier (from JWT 'custom:tenantId' claim)
   * Format: UUID (e.g., "d7555559-f5dc-4b3b-89a8-8c81b3bc48b6")
   */
  tenantId: string;

  /**
   * Subscription tier (from JWT 'custom:tenantTier' claim)
   * Determines resource allocation and feature access
   */
  tenantTier: TenantTier;

  /**
   * Human-readable tenant name (from JWT 'custom:tenantName' claim)
   * Used for display purposes (e.g., "rainshoaib")
   */
  tenantName: string;

  /**
   * User's email address (from JWT 'email' claim)
   */
  email: string;

  /**
   * Global user role (from JWT 'custom:userRole' claim)
   * TenantAdmin: Full tenant management access
   * StandardUser: Limited access based on school roles
   */
  globalRole: GlobalRole;

  /**
   * Cognito User Pool ID (extracted from JWT 'iss' claim)
   * Format: "us-east-1_xxxxxxxx"
   */
  userPoolId: string;

  /**
   * Cognito App Client ID (from JWT 'aud' claim)
   */
  appClientId: string;
}

/**
 * Extended context with request metadata
 * Used internally for logging and audit trails
 */
export interface TenantRequestContext extends TenantContext {
  /**
   * Correlation ID for distributed tracing
   */
  correlationId?: string;

  /**
   * Request timestamp
   */
  requestTimestamp?: string;

  /**
   * Client IP address
   */
  clientIp?: string;

  /**
   * User agent string
   */
  userAgent?: string;
}

/**
 * Type guard to check if a value is a valid TenantContext
 */
export function isTenantContext(value: unknown): value is TenantContext {
  if (!value || typeof value !== 'object') return false;
  
  const ctx = value as Record<string, unknown>;
  
  return (
    typeof ctx.userId === 'string' &&
    typeof ctx.username === 'string' &&
    typeof ctx.tenantId === 'string' &&
    typeof ctx.tenantTier === 'string' &&
    ['BASIC', 'ADVANCED', 'PREMIUM'].includes(ctx.tenantTier) &&
    typeof ctx.tenantName === 'string' &&
    typeof ctx.email === 'string' &&
    typeof ctx.globalRole === 'string' &&
    ['TenantAdmin', 'StandardUser'].includes(ctx.globalRole) &&
    typeof ctx.userPoolId === 'string' &&
    typeof ctx.appClientId === 'string'
  );
}


/**
 * User Entity for Identity Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: USER#{userId}
 * 
 * GSI1 (Email Lookup):
 * - GSI1PK: EMAIL#{email}
 * - GSI1SK: TENANT#{tenantId}
 */

import { 
  BaseEntity, 
  GlobalRole, 
  UserStatus,
  EntityKeyBuilder 
} from './base.entity';

/**
 * User entity stored in DynamoDB
 */
export interface User extends BaseEntity {
  entityType: 'USER';
  
  // Core identity
  userId: string;
  email: string;
  cognitoUsername: string;
  cognitoSub?: string;
  
  // Profile
  firstName: string;
  lastName: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  
  // Authorization
  globalRole: GlobalRole;
  status: UserStatus;
  
  // Security
  lastLoginAt?: string;
  lastLoginIp?: string;
  failedLoginAttempts?: number;
  lockedUntil?: string;
  mfaEnabled?: boolean;
  
  // GSI Keys
  gsi1pk: string;  // EMAIL#{email}
  gsi1sk: string;  // TENANT#{tenantId}
}

/**
 * User preferences stored separately
 */
export interface UserPreferences extends BaseEntity {
  entityType: 'USER_PREFERENCES';
  
  userId: string;
  
  // Display preferences
  theme: 'light' | 'dark' | 'system';
  language: string;  // e.g., 'en', 'es'
  timezone: string;  // e.g., 'America/New_York'
  dateFormat: string;  // e.g., 'MM/DD/YYYY'
  
  // Notification preferences
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    digest: 'instant' | 'daily' | 'weekly' | 'none';
  };
  
  // Default school context
  defaultSchoolId?: string;
}

/**
 * Create a new User entity with proper keys
 */
export function createUserEntity(
  tenantId: string,
  userId: string,
  data: Omit<User, 'tenantId' | 'entityKey' | 'entityType' | 'gsi1pk' | 'gsi1sk' | 'userId'>
): User {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.user(userId),
    entityType: 'USER',
    userId,
    gsi1pk: `EMAIL#${data.email.toLowerCase()}`,
    gsi1sk: `TENANT#${tenantId}`,
    ...data,
  };
}

/**
 * Create default user preferences
 */
export function createDefaultPreferences(
  tenantId: string,
  userId: string,
  createdBy: string
): UserPreferences {
  const now = new Date().toISOString();
  
  return {
    tenantId,
    entityKey: EntityKeyBuilder.userPreferences(userId),
    entityType: 'USER_PREFERENCES',
    userId,
    theme: 'system',
    language: 'en',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    notifications: {
      email: true,
      push: true,
      sms: false,
      digest: 'daily',
    },
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy,
    version: 1,
  };
}


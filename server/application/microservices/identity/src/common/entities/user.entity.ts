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
 * Notification channel settings
 */
export interface NotificationChannels {
  email: {
    enabled: boolean;
    digest: 'immediate' | 'daily' | 'weekly' | 'never';
  };
  push: {
    enabled: boolean;
  };
  sms: {
    enabled: boolean;
    phone?: string;
  };
}

/**
 * Notification category settings
 */
export interface NotificationCategories {
  announcements: boolean;
  attendance: boolean;
  grades: boolean;
  messages: boolean;
  calendar: boolean;
  billing: boolean;
  security: boolean;  // Always true, not editable by user
}

/**
 * Full notification preferences structure
 */
export interface NotificationPreferences {
  channels: NotificationChannels;
  categories: NotificationCategories;
}

/**
 * User preferences stored separately
 * Updated to match frontend Shell module expectations
 */
export interface UserPreferences extends BaseEntity {
  entityType: 'USER_PREFERENCES';
  
  userId: string;
  
  // Display preferences
  theme: 'light' | 'dark' | 'system';
  language: string;  // e.g., 'en-US', 'es'
  timezone: string;  // e.g., 'America/New_York'
  dateFormat: string;  // 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
  timeFormat: '12h' | '24h';
  weekStartsOn: 'sunday' | 'monday';
  
  // Notification preferences (detailed structure)
  notifications: NotificationPreferences;
  
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
    language: 'en-US',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    weekStartsOn: 'sunday',
    notifications: {
      channels: {
        email: {
          enabled: true,
          digest: 'daily',
        },
        push: {
          enabled: true,
        },
        sms: {
          enabled: false,
        },
      },
      categories: {
        announcements: true,
        attendance: true,
        grades: true,
        messages: true,
        calendar: true,
        billing: true,
        security: true,  // Always enabled, cannot be disabled
      },
    },
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy,
    version: 1,
  };
}


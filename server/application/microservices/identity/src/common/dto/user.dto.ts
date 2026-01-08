/**
 * User DTOs for Identity Service
 */

import { 
  IsEmail, 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum, 
  MinLength,
  MaxLength,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GlobalRole, UserStatus } from '../entities/base.entity';

/**
 * Create User DTO
 */
export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(['TenantAdmin', 'StandardUser'])
  @IsOptional()
  globalRole?: GlobalRole;

  @IsString()
  @IsOptional()
  temporaryPassword?: string;
}

/**
 * Update User DTO
 */
export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  lastName?: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsEnum(['active', 'inactive', 'suspended'])
  @IsOptional()
  status?: UserStatus;
}

/**
 * User Response DTO (excludes sensitive fields)
 */
export class UserResponseDto {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  globalRole: GlobalRole;
  status: UserStatus;
  lastLoginAt?: string;
  mfaEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * User List Response DTO
 */
export class UserListResponseDto {
  items: UserResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Email Channel Settings DTO
 */
export class EmailChannelDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsEnum(['immediate', 'daily', 'weekly', 'never'])
  @IsOptional()
  digest?: 'immediate' | 'daily' | 'weekly' | 'never';
}

/**
 * Push Channel Settings DTO
 */
export class PushChannelDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * SMS Channel Settings DTO
 */
export class SmsChannelDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  phone?: string;
}

/**
 * Notification Channels DTO
 */
export class NotificationChannelsDto {
  @ValidateNested()
  @Type(() => EmailChannelDto)
  @IsOptional()
  email?: EmailChannelDto;

  @ValidateNested()
  @Type(() => PushChannelDto)
  @IsOptional()
  push?: PushChannelDto;

  @ValidateNested()
  @Type(() => SmsChannelDto)
  @IsOptional()
  sms?: SmsChannelDto;
}

/**
 * Notification Categories DTO
 */
export class NotificationCategoriesDto {
  @IsBoolean()
  @IsOptional()
  announcements?: boolean;

  @IsBoolean()
  @IsOptional()
  attendance?: boolean;

  @IsBoolean()
  @IsOptional()
  grades?: boolean;

  @IsBoolean()
  @IsOptional()
  messages?: boolean;

  @IsBoolean()
  @IsOptional()
  calendar?: boolean;

  @IsBoolean()
  @IsOptional()
  billing?: boolean;

  /**
   * Security notifications - always true, enforced server-side
   * User cannot disable security alerts (password changes, new logins, etc.)
   */
  @IsBoolean()
  @IsOptional()
  security?: boolean;
}

/**
 * Notification Preferences DTO - Full structure matching frontend expectations
 * NOTE: Must be defined BEFORE UpdatePreferencesDto to avoid circular reference
 */
export class NotificationPreferencesDto {
  @ValidateNested()
  @Type(() => NotificationChannelsDto)
  @IsOptional()
  channels?: NotificationChannelsDto;

  @ValidateNested()
  @Type(() => NotificationCategoriesDto)
  @IsOptional()
  categories?: NotificationCategoriesDto;
}

/**
 * Update User Preferences DTO
 */
export class UpdatePreferencesDto {
  @IsEnum(['light', 'dark', 'system'])
  @IsOptional()
  theme?: 'light' | 'dark' | 'system';

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  dateFormat?: string;

  @IsEnum(['12h', '24h'])
  @IsOptional()
  timeFormat?: '12h' | '24h';

  @IsEnum(['sunday', 'monday'])
  @IsOptional()
  weekStartsOn?: 'sunday' | 'monday';

  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  @IsOptional()
  notifications?: NotificationPreferencesDto;

  @IsString()
  @IsOptional()
  defaultSchoolId?: string;
}

/**
 * School Assignment DTO - Frontend-expected format for user's school roles
 * Used by Shell context to display school assignments with human-readable names
 */
export class SchoolAssignmentDto {
  schoolId: string;
  schoolName: string;
  role: string;  // SchoolRole
}

/**
 * User Assignments Response DTO
 */
export class UserAssignmentsResponseDto {
  userId: string;
  assignments: SchoolAssignmentDto[];
}

/**
 * Current User Response DTO - Extended response for GET /users/me
 * Includes all user profile fields plus school assignments for Shell context
 */
export class CurrentUserProfileDto {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  globalRole: GlobalRole;
  status: UserStatus;
  tenantId: string;
  tenantName?: string;
  assignments: SchoolAssignmentDto[];
  lastLoginAt?: string;
  mfaEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

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
 * Notification Preferences DTO
 * NOTE: Must be defined BEFORE UpdatePreferencesDto to avoid circular reference
 */
export class NotificationPreferencesDto {
  @IsBoolean()
  @IsOptional()
  email?: boolean;

  @IsBoolean()
  @IsOptional()
  push?: boolean;

  @IsBoolean()
  @IsOptional()
  sms?: boolean;

  @IsEnum(['instant', 'daily', 'weekly', 'none'])
  @IsOptional()
  digest?: 'instant' | 'daily' | 'weekly' | 'none';
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

  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  @IsOptional()
  notifications?: NotificationPreferencesDto;

  @IsString()
  @IsOptional()
  defaultSchoolId?: string;
}

/**
 * Authentication DTOs for Identity Service
 */

import { 
  IsEmail, 
  IsNotEmpty, 
  IsString, 
  IsOptional,
  MinLength,
} from 'class-validator';

/**
 * Login Request DTO
 */
export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  deviceId?: string;
}

/**
 * Login Response DTO
 */
export class LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  user: AuthUserDto;
}

/**
 * Authenticated User DTO
 */
export class AuthUserDto {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  globalRole: string;
  tenantId: string;
  roles: SchoolRoleDto[];
  preferences?: UserPreferencesDto;
}

/**
 * School Role DTO
 */
export class SchoolRoleDto {
  schoolId: string;
  schoolName?: string;
  role: string;
  departmentId?: string;
}

/**
 * User Preferences DTO
 */
export class UserPreferencesDto {
  theme: string;
  language: string;
  timezone: string;
  defaultSchoolId?: string;
}

/**
 * Refresh Token Request DTO
 */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

/**
 * Refresh Token Response DTO
 */
export class RefreshTokenResponseDto {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

/**
 * Logout Request DTO
 */
export class LogoutDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsOptional()
  allSessions?: boolean;
}

/**
 * Current User Response DTO (GET /auth/me)
 */
export class CurrentUserResponseDto {
  user: AuthUserDto;
  session: SessionInfoDto;
}

/**
 * Session Info DTO
 */
export class SessionInfoDto {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  deviceInfo?: {
    deviceType: string;
    os?: string;
    browser?: string;
  };
  ipAddress?: string;
}

/**
 * Change Password DTO
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

/**
 * Forgot Password DTO
 */
export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

/**
 * Reset Password DTO
 */
export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}


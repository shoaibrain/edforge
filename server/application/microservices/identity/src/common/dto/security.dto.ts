/**
 * Security DTOs for Identity Service
 * 
 * Used by the security endpoints under /users/{id}/security/*
 */

import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

/**
 * Security Overview Response DTO
 * GET /users/{id}/security
 */
export class SecurityOverviewDto {
  userId: string;
  email: string;
  
  // MFA status
  mfaEnabled: boolean;
  mfaMethod?: 'totp' | 'sms';
  
  // Last login info
  lastLoginAt?: string;
  lastLoginIp?: string;
  lastLoginDevice?: string;
  
  // Account security status
  passwordLastChangedAt?: string;
  accountLocked: boolean;
  lockExpiresAt?: string;
  failedLoginAttempts: number;
  
  // Active sessions count
  activeSessions: number;
  
  // Security recommendations
  securityScore: number;  // 0-100
  recommendations: string[];
}

/**
 * Change Password DTO
 * POST /users/{id}/security/change-password
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password must contain uppercase, lowercase, number, and special character',
  })
  newPassword: string;
}

/**
 * Change Password Response DTO
 */
export class ChangePasswordResponseDto {
  success: boolean;
  message: string;
  passwordLastChangedAt: string;
}

/**
 * MFA Setup Initiation Response
 * POST /users/{id}/security/mfa/setup
 */
export class MfaSetupResponseDto {
  secretKey: string;
  qrCodeUrl: string;
  manualEntryKey: string;
  expiresAt: string;
}

/**
 * MFA Verify DTO
 * POST /users/{id}/security/mfa/verify
 */
export class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(6)
  code: string;

  @IsString()
  @IsOptional()
  secretKey?: string;
}

/**
 * MFA Verify Response DTO
 */
export class MfaVerifyResponseDto {
  success: boolean;
  backupCodes?: string[];
  message: string;
}

/**
 * MFA Disable DTO
 * POST /users/{id}/security/mfa/disable
 */
export class MfaDisableDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  code?: string;  // MFA code for verification
}

/**
 * MFA Disable Response DTO
 */
export class MfaDisableResponseDto {
  success: boolean;
  message: string;
}

/**
 * Session Response DTO (for security context)
 */
export class SecuritySessionDto {
  sessionId: string;
  createdAt: string;
  lastActivityAt?: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  location?: string;
  isCurrent: boolean;
}

/**
 * Sessions List Response DTO
 */
export class SecuritySessionsListDto {
  sessions: SecuritySessionDto[];
  total: number;
  currentSessionId?: string;
}

/**
 * Revoke Session Response DTO
 */
export class RevokeSessionResponseDto {
  success: boolean;
  sessionId: string;
  message: string;
}

/**
 * Revoke All Sessions Response DTO
 */
export class RevokeAllSessionsResponseDto {
  success: boolean;
  revokedCount: number;
  message: string;
}

/**
 * Login History Entry DTO
 */
export class LoginHistoryEntryDto {
  timestamp: string;
  status: 'success' | 'failed' | 'blocked';
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  location?: string;
  failureReason?: string;
}

/**
 * Login History Response DTO
 */
export class LoginHistoryResponseDto {
  entries: LoginHistoryEntryDto[];
  total: number;
  hasMore: boolean;
}


/**
 * Security Schemas - Identity Service
 * 
 * Zod schemas for security-related DTOs.
 * 
 * ============================================
 * PASSWORD VALIDATION - COGNITO IS SOURCE OF TRUTH
 * ============================================
 * 
 * AWS Cognito User Pool password policy (from server/lib/tenant-template/identity-provider.ts):
 *   passwordPolicy: {
 *     minLength: 8,
 *     requireLowercase: true,
 *     requireUppercase: true,
 *     requireDigits: true,
 *     requireSymbols: true  // Uses Cognito's default symbol set
 *   }
 * 
 * Cognito's default special characters when requireSymbols=true:
 *   ^ $ * . [ ] { } ( ) ? " ! @ # % & / \ , > < ' : ; | _ ~ ` + = -
 * 
 * @see https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-policies.html
 */

import { z } from 'zod';
import { isoDateSchema } from '../common';
import { passwordSchema, COGNITO_PASSWORD_REQUIREMENTS } from '../../validators/password';

// Re-export for convenience
export { passwordSchema, COGNITO_PASSWORD_REQUIREMENTS };

// ============================================
// Enums
// ============================================

export const mfaMethodSchema = z.enum(['totp', 'sms']);
export type MfaMethod = z.infer<typeof mfaMethodSchema>;

export const loginStatusSchema = z.enum(['success', 'failed', 'blocked']);
export type LoginStatus = z.infer<typeof loginStatusSchema>;

export const deviceTypeSchema = z.enum(['desktop', 'mobile', 'tablet', 'unknown']);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

// ============================================
// Security Overview Schema
// ============================================

export const securityOverviewSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  mfaEnabled: z.boolean(),
  mfaMethod: mfaMethodSchema.optional(),
  lastLoginAt: isoDateSchema.optional(),
  lastLoginIp: z.string().optional(),
  lastLoginDevice: z.string().optional(),
  passwordLastChangedAt: isoDateSchema.optional(),
  accountLocked: z.boolean(),
  lockExpiresAt: isoDateSchema.optional(),
  failedLoginAttempts: z.number().int().min(0),
  activeSessions: z.number().int().min(0),
  securityScore: z.number().int().min(0).max(100),
  recommendations: z.array(z.string()),
});

export type SecurityOverviewDto = z.infer<typeof securityOverviewSchema>;

// ============================================
// Change Password Schemas
// ============================================

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const changePasswordResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  passwordLastChangedAt: isoDateSchema,
});

export type ChangePasswordResponseDto = z.infer<typeof changePasswordResponseSchema>;

export const passwordErrorResponseSchema = z.object({
  statusCode: z.number(),
  errorCode: z.string(),
  message: z.string(),
  field: z.string().optional(),
});

export type PasswordErrorResponseDto = z.infer<typeof passwordErrorResponseSchema>;

// ============================================
// MFA Setup Schemas
// ============================================

export const mfaSetupResponseSchema = z.object({
  secretKey: z.string(),
  qrCodeUrl: z.string().url(),
  manualEntryKey: z.string(),
  expiresAt: isoDateSchema,
});

export type MfaSetupResponseDto = z.infer<typeof mfaSetupResponseSchema>;

export const mfaVerifySchema = z.object({
  code: z.string().length(6, 'MFA code must be exactly 6 digits'),
  secretKey: z.string().optional(),
});

export type MfaVerifyDto = z.infer<typeof mfaVerifySchema>;

export const mfaVerifyResponseSchema = z.object({
  success: z.boolean(),
  backupCodes: z.array(z.string()).optional(),
  message: z.string(),
});

export type MfaVerifyResponseDto = z.infer<typeof mfaVerifyResponseSchema>;

export const mfaDisableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().optional(),
});

export type MfaDisableDto = z.infer<typeof mfaDisableSchema>;

export const mfaDisableResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type MfaDisableResponseDto = z.infer<typeof mfaDisableResponseSchema>;

// ============================================
// Session Schemas (Security Context)
// ============================================

export const securitySessionSchema = z.object({
  sessionId: z.string(),
  createdAt: isoDateSchema,
  lastActivityAt: isoDateSchema.optional(),
  expiresAt: isoDateSchema,
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  deviceType: deviceTypeSchema.optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  location: z.string().optional(),
  isCurrent: z.boolean(),
});

export type SecuritySessionDto = z.infer<typeof securitySessionSchema>;

export const securitySessionsListSchema = z.object({
  sessions: z.array(securitySessionSchema),
  total: z.number().int().min(0),
  currentSessionId: z.string().optional(),
});

export type SecuritySessionsListDto = z.infer<typeof securitySessionsListSchema>;

export const revokeSessionResponseSchema = z.object({
  success: z.boolean(),
  sessionId: z.string(),
  message: z.string(),
});

export type RevokeSessionResponseDto = z.infer<typeof revokeSessionResponseSchema>;

export const revokeAllSessionsResponseSchema = z.object({
  success: z.boolean(),
  revokedCount: z.number().int().min(0),
  message: z.string(),
});

export type RevokeAllSessionsResponseDto = z.infer<typeof revokeAllSessionsResponseSchema>;

// ============================================
// Login History Schemas
// ============================================

export const loginHistoryEntrySchema = z.object({
  timestamp: isoDateSchema,
  status: loginStatusSchema,
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  deviceType: deviceTypeSchema.optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  location: z.string().optional(),
  failureReason: z.string().optional(),
});

export type LoginHistoryEntryDto = z.infer<typeof loginHistoryEntrySchema>;

export const loginHistoryResponseSchema = z.object({
  entries: z.array(loginHistoryEntrySchema),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
});

export type LoginHistoryResponseDto = z.infer<typeof loginHistoryResponseSchema>;


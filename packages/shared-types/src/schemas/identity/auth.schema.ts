/**
 * Authentication Schemas - Identity Service
 * 
 * Zod schemas for authentication DTOs.
 * Single source of truth for auth data shapes used by both frontend and backend.
 */

import { z } from 'zod';
import { emailSchema, isoDateSchema } from '../common';
import { passwordSchema } from '../../validators/password';
import { globalRoleSchema, userStatusSchema } from './user.schema';
import { deviceTypeSchema } from './security.schema';

// ============================================
// Device Info Schema
// ============================================

export const deviceInfoSchema = z.object({
  deviceType: deviceTypeSchema,
  os: z.string().optional(),
  browser: z.string().optional(),
});

export type DeviceInfoDto = z.infer<typeof deviceInfoSchema>;

// ============================================
// Login Schemas
// ============================================

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  deviceId: z.string().optional(),
});

export type LoginDto = z.infer<typeof loginSchema>;

// ============================================
// Auth School Role Schema (for auth context)
// ============================================

export const authSchoolRoleSchema = z.object({
  schoolId: z.string(),
  schoolName: z.string().optional(),
  role: z.string(),
  departmentId: z.string().optional(),
});

export type AuthSchoolRoleDto = z.infer<typeof authSchoolRoleSchema>;

// ============================================
// User Preferences Schema (Auth Context)
// ============================================

export const authUserPreferencesSchema = z.object({
  theme: z.string(),
  language: z.string(),
  timezone: z.string(),
  defaultSchoolId: z.string().optional(),
});

export type UserPreferencesDto = z.infer<typeof authUserPreferencesSchema>;

// ============================================
// Authenticated User Schema
// ============================================

export const authUserSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  globalRole: z.string(), // Allow any string for flexibility
  tenantId: z.string(),
  roles: z.array(authSchoolRoleSchema),
  preferences: authUserPreferencesSchema.optional(),
  status: z.string().optional(),
  lastLoginAt: isoDateSchema.optional(),
  mfaEnabled: z.boolean().optional(),
  createdAt: isoDateSchema.optional(),
  updatedAt: isoDateSchema.optional(),
});

export type AuthUserDto = z.infer<typeof authUserSchema>;

// ============================================
// Login Response Schema
// ============================================

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  tokenType: z.string().default('Bearer'),
  user: authUserSchema,
});

export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

// ============================================
// Token Refresh Schemas
// ============================================

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

export const refreshTokenResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  tokenType: z.string().default('Bearer'),
});

export type RefreshTokenResponseDto = z.infer<typeof refreshTokenResponseSchema>;

// ============================================
// Logout Schema
// ============================================

export const logoutSchema = z.object({
  sessionId: z.string().optional(),
  allSessions: z.boolean().default(false).optional(),
  revokeAll: z.boolean().default(false).optional(),
});

export type LogoutDto = z.infer<typeof logoutSchema>;

// ============================================
// Session Info Schema
// ============================================

export const sessionInfoSchema = z.object({
  sessionId: z.string(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  deviceInfo: deviceInfoSchema.optional(),
  ipAddress: z.string().optional(),
});

export type SessionInfoDto = z.infer<typeof sessionInfoSchema>;

// ============================================
// Current User Response Schema
// ============================================

export const currentUserResponseSchema = z.object({
  user: authUserSchema,
  session: sessionInfoSchema,
});

export type CurrentUserResponseDto = z.infer<typeof currentUserResponseSchema>;

// ============================================
// Password Reset Schemas
// ============================================

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().min(1, 'Verification code is required'),
  newPassword: passwordSchema,
});

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;


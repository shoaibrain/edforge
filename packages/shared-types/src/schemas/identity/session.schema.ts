/**
 * Session Schemas - Identity Service
 * 
 * Zod schemas for session management DTOs.
 */

import { z } from 'zod';
import { isoDateSchema } from '../common';
import { deviceTypeSchema } from './security.schema';

// ============================================
// Device Info Schema
// ============================================

export const sessionDeviceInfoSchema = z.object({
  deviceType: deviceTypeSchema,
  os: z.string().optional(),
  browser: z.string().optional(),
  deviceId: z.string().optional(),
});

export type SessionDeviceInfoDto = z.infer<typeof sessionDeviceInfoSchema>;

// ============================================
// Session Status Schema
// ============================================

export const sessionStatusSchema = z.enum(['active', 'expired', 'revoked']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

// ============================================
// Session Response Schema
// ============================================

export const sessionResponseSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  status: sessionStatusSchema,
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  deviceInfo: sessionDeviceInfoSchema.optional(),
  ipAddress: z.string().optional(),
  lastActiveAt: isoDateSchema.optional(),
});

export type SessionResponseDto = z.infer<typeof sessionResponseSchema>;

// ============================================
// Session List Response Schema
// ============================================

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionResponseSchema),
  total: z.number().int().min(0),
});

export type SessionListResponseDto = z.infer<typeof sessionListResponseSchema>;

// ============================================
// Revoke Session Schema
// ============================================

export const revokeSessionSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().optional(),
});

export type RevokeSessionDto = z.infer<typeof revokeSessionSchema>;

// ============================================
// Revoke All Sessions Schema
// ============================================

export const revokeAllSessionsSchema = z.object({
  exceptCurrentSession: z.string().optional(),
  reason: z.string().optional(),
});

export type RevokeAllSessionsDto = z.infer<typeof revokeAllSessionsSchema>;


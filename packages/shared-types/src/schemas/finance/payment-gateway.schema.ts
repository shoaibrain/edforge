/**
 * Payment Gateway Configuration Schemas
 *
 * Public-facing gateway config is safe to send to browser.
 * Credentials are NEVER included in public responses.
 */

import { z } from 'zod';
import { paymentGatewayEnum } from './common';
import { uuidSchema } from '../common';

// ============================================================================
// PUBLIC CONFIG (safe for browser)
// ============================================================================

export const paymentGatewayPublicConfigSchema = z.object({
  id: uuidSchema,
  schoolId: uuidSchema,
  gateway: paymentGatewayEnum,
  isEnabled: z.boolean(),
  isTestMode: z.boolean(),
  displayName: z.string(),
  displayOrder: z.number().int().min(0),
});

export type PaymentGatewayPublicConfig = z.infer<typeof paymentGatewayPublicConfigSchema>;

// ============================================================================
// ADMIN CONFIG (credentials masked as `****` in API responses)
// ============================================================================

export const paymentGatewayConfigSchema = paymentGatewayPublicConfigSchema.extend({
  credentials: z.record(z.string()),
});

export type PaymentGatewayConfig = z.infer<typeof paymentGatewayConfigSchema>;

// ============================================================================
// SAVE CONFIG (admin writes)
// ============================================================================

export const saveGatewayConfigSchema = z.object({
  isEnabled: z.boolean(),
  isTestMode: z.boolean(),
  displayName: z.string().min(1).max(100).optional(),
  displayOrder: z.number().int().min(0).optional(),
  credentials: z.record(z.string()),
});

export type SaveGatewayConfigDto = z.infer<typeof saveGatewayConfigSchema>;

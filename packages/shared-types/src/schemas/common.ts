/**
 * Common Schemas
 * 
 * Base schemas used across all domains
 */

import { z } from 'zod';

// ============================================
// Pagination
// ============================================

/**
 * Pagination query parameters
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Paginated response wrapper
 */
export const createPaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    lastEvaluatedKey: z.string().optional(),
    hasMore: z.boolean(),
    total: z.number().optional(),
  });

// ============================================
// Error Responses
// ============================================

/**
 * Standard error response
 */
export const errorResponseSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  field: z.string().optional(),
  timestamp: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ============================================
// Common Field Schemas
// ============================================

/**
 * UUID schema
 */
export const uuidSchema = z.string().uuid();

/**
 * Email schema
 */
export const emailSchema = z.string().email().toLowerCase();

/**
 * Phone number schema (E.164 format)
 */
export const phoneSchema = z.string().regex(
  /^\+?[1-9]\d{1,14}$/,
  'Phone number must be in E.164 format (e.g., +12025551234)'
);

/**
 * URL schema
 */
export const urlSchema = z.string().url();

/**
 * ISO date string schema
 */
export const isoDateSchema = z.string().datetime();

/**
 * Date string in YYYY-MM-DD format (for dates without time)
 */
export const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Date must be in YYYY-MM-DD format'
).refine(
  (date) => !isNaN(Date.parse(date)),
  'Invalid date'
);

/**
 * Time string in HH:MM format (24-hour)
 */
export const timeSchema = z.string().regex(
  /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
  'Time must be in HH:MM format (24-hour)'
);

// ============================================
// Address Schema (Reusable)
// ============================================

/**
 * Generic address schema
 */
export const addressSchema = z.object({
  street1: z.string().max(200).optional(),
  street2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
}).refine(
  (data) => {
    // If any address field is provided, street1 is required
    const hasAnyField = data.street2 || data.city || data.state || data.zipCode || data.country;
    return !hasAnyField || (data.street1 && data.street1.length > 0);
  },
  { message: 'Street address (street1) is required when providing address details', path: ['street1'] }
);

export type Address = z.infer<typeof addressSchema>;

// ============================================
// Status Enums
// ============================================

/**
 * Common entity status values
 */
export const entityStatusSchema = z.enum(['active', 'inactive', 'archived']);
export type EntityStatus = z.infer<typeof entityStatusSchema>;

// ============================================
// Base Entity Schema
// ============================================

/**
 * Base fields present on all DynamoDB entities
 */
export const baseEntitySchema = z.object({
  tenantId: z.string(),
  entityKey: z.string(),
  entityType: z.string(),
  createdAt: isoDateSchema,
  createdBy: z.string(),
  updatedAt: isoDateSchema,
  updatedBy: z.string(),
  version: z.number().int().min(0),
});

export type BaseEntity = z.infer<typeof baseEntitySchema>;

// ============================================
// Request Context (Internal)
// ============================================

/**
 * Request context extracted from JWT
 */
export const requestContextSchema = z.object({
  userId: z.string(),
  jwtToken: z.string(),
  tenantId: z.string(),
  userName: z.string().optional(),
  userRole: z.string().optional(),
  userAvatar: z.string().optional(),
});

export type RequestContext = z.infer<typeof requestContextSchema>;


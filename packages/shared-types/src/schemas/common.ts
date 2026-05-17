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
 * Date string in YYYY-MM-DD format (for dates without time).
 * Accepts Gregorian (AD) dates from 1900–2100.
 * All dates must be in Gregorian calendar; BS↔AD conversion
 * happens at the display/input layer (see bikram-sambat.ts).
 */
export const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Date must be in YYYY-MM-DD format'
).refine(
  (date) => !isNaN(Date.parse(date)),
  'Invalid date'
).refine(
  (date) => {
    const year = parseInt(date.substring(0, 4), 10);
    return year >= 1900 && year <= 2100;
  },
  'Date year must be between 1900 and 2100 (Gregorian/AD calendar).',
);

/**
 * Bikram Sambat (BS) date string in YYYY/MM/DD format.
 * BS calendar table covers years 2000–2090 (see bikram-sambat.ts).
 * The actual day-of-month range is variable per BS year+month (29–32);
 * full validation lives in `bsToGregorian`, which throws on out-of-range
 * BS dates. The regex here is the cheap shape check.
 */
export const bsDateSchema = z.string().regex(
  /^\d{4}\/\d{2}\/\d{2}$/,
  'BS date must be in YYYY/MM/DD format',
).refine(
  (date) => {
    const year = parseInt(date.substring(0, 4), 10);
    return year >= 2000 && year <= 2090;
  },
  'BS year must be between 2000 and 2090.',
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
 *
 * Used by Student / Family / Guardian. The legacy `street1`/`state`/`zipCode`
 * shape is preserved unchanged for GENERIC-archetype tenants (US, etc.). The
 * four optional Nepal-aware extension fields (wardNumber, municipality,
 * district, province) are populated by PABSON-archetype tenants only — see
 * Sprint A.0 ADR `docs/decisions/region-aware-forms-divergence.md`.
 *
 * No NPL-conditional refinement is added here intentionally — PABSON-specific
 * validation runs at the frontend `<AddressFieldsNepal>` layer (Sprint A.8).
 * Adding a backend NPL refinement would force every existing GENERIC tenant
 * with `country='NPL'` (none today, but a possible future migration target)
 * to re-validate, which is out of scope.
 */
export const addressSchema = z.object({
  street1: z.string().max(200).optional(),
  street2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),

  // Nepal-aware extension fields (Sprint A.1) — optional for all archetypes.
  // For PABSON tenants, populated by AddressFieldsNepal (Sprint A.8). For
  // GENERIC tenants, left undefined.
  wardNumber: z.string().max(10).optional(),
  municipality: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
}).refine(
  (data) => {
    // If any address field is provided, street1 is required.
    // Legacy fields + Nepal extension fields all count as "any field" — a
    // partial Nepal address still needs a street/tole as the anchor.
    const hasAnyField =
      data.street2 || data.city || data.state || data.zipCode || data.country ||
      data.wardNumber || data.municipality || data.district || data.province;
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


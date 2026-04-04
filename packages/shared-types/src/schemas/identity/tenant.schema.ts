/**
 * Tenant Schemas - Identity Service
 * 
 * Zod schemas for tenant management DTOs.
 */

import { z } from 'zod';
import { emailSchema, isoDateSchema, urlSchema, createPaginatedResponseSchema } from '../common';

// ============================================
// Enums
// ============================================

export const tenantTierSchema = z.enum(['basic', 'premium', 'advanced']);
export type TenantTier = z.infer<typeof tenantTierSchema>;

export const tenantStatusSchema = z.enum(['active', 'inactive', 'suspended', 'trial']);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

// ============================================
// Tenant Address Schema
// ============================================

export const tenantAddressSchema = z.object({
  street1: z.string().min(1),
  street2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1),
  country: z.string().default('USA').optional(),
});

export type TenantAddressDto = z.infer<typeof tenantAddressSchema>;

// ============================================
// Tenant Branding Schema
// ============================================

const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

export const tenantBrandingSchema = z.object({
  logoUrl: urlSchema.optional(),
  faviconUrl: urlSchema.optional(),
  primaryColor: z.string().regex(hexColorRegex, 'Must be a valid hex color (#RRGGBB)').optional(),
  secondaryColor: z.string().regex(hexColorRegex, 'Must be a valid hex color (#RRGGBB)').optional(),
  customDomain: z.string().optional(),
});

export type TenantBrandingDto = z.infer<typeof tenantBrandingSchema>;

// ============================================
// Update Tenant Schema
// ============================================

export const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  contactEmail: emailSchema.optional(),
  contactPhone: z.string().optional(),
  address: tenantAddressSchema.optional(),
  status: tenantStatusSchema.optional(),
  branding: tenantBrandingSchema.optional(),
});

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;

// ============================================
// Tenant Response Schema
// ============================================

export const tenantResponseSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  subdomain: z.string(),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  address: tenantAddressSchema.optional(),
  tier: tenantTierSchema,
  status: tenantStatusSchema,
  country: z.string().length(3).optional(),
  features: z.record(z.boolean()).optional(),
  limits: z.record(z.number()).optional(),
  branding: tenantBrandingSchema.optional(),
  schoolCount: z.number().int().min(0).optional(),
  userCount: z.number().int().min(0).optional(),
  studentCount: z.number().int().min(0).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type TenantResponseDto = z.infer<typeof tenantResponseSchema>;

// ============================================
// Tenant Lookup Response Schema
// ============================================

export const tenantLookupResponseSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  subdomain: z.string(),
  tier: tenantTierSchema,
  status: tenantStatusSchema,
  branding: tenantBrandingSchema.optional(),
});

export type TenantLookupResponseDto = z.infer<typeof tenantLookupResponseSchema>;

// ============================================
// Workspace Settings Schemas
// ============================================

export const regionalSettingsSchema = z.object({
  defaultTimezone: z.string().default('America/New_York'),
  defaultLocale: z.string().default('en-US'),
  defaultDateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).default('MM/DD/YYYY'),
  defaultTimeFormat: z.enum(['12h', '24h']).default('12h'),
  defaultWeekStartsOn: z.enum(['sunday', 'monday']).default('sunday'),
  defaultCurrency: z.string().default('USD'),
  defaultCalendarSystem: z.enum(['gregorian', 'bikram_sambat']).default('gregorian'),
  enableDualDateDisplay: z.boolean().default(false),
  defaultNumberFormat: z.enum(['south_asian', 'international']).default('international'),
});

export type RegionalSettingsDto = z.infer<typeof regionalSettingsSchema>;

export const workspaceBrandingSchema = z.object({
  organizationName: z.string().max(200),
  logoUrl: urlSchema.optional(),
  primaryColor: z.string().regex(hexColorRegex, 'Must be a valid hex color (#RRGGBB)').optional(),
  accentColor: z.string().regex(hexColorRegex, 'Must be a valid hex color (#RRGGBB)').optional(),
});

export type WorkspaceBrandingDto = z.infer<typeof workspaceBrandingSchema>;

export const policySettingsSchema = z.object({
  defaultAttendancePolicy: z.enum(['daily', 'period', 'both']).default('daily'),
});

export type PolicySettingsDto = z.infer<typeof policySettingsSchema>;

export const workspaceSettingsResponseSchema = z.object({
  tenantId: z.string(),
  regional: regionalSettingsSchema,
  branding: workspaceBrandingSchema,
  policies: policySettingsSchema,
  isLocked: z.boolean().default(false),
  lockReason: z.string().optional(),
  workspaceConfirmedAt: z.string().optional(),
  onboardingCompletedAt: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type WorkspaceSettingsResponseDto = z.infer<typeof workspaceSettingsResponseSchema>;

export const updateWorkspaceSettingsSchema = z.object({
  regional: regionalSettingsSchema.partial().optional(),
  branding: workspaceBrandingSchema.partial().optional(),
  policies: policySettingsSchema.partial().optional(),
});

export type UpdateWorkspaceSettingsDto = z.infer<typeof updateWorkspaceSettingsSchema>;


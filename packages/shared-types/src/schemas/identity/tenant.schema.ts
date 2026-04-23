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

/**
 * Archetype — umbrella operational pattern (PABSON Nepal, future CBSE India).
 * V1 runtime validation accepts only 'PABSON' and 'GENERIC'; the reserved
 * values appear in the type so archetype-aware code is forward-compatible.
 * Write-once at provisioning, classified as immutable in field-governance.
 */
export const archetypeSchema = z.enum(['PABSON', 'GENERIC', 'CBSE_IN', 'NAIS_US', 'GEMS_UAE']);
export type Archetype = z.infer<typeof archetypeSchema>;

export const activeArchetypeSchema = z.enum(['PABSON', 'GENERIC']);
export type ActiveArchetype = z.infer<typeof activeArchetypeSchema>;

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

/**
 * Immutable-field rejector. `z.never()` rejects any non-undefined value
 * with the supplied message; `.optional()` keeps the field absent-friendly
 * so omitting it is the normal path. Emitting a targeted message via the
 * errorMap is materially better UX than Zod's default silent strip — a
 * client that tries to patch an immutable field now learns exactly why.
 */
const immutableField = (name: string, reason = 'set at provisioning, cannot be changed') =>
  z.never({
    errorMap: () => ({ message: `${name} is immutable — ${reason}` }),
  }).optional();

export const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  contactEmail: emailSchema.optional(),
  contactPhone: z.string().optional(),
  address: tenantAddressSchema.optional(),
  status: tenantStatusSchema.optional(),
  branding: tenantBrandingSchema.optional(),
  // Immutable identity fields — listed so Zod rejects with a targeted error
  // rather than silently stripping them (Sprint B.7 contract requirement).
  archetype: immutableField('archetype'),
  country: immutableField('country'),
  tier: immutableField('tier', 'change tier via the subscription workflow'),
  subdomain: immutableField('subdomain'),
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
  archetype: archetypeSchema.optional(),
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

/**
 * Feature flag keys used to gate in-flight workflows on a per-tenant basis.
 *
 * Flags default to `false`. Flip via PATCH /tenants/:id/workspace-settings
 * `{ features: { <key>: true } }`. Rolling a feature back is a DDB write —
 * no redeploy required.
 *
 * Add a new flag only when the behavior change is user-visible or
 * data-path-altering. Pure refactors don't need a flag.
 *
 * Keys:
 * - iemis.asyncImport          — route IEMIS uploads through the async job worker
 *                                instead of the synchronous controller path
 * - iemis.descriptorEnrichment — map IEMIS demographic columns to Ed-Fi
 *                                descriptor URIs on Student (Sprint 2)
 */
export const FEATURE_FLAG_KEYS = [
  'iemis.asyncImport',
  'iemis.descriptorEnrichment',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/**
 * Per-tenant feature-flag map. Only declared keys are accepted; unknown
 * keys are silently stripped by Zod. Every value is a boolean; default
 * for an absent key is `false` (enforced by `isFeatureEnabled`).
 */
export const featureFlagsSchema = z
  .object(
    Object.fromEntries(
      FEATURE_FLAG_KEYS.map((k) => [k, z.boolean().optional()]),
    ) as Record<FeatureFlagKey, z.ZodOptional<z.ZodBoolean>>,
  )
  .strict();

export type FeatureFlagsDto = z.infer<typeof featureFlagsSchema>;

/**
 * Read a flag with `false` default for any key not present. Callers should
 * always use this helper rather than indexing directly, so unset flags
 * behave predictably.
 */
export function isFeatureEnabled(
  flags: FeatureFlagsDto | undefined,
  key: FeatureFlagKey,
): boolean {
  return flags?.[key] === true;
}

/**
 * A single (school, academic-year) pair that is currently holding the
 * workspace in a locked state. Populated when `isLocked=true`; empty array
 * otherwise. Multi-school tenants can surface every blocker so the admin
 * knows exactly which year on which school must close before
 * data-integrity-critical regional fields unlock.
 */
export const workspaceLockHolderSchema = z.object({
  schoolId: z.string(),
  schoolName: z.string(),
  yearId: z.string(),
  yearName: z.string(),
  activatedAt: z.string().optional(),
});

export type WorkspaceLockHolder = z.infer<typeof workspaceLockHolderSchema>;

export const workspaceSettingsResponseSchema = z.object({
  tenantId: z.string(),
  regional: regionalSettingsSchema,
  branding: workspaceBrandingSchema,
  policies: policySettingsSchema,
  /**
   * Per-tenant boolean feature flags. Default to an empty map; consumers
   * MUST read via `isFeatureEnabled` so absent keys resolve to `false`.
   */
  features: featureFlagsSchema.optional(),
  isLocked: z.boolean().default(false),
  lockReason: z.string().optional(),
  /**
   * Present when `isLocked=true`. Enumerates every (school, active-year)
   * pair currently blocking edits to data-integrity-critical regional
   * fields. Empty / omitted when the workspace is unlocked.
   */
  lockHolders: z.array(workspaceLockHolderSchema).default([]),
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
  features: featureFlagsSchema.optional(),
});

export type UpdateWorkspaceSettingsDto = z.infer<typeof updateWorkspaceSettingsSchema>;


/**
 * Workspace Settings Entity for Identity Service
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SETTINGS#WORKSPACE
 *
 * NOTE: COUNTRY_DEFAULTS + ARCHETYPE_DEFAULTS + RegionalSettings live INLINE
 * here (not imported from `@aibrains/shared-types`) so server/application's
 * Dockerfile keeps its simple `npm install` pattern (every dep resolvable
 * from npm registry without needing workspace linking inside a container).
 *
 * The canonical source is `packages/shared-types/src/locale/tenant-locale-defaults.ts`.
 * Consumer copies / synth-time inlines:
 *   - server/lib/bootstrap-template/tenant-seeder-lambda.ts (synth-time
 *     JSON.stringify injection of COUNTRY_DEFAULTS + ARCHETYPE_DEFAULTS from
 *     @aibrains/shared-types)
 *   - client/AdminWeb/src/pages/Tenants/TenantCreate.tsx (imports from
 *     @aibrains/shared-types directly)
 *   - THIS FILE (hand-duplicated; see Dockerfile rationale above)
 *
 * Adding a new country or archetype = update the canonical package (shared-types),
 * bump+publish shared-types, AND update this file. Tradeoff accepted to avoid
 * complicating the Dockerfile build pattern with private workspace packages.
 * CI check (tenants.service.spec.ts / workspace-settings.entity.spec.ts)
 * asserts the two stay in sync.
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

/**
 * Regional settings for the workspace
 */
export interface RegionalSettings {
  defaultTimezone: string;
  defaultLocale: string;
  defaultDateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  defaultTimeFormat: '12h' | '24h';
  defaultWeekStartsOn: 'sunday' | 'monday';
  defaultCurrency: string;
  defaultCalendarSystem: 'gregorian' | 'bikram_sambat';
  enableDualDateDisplay: boolean;
  defaultNumberFormat: 'south_asian' | 'international';
}

/**
 * Branding settings for the workspace
 */
export interface BrandingSettings {
  organizationName: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

/**
 * Policy settings for the workspace
 */
export interface PolicySettings {
  defaultAttendancePolicy: 'daily_presence' | 'per_section_granular';
}

/**
 * Per-tenant feature flags.
 *
 * Keys must stay aligned with `FEATURE_FLAG_KEYS` in
 * `@aibrains/shared-types` (tenant.schema.ts). A flag absent from the
 * map is treated as `false` by every consumer of `isFeatureEnabled`.
 */
export type FeatureFlags = Partial<Record<string, boolean>>;

/**
 * Workspace settings stored in DynamoDB
 */
export interface WorkspaceSettings extends BaseEntity {
  entityType: 'WORKSPACE_SETTINGS';

  regional: RegionalSettings;
  branding: BrandingSettings;
  policies: PolicySettings;

  /**
   * Per-tenant feature flags. Absent / undefined means no flags have
   * been explicitly set; `isFeatureEnabled` returns `false` in that case.
   */
  features?: FeatureFlags;

  /**
   * True once any academic year has transitioned to `status='active'` for
   * this tenant (Project Midnight Lockin P0.16). Blocks regional-field edits
   * via the gate at `tenants.service.ts:282`.
   *
   * TODO(TE.12, Midnight Lockin follow-up — see
   * historical lock-in implementation review, §7 Q4):
   * No `force-unlock` / system-admin override endpoint exists yet. If an
   * operator needs to unlock settings post-activation (e.g. a misconfigured
   * currency discovered after year rollover), the current procedure is a
   * manual DDB UpdateItem on `TENANT#<tid>` SK `SETTINGS#WORKSPACE`:
   *
   *   aws dynamodb update-item \
   *     --table-name edforge-identity-basic \
   *     --key '{"tenantId":{"S":"<tid>"},"entityKey":{"S":"SETTINGS#WORKSPACE"}}' \
   *     --update-expression 'SET isLocked = :false REMOVE lockReason' \
   *     --expression-attribute-values '{":false":{"BOOL":false}}'
   *
   * Accepted by Shoaib as a V1 known-limitation. Promote to a real
   * system-admin endpoint + audit entry in P1 (target: before the second
   * archetype onboards, so misconfig recovery doesn't require console DDB
   * access in prod).
   */
  isLocked: boolean;
  lockReason?: string;
  workspaceConfirmedAt?: string;
  onboardingCompletedAt?: string;
}

/**
 * Country-specific regional defaults.
 * Adding a new country requires only a new map entry — no conditional logic changes.
 */
export const COUNTRY_DEFAULTS: Record<string, Partial<RegionalSettings>> = {
  NPL: {
    defaultCurrency: 'NPR',
    defaultTimezone: 'Asia/Kathmandu',
    defaultCalendarSystem: 'bikram_sambat',
    enableDualDateDisplay: true,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'ne-NP',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '24h',
    defaultWeekStartsOn: 'sunday',
  },
  USA: {
    defaultCurrency: 'USD',
    defaultTimezone: 'America/New_York',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'international',
    defaultLocale: 'en-US',
    defaultDateFormat: 'MM/DD/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'sunday',
  },
  IND: {
    defaultCurrency: 'INR',
    defaultTimezone: 'Asia/Kolkata',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'en-IN',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'monday',
  },
};

/**
 * Archetype-specific regional defaults.
 *
 * Archetype takes precedence over country because an archetype encodes
 * stronger guarantees (PABSON always BS calendar, always NPR, Sun-Fri
 * school week) than a country code alone. V1 only applies PABSON and
 * GENERIC; reserved archetype values don't have entries yet.
 *
 * Kept inline (not imported from @edforge/tenant-locale-defaults) for the
 * Dockerfile reason described at the top of this file. Must stay in sync
 * with the canonical package.
 */
export const ARCHETYPE_DEFAULTS: Record<string, Partial<RegionalSettings>> = {
  PABSON: {
    defaultCurrency: 'NPR',
    defaultTimezone: 'Asia/Kathmandu',
    defaultCalendarSystem: 'bikram_sambat',
    enableDualDateDisplay: true,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'ne-NP',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '24h',
    defaultWeekStartsOn: 'sunday',
  },
  GENERIC: {
    defaultCurrency: 'USD',
    defaultTimezone: 'America/New_York',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'international',
    defaultLocale: 'en-US',
    defaultDateFormat: 'MM/DD/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'sunday',
  },
};

/** US defaults used as baseline when no country or archetype is specified */
const US_DEFAULTS: RegionalSettings = {
  defaultTimezone: 'America/New_York',
  defaultLocale: 'en-US',
  defaultDateFormat: 'MM/DD/YYYY',
  defaultTimeFormat: '12h',
  defaultWeekStartsOn: 'sunday',
  defaultCurrency: 'USD',
  defaultCalendarSystem: 'gregorian',
  enableDualDateDisplay: false,
  defaultNumberFormat: 'international',
};

/**
 * Create default workspace settings for a tenant.
 *
 * Precedence: US_DEFAULTS ← country ← archetype.
 * Archetype wins over country (PABSON beats NPL when both set).
 * Unknown archetype/country → fall through to the next layer.
 */
export function createDefaultWorkspaceSettings(
  tenantId: string,
  organizationName: string,
  createdBy: string,
  country?: string,
  archetype?: string,
): WorkspaceSettings {
  const now = new Date().toISOString();
  const countryOverrides = country ? (COUNTRY_DEFAULTS[country.toUpperCase()] ?? {}) : {};
  const archetypeOverrides = archetype ? (ARCHETYPE_DEFAULTS[archetype.toUpperCase()] ?? {}) : {};

  return {
    tenantId,
    entityKey: EntityKeyBuilder.workspaceSettings(),
    entityType: 'WORKSPACE_SETTINGS',
    regional: { ...US_DEFAULTS, ...countryOverrides, ...archetypeOverrides },
    branding: {
      organizationName,
    },
    policies: {
      defaultAttendancePolicy: 'daily_presence',
    },
    isLocked: false,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy,
    version: 1,
  };
}

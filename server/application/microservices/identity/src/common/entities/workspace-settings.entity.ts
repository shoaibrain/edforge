/**
 * Workspace Settings Entity for Identity Service
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SETTINGS#WORKSPACE
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
  defaultAttendancePolicy: 'daily' | 'period' | 'both';
}

/**
 * Workspace settings stored in DynamoDB
 */
export interface WorkspaceSettings extends BaseEntity {
  entityType: 'WORKSPACE_SETTINGS';

  regional: RegionalSettings;
  branding: BrandingSettings;
  policies: PolicySettings;

  isLocked: boolean;
  lockReason?: string;
  workspaceConfirmedAt?: string;
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
    defaultWeekStartsOn: 'monday',
  },
};

/** US defaults used as baseline when no country is specified */
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
 * When country is provided and exists in COUNTRY_DEFAULTS, those values are merged
 * over US defaults. Unknown or missing country falls back to US defaults.
 */
export function createDefaultWorkspaceSettings(
  tenantId: string,
  organizationName: string,
  createdBy: string,
  country?: string,
): WorkspaceSettings {
  const now = new Date().toISOString();
  const countryOverrides = country ? (COUNTRY_DEFAULTS[country.toUpperCase()] ?? {}) : {};

  return {
    tenantId,
    entityKey: EntityKeyBuilder.workspaceSettings(),
    entityType: 'WORKSPACE_SETTINGS',
    regional: { ...US_DEFAULTS, ...countryOverrides },
    branding: {
      organizationName,
    },
    policies: {
      defaultAttendancePolicy: 'daily',
    },
    isLocked: false,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy,
    version: 1,
  };
}

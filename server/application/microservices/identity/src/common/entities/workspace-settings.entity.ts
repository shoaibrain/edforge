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
}

/**
 * Create default workspace settings for a tenant
 */
export function createDefaultWorkspaceSettings(
  tenantId: string,
  organizationName: string,
  createdBy: string,
): WorkspaceSettings {
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.workspaceSettings(),
    entityType: 'WORKSPACE_SETTINGS',
    regional: {
      defaultTimezone: 'America/New_York',
      defaultLocale: 'en-US',
      defaultDateFormat: 'MM/DD/YYYY',
      defaultTimeFormat: '12h',
      defaultWeekStartsOn: 'sunday',
      defaultCurrency: 'USD',
      defaultCalendarSystem: 'gregorian',
      enableDualDateDisplay: false,
      defaultNumberFormat: 'international',
    },
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

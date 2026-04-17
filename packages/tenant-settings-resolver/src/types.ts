/**
 * Read-side projection of the workspace settings DDB row.
 *
 * The full entity (incl. createdBy, version, audit fields) lives in the
 * identity service. Consumers of this package only care about the
 * "settings" payload, so we expose a narrow read shape.
 */

import type { RegionalSettings } from '@edforge/tenant-locale-defaults';

export type { RegionalSettings };

export interface TenantBrandingSettings {
  organizationName: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

export interface TenantPolicySettings {
  defaultAttendancePolicy: 'daily' | 'period' | 'both';
}

/** Read-only workspace settings exposed by the resolver. */
export interface TenantWorkspaceSettings {
  tenantId: string;
  regional: RegionalSettings;
  branding: TenantBrandingSettings;
  policies: TenantPolicySettings;
  isLocked: boolean;
  lockReason?: string;
  workspaceConfirmedAt?: string;
  onboardingCompletedAt?: string;
}

/**
 * Errors a resolver can throw. Consumers should handle these explicitly
 * (e.g., the analytics aggregator falls back to fleet defaults on
 * `TenantSettingsNotFoundError`).
 */
export class TenantSettingsNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Workspace settings not found for tenant: ${tenantId}`);
    this.name = 'TenantSettingsNotFoundError';
  }
}

export class TenantSettingsBackendError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TenantSettingsBackendError';
  }
}

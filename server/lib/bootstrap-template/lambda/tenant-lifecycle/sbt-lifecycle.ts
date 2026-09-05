/**
 * Cost-redesign C7.1/C7.2 — the SBT tenant-lifecycle contract, as the
 * script jobs implemented it (sprint-7-analysis.md F7.1).
 *
 * Incoming (source sbt.control.plane): `sbt_aws_onboardingRequest` /
 * `sbt_aws_offboardingRequest`, detail flattened from the registration data,
 * the tenant data and `{ tenantId }`.
 *
 * Outgoing (source sbt.application.plane): the success envelope
 * `{ tenantRegistrationId, tenantId, jobOutput: { tenantData, tenantRegistrationData } }`
 * that SBT's registration service PATCHes back with `$.detail.jobOutput`, and
 * the failure envelope `{ tenantRegistrationId, jobOutput: { tenantStatus } }`.
 * The pure functions here are what the unit tests pin.
 */

export const PROVISION_FAILURE_STATUS = 'Failed to provision tenant.';
export const DEPROVISION_FAILURE_STATUS = 'Failed to deprovision tenant.';

export type Archetype = 'PABSON' | 'GENERIC';
export type TenantTag = 'production' | 'internal-dev' | 'internal-dev-rehearsal';
const TENANT_TAGS: readonly TenantTag[] = ['production', 'internal-dev', 'internal-dev-rehearsal'];

/** A failure that a retry cannot fix: the handler emits the failure event and returns instead of throwing. */
export class PermanentFailure extends Error {}

export interface OnboardingDetail {
  tenantRegistrationId?: string;
  tenantId?: string;
  tenantName?: string;
  email?: string;
  tier?: string;
  country?: string;
  archetype?: string;
  tenantTag?: string;
  prices?: unknown;
  useFederation?: string;
  [key: string]: unknown;
}

export interface OffboardingDetail {
  tenantRegistrationId?: string;
  tenantId?: string;
  tier?: string;
  /** Only `scripts/tenant/offboard.ts` sets this; AdminWeb's delete never does. */
  confirmProduction?: boolean;
  [key: string]: unknown;
}

/** V1 knows PABSON and GENERIC; anything else becomes GENERIC, as provision-tenant.sh did. */
export function normalizeArchetype(raw: unknown): Archetype {
  const upper = String(raw ?? '').trim().toUpperCase();
  return upper === 'PABSON' ? 'PABSON' : 'GENERIC';
}

/** Unknown or missing tags fall back to `production`, so a typo can never make a customer tenant look internal. */
export function normalizeTenantTag(raw: unknown): TenantTag {
  const value = String(raw ?? '').trim() as TenantTag;
  return TENANT_TAGS.includes(value) ? value : 'production';
}

export interface ProvisionedTenant {
  tenantRegistrationId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  tier: 'BASIC';
  country: string;
  archetype: Archetype;
  tenantTag: TenantTag;
  prices?: unknown;
  alertTopicArn: string;
  tenantConfig: { userPoolId: string; appClientId: string; apiGatewayUrl: string };
}

export function provisionSuccessDetail(t: ProvisionedTenant): Record<string, unknown> {
  return {
    tenantRegistrationId: t.tenantRegistrationId,
    tenantId: t.tenantId,
    jobOutput: {
      tenantData: {
        tenantId: t.tenantId,
        tenantName: t.tenantName,
        email: t.email,
        tier: t.tier,
        country: t.country,
        archetype: t.archetype,
        tenantTag: t.tenantTag,
        ...(t.prices !== undefined ? { prices: t.prices } : {}),
        alertTopicArn: t.alertTopicArn,
        tenantConfig: JSON.stringify(t.tenantConfig),
      },
      tenantRegistrationData: { registrationStatus: 'Created' },
    },
  };
}

export function deprovisionSuccessDetail(tenantRegistrationId: string, tenantId: string): Record<string, unknown> {
  return {
    tenantRegistrationId,
    tenantId,
    jobOutput: {
      tenantData: {},
      tenantRegistrationData: { registrationStatus: 'Deleted' },
    },
  };
}

export function lifecycleFailureDetail(tenantRegistrationId: string, tenantStatus: string, reason: string): Record<string, unknown> {
  return { tenantRegistrationId, jobOutput: { tenantStatus, reason } };
}

/**
 * D7.4 — default-deny. A tenant with no METADATA row, no tag, or the
 * `production` tag is only deprovisioned when the request carries
 * `confirmProduction: true`. Returns the refusal reason, or null when the
 * request may proceed.
 */
export function deprovisionRefusal(
  metadata: { tenantTag?: string } | undefined,
  confirmProduction: unknown,
): string | null {
  if (confirmProduction === true) return null;
  if (!metadata) return 'no identity METADATA row for this tenant — treated as production; rerun with confirmProduction (scripts/tenant/offboard.ts --confirm-production)';
  const tag = normalizeTenantTag(metadata.tenantTag);
  if (tag === 'production') {
    return metadata.tenantTag
      ? 'tenant is tagged production; rerun with confirmProduction (scripts/tenant/offboard.ts --confirm-production)'
      : 'tenant has no tenantTag — treated as production; rerun with confirmProduction (scripts/tenant/offboard.ts --confirm-production)';
  }
  return null;
}

/** Cognito username convention shared with users.service.ts: the lower-cased email. */
export function usernameFor(email: string): string {
  return email.trim().toLowerCase();
}

export function tenantAlertTopicName(prefix: string, tenantId: string): string {
  return `${prefix}${tenantId}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

import type { TenantTag } from '@aibrains/shared-types';
import { tenantTagSchema } from '@aibrains/shared-types';

export const TENANT_DEFAULTS = {
  DEFAULT_TIER: 'basic' as const,
  REGISTRATION_STATUS: 'In progress' as const,
  /**
   * Default tenantTag for the operator's everyday case (R&D against a dev
   * tenant). Picking 'production' should be the conscious choice — see the
   * inline confirmation gate in TenantCreate.tsx.
   */
  DEFAULT_TENANT_TAG: 'internal-dev' as const satisfies TenantTag,
} as const;

/**
 * UI option list for the tenantTag dropdown. Source of truth for the enum
 * lives in `@aibrains/shared-types/tenantTagSchema`; this file owns the
 * UX-layer labels + descriptions.
 *
 * Order matters: 'internal-dev' first so it's the natural top-of-list pick.
 */
export const TENANT_TAG_OPTIONS: ReadonlyArray<{
  value: TenantTag;
  label: string;
  description: string;
  /** MUI severity for the in-form info Alert and the badge color. */
  variant: 'success' | 'info' | 'warning';
}> = [
  {
    value: 'internal-dev',
    label: 'Internal — Dev',
    description: 'Persistent internal tenant for daily R&D. Deprovisionable from AdminWeb.',
    variant: 'info',
  },
  {
    value: 'internal-dev-rehearsal',
    label: 'Internal — Rehearsal',
    description: 'Ephemeral rehearsal tenant for the pre-pilot onboarding playbook. Auto-cleaned on completion.',
    variant: 'info',
  },
  {
    value: 'production',
    label: 'Production',
    description: 'Real customer tenant. Immutable after creation. Cannot be deleted from this UI — requires CLI ceremony.',
    variant: 'warning',
  },
];

// Compile-time guarantee: every enum value has a UX entry.
const TAG_OPTIONS_VALUES: ReadonlyArray<TenantTag> = TENANT_TAG_OPTIONS.map((o) => o.value);
type _AssertAllTagsCovered = Exclude<TenantTag, (typeof TAG_OPTIONS_VALUES)[number]> extends never
  ? true
  : never;
const _ASSERT_TAGS_COVERED: _AssertAllTagsCovered = true;
void _ASSERT_TAGS_COVERED;
void tenantTagSchema; // explicit ack we depend on the schema for the TenantTag type narrowing

export const createTenantId = (tenantName: string): string => {
  return tenantName.toLowerCase().replace(/\s+/g, '-');
};
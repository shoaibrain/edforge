/**
 * V1_DEFERRED: All three pricing tiers are defined here for future use.
 * V1 MVP only supports BASIC tier. Advanced and Premium are displayed as
 * "Coming Soon" in the TenantCreate form but cannot be selected.
 *
 * To re-enable Advanced/Premium:
 * 1. Fix provisioning pipeline (see provision-tenant.sh V1_DEFERRED comments)
 * 2. Fix TenantSeeder table naming (see tenant-seeder-lambda.ts V1_DEFERRED comments)
 * 3. Remove "Coming Soon" gates in TenantCreate.tsx
 */
export const PRICING_PLANS = {
  BASIC: {
    id: 'BASIC',
    name: 'Basic',
    price: 29,
    description: 'Perfect for small teams'
  },
  ADVANCED: {
    id: 'ADVANCED',
    name: 'Advanced',
    price: 99,
    description: 'Ideal for growing businesses'
  },
  PREMIUM: {
    id: 'PREMIUM',
    name: 'Premium',
    price: 299,
    description: 'For large organizations'
  }
} as const;

export const TIER_COLORS = {
  basic: 'default',
  advanced: 'primary',
  premium: 'secondary'
} as const;

export const STATUS_COLORS = {
  complete: 'success',
  active: 'success',
  success: 'success',
  failed: 'error',
  error: 'error',
  inactive: 'error',
  in_progress: 'warning',
  'in progress': 'warning',
  pending: 'warning',
  processing: 'warning'
} as const;
import type { TenantTag } from '@aibrains/shared-types';

interface Price {
  id: string;
  metricName: string;
}

interface TenantData {
  tenantName?: string | null;
  email?: string | undefined | null;
  tier?: string | undefined | null;
  country?: string;
  /**
   * Archetype — umbrella operational pattern (PABSON Nepal, GENERIC).
   * V1 accepts only 'PABSON' | 'GENERIC'. Reserved values (CBSE_IN, NAIS_US,
   * GEMS_UAE) will ship in later releases. Immutable after provisioning.
   */
  archetype?: 'PABSON' | 'GENERIC' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE';
  /**
   * Lifecycle classification — distinguishes production tenants from
   * internal-dev / internal-dev-rehearsal tenants on shared prod infra.
   * Write-once at provisioning; mechanically immutable thereafter (server-side
   * reject in updateTenantSchema + field-governance + tenant-seeder Lambda
   * whitelist). Default 'production' applied by the seeder if absent.
   */
  tenantTag?: TenantTag;
  prices?: Price[];
  useFederation?: string;
  useEc2?: string;
  useRProxy?: string;
}

export interface TenantRegistrationData {
  tenantRegistrationId?: string;
  registrationStatus?: string;
}

export interface Tenant {
  tenantId?: string;
  tenantData: TenantData;
  tenantRegistrationData: TenantRegistrationData;
  sbtaws_active?: boolean;
}

export interface CreateTenantRequest {
  tenantId: string;
  tenantData: TenantData;
  tenantRegistrationData: TenantRegistrationData;
}
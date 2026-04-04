/**
 * Tenant Entity for Identity Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: METADATA
 * 
 * GSI1 (Subdomain Lookup):
 * - GSI1PK: SUBDOMAIN#{subdomain}
 * - GSI1SK: TENANT
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
  TenantTier,
  TenantStatus,
} from './base.entity';

/**
 * Tenant entity stored in DynamoDB
 */
export interface Tenant extends BaseEntity {
  entityType: 'TENANT';
  
  // Identity
  tenantId: string;
  name: string;
  subdomain: string;  // Unique across all tenants
  
  // Contact
  contactEmail: string;
  contactPhone?: string;
  
  // Address
  address?: TenantAddress;

  // Country code (ISO 3166-1 alpha-3, written by TenantSeeder during provisioning)
  country?: string;

  // Subscription
  tier: TenantTier;
  status: TenantStatus;
  
  // Trial
  trialStartDate?: string;
  trialEndDate?: string;
  
  // Subscription dates
  subscriptionStartDate?: string;
  subscriptionEndDate?: string;
  
  // Features
  features?: TenantFeatures;
  
  // Limits
  limits?: TenantLimits;
  
  // Branding
  branding?: TenantBranding;
  
  // Statistics
  schoolCount?: number;
  userCount?: number;
  studentCount?: number;
  
  // GSI Keys
  gsi1pk: string;  // SUBDOMAIN#{subdomain}
  gsi1sk: string;  // TENANT
}

/**
 * Tenant address
 */
export interface TenantAddress {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

/**
 * Tenant features configuration
 */
export interface TenantFeatures {
  maxSchools: number;
  maxUsersPerSchool: number;
  maxStudentsPerSchool: number;
  
  // Modules
  enrollment: boolean;
  attendance: boolean;
  grades: boolean;
  curriculum: boolean;
  scheduling: boolean;
  finance: boolean;
  parentPortal: boolean;
  studentPortal: boolean;
  reporting: boolean;
  analytics: boolean;
  
  // Advanced features
  customReports: boolean;
  apiAccess: boolean;
  sso: boolean;
  advancedSecurity: boolean;
  dataExport: boolean;
  multiLanguage: boolean;
}

/**
 * Tenant limits
 */
export interface TenantLimits {
  maxSchools: number;
  maxUsersTotal: number;
  maxStudentsTotal: number;
  maxStorageGB: number;
  maxApiRequestsPerMonth: number;
}

/**
 * Tenant branding
 */
export interface TenantBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  customDomain?: string;
}

/**
 * Default feature sets by tier
 */
export const DEFAULT_FEATURES: Record<TenantTier, TenantFeatures> = {
  basic: {
    maxSchools: 1,
    maxUsersPerSchool: 50,
    maxStudentsPerSchool: 500,
    enrollment: true,
    attendance: true,
    grades: true,
    curriculum: true,
    scheduling: true,
    finance: false,
    parentPortal: true,
    studentPortal: false,
    reporting: true,
    analytics: false,
    customReports: false,
    apiAccess: false,
    sso: false,
    advancedSecurity: false,
    dataExport: true,
    multiLanguage: false,
  },
  premium: {
    maxSchools: 5,
    maxUsersPerSchool: 200,
    maxStudentsPerSchool: 2000,
    enrollment: true,
    attendance: true,
    grades: true,
    curriculum: true,
    scheduling: true,
    finance: true,
    parentPortal: true,
    studentPortal: true,
    reporting: true,
    analytics: true,
    customReports: true,
    apiAccess: true,
    sso: false,
    advancedSecurity: true,
    dataExport: true,
    multiLanguage: true,
  },
  advanced: {
    maxSchools: 100,
    maxUsersPerSchool: 1000,
    maxStudentsPerSchool: 10000,
    enrollment: true,
    attendance: true,
    grades: true,
    curriculum: true,
    scheduling: true,
    finance: true,
    parentPortal: true,
    studentPortal: true,
    reporting: true,
    analytics: true,
    customReports: true,
    apiAccess: true,
    sso: true,
    advancedSecurity: true,
    dataExport: true,
    multiLanguage: true,
  },
};

/**
 * Default limits by tier
 */
export const DEFAULT_LIMITS: Record<TenantTier, TenantLimits> = {
  basic: {
    maxSchools: 1,
    maxUsersTotal: 50,
    maxStudentsTotal: 500,
    maxStorageGB: 5,
    maxApiRequestsPerMonth: 0,
  },
  premium: {
    maxSchools: 5,
    maxUsersTotal: 1000,
    maxStudentsTotal: 10000,
    maxStorageGB: 50,
    maxApiRequestsPerMonth: 100000,
  },
  advanced: {
    maxSchools: 100,
    maxUsersTotal: 100000,
    maxStudentsTotal: 1000000,
    maxStorageGB: 1000,
    maxApiRequestsPerMonth: 10000000,
  },
};

/**
 * Create a new Tenant entity with proper keys
 */
export function createTenantEntity(
  tenantId: string,
  data: Omit<Tenant, 'tenantId' | 'entityKey' | 'entityType' | 'gsi1pk' | 'gsi1sk'>
): Tenant {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.tenantMetadata(),
    entityType: 'TENANT',
    gsi1pk: GSIKeyBuilder.subdomain(data.subdomain),
    gsi1sk: 'TENANT',
    ...data,
  };
}


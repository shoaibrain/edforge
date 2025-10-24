export interface Tenant {
  tenantId: string
  tenantRegistrationId?: string  // ← ADD: Root level field for fallback
  tenantData?: {
    tenantName: string
    email: string
    tier: string
  }
  tenantName?: string
  name?: string
  email?: string
  tier?: string
  tenantRegistrationData?: {
    registrationStatus: string
    tenantRegistrationId: string
  }
  registrationStatus?: string
  status?: string
  state?: string
  tenantStatus?: string
  sbtaws_active?: boolean
}

export interface TenantRegistrationData {
  tenantRegistrationId: string
  tenantName: string
  email: string
  tier: string
  registrationStatus: string
  createdAt?: string
  updatedAt?: string
}

export interface CreateTenantRequest {
  tenantName: string
  tenantEmail: string
  tenantTier: "BASIC" | "ADVANCED" | "PREMIUM"
  isActive?: boolean
}

export interface TenantListResponse {
  data: Tenant[]
  next_token?: string
}


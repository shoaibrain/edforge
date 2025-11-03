"use server"

import serverApiClient from "@/lib/api-server"
import type {
  TenantListResponse,
  TenantRegistrationData,
  CreateTenantRequest,
} from "@/types/tenant"

/**
 * Server Actions for Tenant Operations
 * These actions run exclusively on the server and access tokens from JWT.
 */

/**
 * Server Action: Fetch tenants with pagination
 * @param limit - Number of tenants to fetch per page (default: 18)
 * @param nextToken - Pagination token for fetching next page
 * @returns Tenant list response with pagination info
 * @throws Error if authentication fails or API call fails
 */
export async function getTenantsAction(
  limit: number = 18,
  nextToken?: string
): Promise<TenantListResponse> {
  try {
    const url = nextToken
      ? `/tenants?limit=${limit}&next_token=${nextToken}`
      : `/tenants?limit=${limit}`
    
    return await serverApiClient.get<TenantListResponse>(url)
  } catch (error) {
    console.error("[Server Action] Failed to fetch tenants:", error)
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      throw new Error("Authentication required. Please sign in again.")
    }
    // Re-throw other errors as-is
    throw error
  }
}

/**
 * Server Action: Fetch single tenant by ID
 * @param tenantId - Tenant registration ID or tenant ID
 * @returns Tenant registration data
 * @throws Error if authentication fails or tenant not found
 */
export async function getTenantAction(
  tenantId: string
): Promise<TenantRegistrationData> {
  try {
    if (!tenantId) {
      throw new Error("Tenant ID is required")
    }

    const response = await serverApiClient.get<{ data: TenantRegistrationData }>(
      `/tenant-registrations/${tenantId}`
    )
    return response.data
  } catch (error) {
    console.error("[Server Action] Failed to fetch tenant:", error)
    
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      throw new Error("Authentication required. Please sign in again.")
    }
    
    throw error
  }
}

/**
 * Server Action: Create new tenant
 * 
 * @param tenant - Tenant creation request data
 * @returns Created tenant data
 * 
 * @throws Error if authentication fails or creation fails
 */
export async function createTenantAction(
  tenant: CreateTenantRequest
): Promise<any> {
  try {
    return await serverApiClient.post("/tenant-registrations", tenant)
  } catch (error) {
    console.error("[Server Action] Failed to create tenant:", error)
    
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      throw new Error("Authentication required. Please sign in again.")
    }
    
    throw error
  }
}

/**
 * Server Action: Delete tenant
 * @param tenantId - Tenant registration ID or tenant ID to delete
 * @returns Deletion response
 * @throws Error if authentication fails or deletion fails
 */
export async function deleteTenantAction(tenantId: string): Promise<any> {
  try {
    if (!tenantId) {
      throw new Error("Tenant ID is required")
    }

    return await serverApiClient.delete(`/tenant-registrations/${tenantId}`)
  } catch (error) {
    console.error("[Server Action] Failed to delete tenant:", error)
    
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      throw new Error("Authentication required. Please sign in again.")
    }
    
    throw error
  }
}


import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
// ✅ Server Actions Architecture: Use server actions instead of client-side API client
// Tokens are accessed server-side from JWT (not from cookies), improving security and fixing cookie size issues
import {
  getTenantsAction,
  getTenantAction,
  createTenantAction,
  deleteTenantAction,
} from "@/actions/tenant-actions"
import type {
  Tenant,
  TenantListResponse,
  TenantRegistrationData,
  CreateTenantRequest,
} from "@/types/tenant"

// ✅ Fetch tenants with pagination - now uses server action
export function useTenants(limit = 18) {
  return useInfiniteQuery({
    queryKey: ["tenants", limit],
    queryFn: async ({ pageParam }) => {
      // Call server action instead of direct API call
      // Server action gets token from JWT (server-side), not from cookies
      return await getTenantsAction(limit, pageParam)
    },
    getNextPageParam: (lastPage) => lastPage.next_token,
    initialPageParam: undefined as string | undefined,
  })
}

// ✅ Fetch single tenant - now uses server action
export function useTenant(tenantId: string) {
  return useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: async () => {
      // Call server action instead of direct API call
      return await getTenantAction(tenantId)
    },
    enabled: !!tenantId,
  })
}

// ✅ Create tenant mutation - now uses server action
export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tenant: CreateTenantRequest) => {
      // Call server action instead of direct API call
      return await createTenantAction(tenant)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
    },
  })
}

// ✅ Delete tenant mutation - now uses server action
export function useDeleteTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tenant: Tenant) => {
      const tenantId =
        tenant.tenantRegistrationData?.tenantRegistrationId ||
        tenant.tenantId

      if (!tenantId) {
        throw new Error("Tenant ID not found")
      }

      // Call server action instead of direct API call
      return await deleteTenantAction(tenantId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
    },
  })
}


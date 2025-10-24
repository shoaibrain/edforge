import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import apiClient from "@/lib/api-client"
import type {
  Tenant,
  TenantListResponse,
  TenantRegistrationData,
  CreateTenantRequest,
} from "@/types/tenant"

// Fetch tenants with pagination
export function useTenants(limit = 18) {
  return useInfiniteQuery({
    queryKey: ["tenants", limit],
    queryFn: async ({ pageParam }) => {
      const url = pageParam
        ? `/tenants?limit=${limit}&next_token=${pageParam}`
        : `/tenants?limit=${limit}`
      const { data } = await apiClient.get<TenantListResponse>(url)
      return data
    },
    getNextPageParam: (lastPage) => lastPage.next_token,
    initialPageParam: undefined as string | undefined,
  })
}

// Fetch single tenant
export function useTenant(tenantId: string) {
  return useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: TenantRegistrationData }>(
        `/tenant-registrations/${tenantId}`
      )
      return data.data
    },
    enabled: !!tenantId,
  })
}

// Create tenant mutation
export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tenant: CreateTenantRequest) => {
      const { data } = await apiClient.post("/tenant-registrations", tenant)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
    },
  })
}

// Delete tenant mutation
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

      const { data } = await apiClient.delete(`/tenant-registrations/${tenantId}`, {
        data: tenant,
      })
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
    },
  })
}


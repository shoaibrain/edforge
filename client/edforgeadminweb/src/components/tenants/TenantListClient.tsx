"use client"

import { useTenants, useDeleteTenant } from "@/services/tenant-service"
import { TenantCard } from "./TenantCard"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, AlertCircle } from "lucide-react"
import { useEffect, useRef, useCallback } from "react"

export function TenantListClient() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useTenants(18)

  const deleteMutation = useDeleteTenant()
  const observerTarget = useRef<HTMLDivElement>(null)

  // Infinite scroll with Intersection Observer
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  )

  useEffect(() => {
    const element = observerTarget.current
    if (!element) return

    const observer = new IntersectionObserver(handleObserver, {
      threshold: 0.5,
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [handleObserver])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {error instanceof Error ? error.message : "Failed to load tenants"}
        </AlertDescription>
      </Alert>
    )
  }

  const tenants = data?.pages.flatMap((page) => page.data) ?? []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tenants.map((tenant, index) => (
          <TenantCard
            key={tenant.tenantId || `tenant-${index}`}
            tenant={tenant}
            onDelete={() => deleteMutation.mutate(tenant)}
            isDeleting={deleteMutation.isPending}
          />
        ))}
      </div>

      {/* Infinite scroll trigger */}
      <div ref={observerTarget} className="flex justify-center py-4">
        {isFetchingNextPage && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading more tenants...</span>
          </div>
        )}
        {!hasNextPage && tenants.length > 0 && (
          <p className="text-sm text-muted-foreground">
            All tenants have been loaded
          </p>
        )}
      </div>

      {tenants.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-lg font-medium">No tenants found</p>
          <p className="text-sm text-muted-foreground">
            Create your first tenant to get started
          </p>
        </div>
      )}
    </div>
  )
}


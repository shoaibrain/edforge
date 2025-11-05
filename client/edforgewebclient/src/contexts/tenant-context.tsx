"use client";

/**
 * EdForge EMIS - Tenant Context Provider
 * 
 * NextJS-optimized tenant context that:
 * - Extracts tenantId and tenantTier from NextAuth JWT session
 * - Fetches tenant details server-side via API using tenantId
 * - Provides tenant state to all components via React Context
 * - Handles loading states and errors gracefully
 */

import * as React from "react";
import { useSession } from "next-auth/react";

export interface Tenant {
  id: string;
  name: string;
  tier?: string;
  status?: string;
  createdAt?: string;
  metadata?: Record<string, any>;
}

interface TenantContextValue {
  tenant: Tenant | null;
  loading: boolean;
  error: Error | null;
  refreshTenant: () => Promise<void>;
}

const TenantContext = React.createContext<TenantContextValue | undefined>(undefined);

export function useTenant() {
  const context = React.useContext(TenantContext);
  if (context === undefined) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}

interface TenantProviderProps {
  children: React.ReactNode;
}


export function TenantProvider({ children }: TenantProviderProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [tenant, setTenant] = React.useState<Tenant | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  /**
   * Load tenant information from session and API
   */
  const loadTenant = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Wait for session to be ready
      if (sessionStatus === "loading") {
        return;
      }

      // Extract tenantId from session
      const tenantId = (session?.user as any)?.tenantId;
      const tenantTier = (session?.user as any)?.tenantTier;

      if (!tenantId) {
        console.log("[TenantContext] No tenantId in session");
        setTenant(null);
        setLoading(false);
        return;
      }

      console.log("[TenantContext] Loading tenant:", tenantId, "tier:", tenantTier);

      // Create initial tenant object from session
      const sessionTenant: Tenant = {
        id: tenantId,
        name: tenantId, // Will be fetched from API
        tier: tenantTier,
      };

      setTenant(sessionTenant);

      // Fetch full tenant details from API (server-side)
      // Note: In client components, we can't use serverApiClient directly
      // So we'll create a client-side API route or use the existing API client
      // For now, we'll try to fetch from client-side API
      try {
        const response = await fetch(`/api/tenant/${tenantId}`);
        if (response.ok) {
          const apiTenant = await response.json();
          setTenant({
            id: apiTenant.tenantId || tenantId,
            name: apiTenant.tenantName || apiTenant.name || tenantId,
            tier: apiTenant.tier || tenantTier,
            status: apiTenant.status,
            createdAt: apiTenant.createdAt,
            metadata: apiTenant,
          });
        } else {
          // Use session data if API fails
          console.log("[TenantContext] API fetch failed, using session data");
        }
      } catch (apiError) {
        console.log("[TenantContext] API fetch error, using session data:", apiError);
        // Continue with session data
      }
    } catch (err) {
      console.error("[TenantContext] Error loading tenant:", err);
      setError(err instanceof Error ? err : new Error("Failed to load tenant"));
    } finally {
      setLoading(false);
    }
  }, [session, sessionStatus]);

  /**
   * Refresh tenant information
   */
  const refreshTenant = React.useCallback(async () => {
    await loadTenant();
  }, [loadTenant]);

  // Load tenant when session changes
  React.useEffect(() => {
    loadTenant();
  }, [loadTenant]);

  const value = React.useMemo(
    () => ({
      tenant,
      loading,
      error,
      refreshTenant,
    }),
    [tenant, loading, error, refreshTenant]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}


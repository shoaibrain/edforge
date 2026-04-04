import { useState, useCallback, useEffect } from 'react';
import { Tenant } from '../models/tenant';
import tenantService from '../services/tenantService';
import { handleApiError } from '../types/errors';

export interface DashboardStats {
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
  tierDistribution: { basic: number; advanced: number; premium: number };
  statusDistribution: { complete: number; inProgress: number; failed: number; other: number };
  recentTenants: Tenant[];
}

/**
 * Pure computation function — extracts dashboard stats from a tenant array.
 * Exported separately for unit testing.
 */
export function computeStats(tenants: Tenant[]): DashboardStats {
  let activeCount = 0;
  let inactiveCount = 0;
  const tierDistribution = { basic: 0, advanced: 0, premium: 0 };
  const statusDistribution = { complete: 0, inProgress: 0, failed: 0, other: 0 };

  for (const tenant of tenants) {
    // sbtaws_active: missing/undefined treated as active
    if (tenant.sbtaws_active === false) {
      inactiveCount++;
    } else {
      activeCount++;
    }

    // Tier distribution (handle both nested and flat API responses)
    const tier = (tenant.tenantData?.tier ?? (tenant as any).tier ?? '').toUpperCase();
    if (tier === 'BASIC') tierDistribution.basic++;
    else if (tier === 'ADVANCED') tierDistribution.advanced++;
    else if (tier === 'PREMIUM') tierDistribution.premium++;

    // Status distribution (handle both nested and flat API responses)
    const status = (
      tenant.tenantRegistrationData?.registrationStatus ?? (tenant as any).registrationStatus ?? ''
    ).toLowerCase();
    if (['complete', 'created', 'active'].includes(status)) {
      statusDistribution.complete++;
    } else if (
      ['in progress', 'inprogress', 'provisioning', 'processing', 'pending'].includes(status)
    ) {
      statusDistribution.inProgress++;
    } else if (['failed', 'error'].includes(status)) {
      statusDistribution.failed++;
    } else if (status) {
      statusDistribution.other++;
    }
  }

  // Last 5 tenants (array order from API is creation order)
  const recentTenants = tenants.slice(-5).reverse();

  return {
    totalCount: tenants.length,
    activeCount,
    inactiveCount,
    tierDistribution,
    statusDistribution,
    recentTenants,
  };
}

const EMPTY_STATS: DashboardStats = {
  totalCount: 0,
  activeCount: 0,
  inactiveCount: 0,
  tierDistribution: { basic: 0, advanced: 0, premium: 0 },
  statusDistribution: { complete: 0, inProgress: 0, failed: 0, other: 0 },
  recentTenants: [],
};

export const useDashboardStats = () => {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tenants = await tenantService.fetchTenants();
      setStats(computeStats(tenants));
    } catch (err: any) {
      setError(handleApiError(err));
      setStats(EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    ...stats,
    loading,
    error,
    refetch: fetchStats,
  };
};

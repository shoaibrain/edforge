import api from './api';
import { Tenant, TenantRegistrationData, CreateTenantRequest } from '../models/tenant';
import { environment } from '../config/environment';
import { handleApiError } from '../types/errors';

/**
 * Normalize a flat SBT API tenant response into the nested Tenant structure.
 * The SBT GET /tenants API returns flat objects like:
 *   { tenantName, email, tier, tenantId, sbtaws_active, tenantRegistrationId, ... }
 * but our Tenant model expects nested tenantData / tenantRegistrationData.
 * If the data is already nested (e.g. from navigation state), pass it through unchanged.
 */
function normalizeTenant(raw: any): Tenant {
  // Already normalized — tenantData is a real object with at least one expected field
  if (raw.tenantData && typeof raw.tenantData === 'object' && (raw.tenantData.tenantName || raw.tenantData.email || raw.tenantData.tier)) {
    return raw as Tenant;
  }

  return {
    tenantId: raw.tenantId,
    sbtaws_active: raw.sbtaws_active,
    tenantData: {
      tenantName: raw.tenantName || undefined,
      email: raw.email || undefined,
      tier: raw.tier || undefined,
      country: raw.country || undefined,
      prices: raw.prices ? (typeof raw.prices === 'string' ? JSON.parse(raw.prices) : raw.prices) : undefined,
      useFederation: raw.useFederation || undefined,
      useEc2: raw.useEc2 || undefined,
      useRProxy: raw.useRProxy || undefined,
    },
    tenantRegistrationData: {
      tenantRegistrationId: raw.tenantRegistrationId || undefined,
      registrationStatus: raw.registrationStatus || undefined,
    },
  };
}

class TenantService {
  private baseUrl = environment.apiUrl;
  private tenantsApiUrl = `${this.baseUrl}/tenant-registrations`;
  private tenantsMgmtApiUrl = `${this.baseUrl}/tenants`;

  async fetchTenants(): Promise<Tenant[]> {
    try {
      let allTenants: Tenant[] = [];
      let nextToken: string | undefined;
      const limit = 100;

      do {
        const url = nextToken
          ? `${this.tenantsMgmtApiUrl}?limit=${limit}&next_token=${nextToken}`
          : `${this.tenantsMgmtApiUrl}?limit=${limit}`;

        const response = await api.get<{ data: any[], next_token?: string }>(url);

        if (response.data.data) {
          allTenants = allTenants.concat(response.data.data.map(normalizeTenant));
        }

        nextToken = response.data.next_token;
      } while (nextToken);

      return allTenants;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async fetchTenantsPage(nextToken?: string): Promise<{ data: Tenant[], nextToken?: string }> {
    try {
      const limit = 18; // 18 items for 3-column grid (6 rows × 3 columns)
      const url = nextToken
        ? `${this.tenantsMgmtApiUrl}?limit=${limit}&next_token=${nextToken}`
        : `${this.tenantsMgmtApiUrl}?limit=${limit}`;

      const response = await api.get<{ data: any[], next_token?: string }>(url);

      return {
        data: (response.data.data || []).map(normalizeTenant),
        nextToken: response.data.next_token
      };
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async fetchTenantById(tenantId: string): Promise<Tenant | null> {
    try {
      const allTenants = await this.fetchTenants();
      return allTenants.find(t => t.tenantId === tenantId) || null;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async createTenant(tenant: CreateTenantRequest): Promise<any> {
    try {
      const response = await api.post(this.tenantsApiUrl, tenant);
      return response.data;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async getTenant(id: string): Promise<TenantRegistrationData> {
    try {
      const response = await api.get<{ data: TenantRegistrationData }>(`${this.tenantsApiUrl}/${id}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async deleteTenant(tenant: any): Promise<any> {
    try {
      const tenantId = tenant.tenantRegistrationData?.tenantRegistrationId || 
                      tenant.tenantRegistrationId ||
                      tenant.id ||
                      tenant.tenantId;
      
      if (!tenantId) {
        throw new Error('Tenant ID not found in tenant object');
      }
      
      const response = await api.delete(`${this.tenantsApiUrl}/${tenantId}`, {
        data: tenant,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }
}

export const tenantService = new TenantService();
export default tenantService;
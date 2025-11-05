/**
 * EdForge EMIS - Base Service Class
 * 
 * Reusable base class for all API services with common CRUD operations,
 * error handling, and tenant context management
 */

import { QueryParams } from '@/types/api';
import { handleApiError } from '@/lib/api-errors';
import apiClient from '@/lib/api-client';
import type { AxiosInstance } from 'axios';

/**
 * Base service class for CLIENT-SIDE API services only
 * 
 * CRITICAL: This class contains NO server-side code paths to prevent
 * Turbopack from analyzing server-only imports when bundling client components.
 * 
 * Server-side services should use serverApiClient directly or extend
 * BaseServerService instead.
 */
export abstract class BaseService {
  protected basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }


  /**
   * Build full URL with optional query parameters
   */
  protected buildUrl(path: string = '', params?: QueryParams): string {
    let url = `${this.basePath}${path}`;
    
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();
      
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => searchParams.append(key, String(v)));
          } else {
            searchParams.append(key, String(value));
          }
        }
      });
      
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }
    
    return url;
  }

  /**
   * Execute GET request with error handling (CLIENT-SIDE ONLY)
   */
  protected async get<T = any>(path: string = '', params?: QueryParams): Promise<T> {
    try {
      const url = this.buildUrl(path, params);
      const response = await apiClient.get<T>(url);
      return response.data;
    } catch (error) {
      throw handleApiError(error);
    }
  }

  /**
   * Execute POST request with error handling (CLIENT-SIDE ONLY)
   */
  protected async post<T = any>(path: string = '', data?: any): Promise<T> {
    try {
      const url = this.buildUrl(path);
      const response = await apiClient.post<T>(url, data);
      return response.data;
    } catch (error) {
      throw handleApiError(error);
    }
  }

  /**
   * Execute PUT request with error handling (CLIENT-SIDE ONLY)
   */
  protected async put<T = any>(path: string = '', data?: any): Promise<T> {
    try {
      const url = this.buildUrl(path);
      const response = await apiClient.put<T>(url, data);
      return response.data;
    } catch (error) {
      throw handleApiError(error);
    }
  }

  /**
   * Execute PATCH request with error handling (CLIENT-SIDE ONLY)
   */
  protected async patch<T = any>(path: string = '', data?: any): Promise<T> {
    try {
      const url = this.buildUrl(path);
      const response = await apiClient.patch<T>(url, data);
      return response.data;
    } catch (error) {
      throw handleApiError(error);
    }
  }

  /**
   * Execute DELETE request with error handling (CLIENT-SIDE ONLY)
   */
  protected async delete<T = any>(path: string = ''): Promise<T> {
    try {
      const url = this.buildUrl(path);
      const response = await apiClient.delete<T>(url);
      return response.data;
    } catch (error) {
      throw handleApiError(error);
    }
  }
}


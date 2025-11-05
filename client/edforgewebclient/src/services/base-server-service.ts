/**
 * EdForge EMIS - Base Server Service
 * 
 * Server-side base service that extends BaseService and provides server API client.
 * This file is ONLY used by server-side service instances.
 * 
 * CRITICAL: This file imports api-server which imports token-service (next/headers).
 * It must NEVER be imported by client components.
 */

import serverApiClient from '@/lib/api-server';
import { BaseService } from './base-service';
import type { QueryParams } from '@/types/api';

/**
 * Base service for server-side API calls
 * Extends BaseService for shared utilities (buildUrl) but overrides HTTP methods
 * to use serverApiClient instead of apiClient
 */
export abstract class BaseServerService extends BaseService {
  constructor(basePath: string) {
    super(basePath);
  }
  /**
   * Execute GET request using server API client
   */
  protected async get<T = any>(path: string = '', params?: QueryParams): Promise<T> {
    try {
      const url = this.buildUrl(path, params);
      return await serverApiClient.get<T>(url);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute POST request using server API client
   */
  protected async post<T = any>(path: string = '', data?: any): Promise<T> {
    try {
      const url = this.buildUrl(path);
      return await serverApiClient.post<T>(url, data);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute PUT request using server API client
   */
  protected async put<T = any>(path: string = '', data?: any): Promise<T> {
    try {
      const url = this.buildUrl(path);
      return await serverApiClient.put<T>(url, data);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute PATCH request using server API client
   */
  protected async patch<T = any>(path: string = '', data?: any): Promise<T> {
    try {
      const url = this.buildUrl(path);
      return await serverApiClient.put<T>(url, data); // Use PUT as fallback
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute DELETE request using server API client
   */
  protected async delete<T = any>(path: string = ''): Promise<T> {
    try {
      const url = this.buildUrl(path);
      return await serverApiClient.delete<T>(url);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  protected handleError(error: any) {
    // Import handleApiError to avoid pulling it into base-service.ts
    const { handleApiError } = require('@/lib/api-errors');
    throw handleApiError(error);
  }
}


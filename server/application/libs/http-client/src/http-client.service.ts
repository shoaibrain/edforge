import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RetryStrategyService } from './retry-strategy.service';
import { isLambdaRuntime } from '@app/common-utils';

export interface RequestContext {
  tenantId: string;
  userId: string;
  jwtToken?: string;
  userRole?: string;
  userName?: string;
}

export interface HttpClientConfig {
  baseURL?: string;
  timeout?: number;
  retryConfig?: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
  };
  circuitBreakerConfig?: {
    failureThreshold?: number;
    resetTimeout?: number;
  };
}

@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly circuitBreaker: CircuitBreakerService;
  private readonly retryStrategy: RetryStrategyService;
  private readonly defaultTimeout: number;

  constructor(
    circuitBreaker: CircuitBreakerService,
    retryStrategy: RetryStrategyService,
    config: HttpClientConfig = {}
  ) {
    this.circuitBreaker = circuitBreaker;
    this.retryStrategy = retryStrategy;
    // A sibling behind API-B (cost-redesign C2.6) can be a cold Lambda: TLS +
    // authorizer + bootstrap. On ECS the 5 s default is unchanged.
    this.defaultTimeout = config.timeout || (isLambdaRuntime() ? 10000 : 5000);

    // Create Axios instance
    this.axiosInstance = axios.create({
      baseURL: config.baseURL,
      timeout: this.defaultTimeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Setup request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        this.logger.debug(`HTTP Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('HTTP Request Error', error);
        return Promise.reject(error);
      }
    );

    // Setup response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        this.logger.debug(`HTTP Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        this.logger.error(`HTTP Response Error: ${error.response?.status} ${error.config?.url}`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Circuit-breaker key: host + the service that owns the path. Since
   * cost-redesign C2.6 the three sibling base URLs can share one host
   * (API-B), so the host alone would make one service's 404s open the
   * breaker for the other two. The path rule is the route map's: /academics
   * → academics, /finance and /internal/webhooks → finance, else identity;
   * on an execute-api host the leading stage segment is skipped.
   */
  private getServiceKey(url: string): string {
    try {
      const urlObj = new URL(url, 'http://localhost');
      return `${urlObj.hostname || 'unknown'}/${HttpClientService.owningService(urlObj)}`;
    } catch {
      return 'unknown';
    }
  }

  static owningService(urlObj: URL): string {
    const segments = urlObj.pathname.split('/').filter(Boolean);
    if (/\.execute-api\./.test(urlObj.hostname)) segments.shift();
    const [first, second] = segments;
    if (first === 'academics') return 'academics';
    if (first === 'finance' || (first === 'internal' && second === 'webhooks')) return 'finance';
    return 'identity';
  }

  /**
   * Build headers from request context
   */
  private buildHeaders(context?: RequestContext, additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...additionalHeaders
    };

    if (context) {
      if (context.jwtToken) {
        headers['Authorization'] = `Bearer ${context.jwtToken}`;
      }
      if (context.tenantId) {
        headers['X-Tenant-Id'] = context.tenantId;
      }
      if (context.userId) {
        headers['X-User-Id'] = context.userId;
      }
      if (context.userRole) {
        headers['X-User-Role'] = context.userRole;
      }
    }

    return headers;
  }

  /**
   * Execute HTTP request with circuit breaker and retry logic
   */
  private async executeRequest<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    config: AxiosRequestConfig,
    context?: RequestContext
  ): Promise<AxiosResponse<T>> {
    const serviceKey = this.getServiceKey(url);
    const fullUrl = config.baseURL ? `${config.baseURL}${url}` : url;

    // Check circuit breaker
    if (!this.circuitBreaker.isRequestAllowed(serviceKey)) {
      const error = new Error(`Circuit breaker is OPEN for ${serviceKey}`);
      (error as any).isCircuitBreakerOpen = true;
      throw error;
    }

    // Build headers
    const headers = this.buildHeaders(context, config.headers as Record<string, string>);

    // Execute with retry
    try {
      const response = await this.retryStrategy.executeWithRetry(
        async () => {
          const requestConfig: AxiosRequestConfig = {
            ...config,
            headers,
            method
          };
          
          // Use appropriate axios method
          switch (method) {
            case 'get':
              return await this.axiosInstance.get<T>(url, requestConfig);
            case 'post':
              return await this.axiosInstance.post<T>(url, config.data, requestConfig);
            case 'put':
              return await this.axiosInstance.put<T>(url, config.data, requestConfig);
            case 'patch':
              return await this.axiosInstance.patch<T>(url, config.data, requestConfig);
            case 'delete':
              return await this.axiosInstance.delete<T>(url, requestConfig);
            default:
              return await this.axiosInstance.request<T>(requestConfig);
          }
        },
        {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 4000
        },
        (attempt, error) => {
          this.logger.warn(`Retrying ${method.toUpperCase()} ${url} (attempt ${attempt})`, {
            attempt,
            error: error.message
          });
        }
      );

      // Record success
      this.circuitBreaker.recordSuccess(serviceKey);
      return response;
    } catch (error: any) {
      // Record failure
      this.circuitBreaker.recordFailure(serviceKey);

      // Check if it's a circuit breaker error
      if (error.isCircuitBreakerOpen) {
        throw error;
      }

      // Re-throw the error
      throw error;
    }
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, config: AxiosRequestConfig = {}, context?: RequestContext): Promise<AxiosResponse<T>> {
    return this.executeRequest<T>('get', url, config, context);
  }

  /**
   * POST request
   */
  async post<T = any>(url: string, data?: any, config: AxiosRequestConfig = {}, context?: RequestContext): Promise<AxiosResponse<T>> {
    return this.executeRequest<T>('post', url, { ...config, data }, context);
  }

  /**
   * PUT request
   */
  async put<T = any>(url: string, data?: any, config: AxiosRequestConfig = {}, context?: RequestContext): Promise<AxiosResponse<T>> {
    return this.executeRequest<T>('put', url, { ...config, data }, context);
  }

  /**
   * PATCH request
   */
  async patch<T = any>(url: string, data?: any, config: AxiosRequestConfig = {}, context?: RequestContext): Promise<AxiosResponse<T>> {
    return this.executeRequest<T>('patch', url, { ...config, data }, context);
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, config: AxiosRequestConfig = {}, context?: RequestContext): Promise<AxiosResponse<T>> {
    return this.executeRequest<T>('delete', url, config, context);
  }
}


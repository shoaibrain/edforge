import axios, { AxiosInstance, AxiosRequestConfig } from "axios"
import { getIdTokenForApiCall } from "@/lib/token-service"

/**
 * Server-Side API Client
 * 
 * This client is used exclusively in server actions and server components.
 * It uses token-service to fetch fresh access tokens on-demand.
 * 
 * Enterprise Architecture:
 * - Tokens never exposed to client-side JavaScript
 * - AccessToken fetched on-demand using refreshToken (not stored in cookies)
 * - Small cookies (~500 bytes) - only refreshToken + user metadata
 * - All API calls happen server-side with fresh tokens
 */
class ServerApiClient {
  private baseURL: string
  private instance: AxiosInstance

  constructor() {
    this.baseURL = process.env.NEXT_PUBLIC_API_URL!
    
    if (!this.baseURL) {
      throw new Error("NEXT_PUBLIC_API_URL environment variable is not set")
    }

    this.instance = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    })

    // Add response interceptor for error handling
    this.instance.interceptors.response.use(
      (response) => response,
      (error) => {
        // Enhanced error logging, especially for 400 validation errors
        if (process.env.NODE_ENV === "development") {
          const errorDetails: any = {
            url: error.config?.url,
            method: error.config?.method,
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
          }
          
          // Log full response body for 400 errors (validation failures)
          if (error.response?.status === 400 && error.response?.data) {
            errorDetails.responseBody = error.response.data
            errorDetails.validationErrors = error.response.data
            console.error("[Server API] Validation Error (400):", JSON.stringify(errorDetails, null, 2))
          } else {
            console.error("[Server API] Request failed:", errorDetails)
          }
        }
        return Promise.reject(error)
      }
    )
  }

  /**
   * Get ID token for API call
   * 
   * ✅ CRITICAL FIX: Uses ID Token instead of Access Token because:
   * - AWS Cognito ID Token contains custom attributes (custom:tenantId, custom:userRole)
   * - Lambda authorizer requires these custom attributes to extract tenant context
   * - Access Token may not contain custom attributes unless configured in app client
   * 
   * ✅ Enterprise Architecture: Uses token-service to fetch fresh ID token on-demand
   * - No cookie reassembly needed (small cookies, no chunking)
   * - Fresh tokens fetched using refreshToken
   * - Better security (tokens only in memory during API call)
   * 
   * @returns Fresh ID token or null if authentication fails
   */
  private async getToken(): Promise<string | null> {
    return await getIdTokenForApiCall()
  }

  /**
   * Make authenticated GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const token = await this.getToken()
    
    if (!token) {
      throw new Error("Unauthorized: No ID token available")
    }

    const response = await this.instance.get<T>(url, {
      ...config,
      headers: {
        ...config?.headers,
        Authorization: `Bearer ${token}`,
      },
    })

    return response.data
  }

  /**
   * Make authenticated POST request
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const token = await this.getToken()
    
    if (!token) {
      throw new Error("Unauthorized: No ID token available")
    }

    const response = await this.instance.post<T>(url, data, {
      ...config,
      headers: {
        ...config?.headers,
        Authorization: `Bearer ${token}`,
      },
    })

    return response.data
  }

  /**
   * Make authenticated PUT request
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const token = await this.getToken()
    
    if (!token) {
      throw new Error("Unauthorized: No ID token available")
    }

    const response = await this.instance.put<T>(url, data, {
      ...config,
      headers: {
        ...config?.headers,
        Authorization: `Bearer ${token}`,
      },
    })

    return response.data
  }

  /**
   * Make authenticated DELETE request
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const token = await this.getToken()
    
    if (!token) {
      throw new Error("Unauthorized: No ID token available")
    }

    const response = await this.instance.delete<T>(url, {
      ...config,
      headers: {
        ...config?.headers,
        Authorization: `Bearer ${token}`,
      },
    })

    return response.data
  }
}

// Singleton instance
const serverApiClient = new ServerApiClient()
export default serverApiClient


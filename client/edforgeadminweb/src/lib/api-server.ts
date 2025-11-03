import axios, { AxiosInstance, AxiosRequestConfig } from "axios"
import { getAccessTokenForApiCall } from "@/lib/token-service"

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
 * 
 * Usage:
 * ```typescript
 * import serverApiClient from "@/lib/api-server"
 * const data = await serverApiClient.get("/endpoint")
 * ```
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
        // Log errors in development
        if (process.env.NODE_ENV === "development") {
          console.error("[Server API] Request failed:", {
            url: error.config?.url,
            status: error.response?.status,
            message: error.message,
          })
        }
        return Promise.reject(error)
      }
    )
  }

  /**
   * Get access token for API call
   * 
   * ✅ Enterprise Architecture: Uses token-service to fetch fresh accessToken on-demand
   * - No cookie reassembly needed (small cookies, no chunking)
   * - Fresh tokens fetched using refreshToken
   * - Better security (tokens only in memory during API call)
   * 
   * @returns Fresh access token or null if authentication fails
   */
  private async getAccessToken(): Promise<string | null> {
    return await getAccessTokenForApiCall()
  }

  /**
   * Make authenticated GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const token = await this.getAccessToken()
    
    if (!token) {
      throw new Error("Unauthorized: No access token available")
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
    const token = await this.getAccessToken()
    
    if (!token) {
      throw new Error("Unauthorized: No access token available")
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
    const token = await this.getAccessToken()
    
    if (!token) {
      throw new Error("Unauthorized: No access token available")
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
    const token = await this.getAccessToken()
    
    if (!token) {
      throw new Error("Unauthorized: No access token available")
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


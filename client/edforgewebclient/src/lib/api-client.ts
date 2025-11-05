import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios"
import { getSession } from "next-auth/react"

/**
 * In-memory cache for ID token (not stored in cookies to avoid chunking)
 */
let idTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Fetch ID token from server-side endpoint
 * This avoids storing tokens in cookies (prevents chunking)
 */
async function fetchIdTokenFromApi(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/id-token', {
      method: 'GET',
      credentials: 'include', // Include cookies for authentication
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Unauthorized - redirect to sign in
        if (typeof window !== "undefined") {
          window.location.href = "/auth/signin";
        }
        return null;
      }
      throw new Error(`Failed to fetch ID token: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.idToken) {
      return null;
    }

    // Cache token in memory with expiration
    const expiresIn = data.expiresIn || 3600;
    idTokenCache = {
      token: data.idToken,
      expiresAt: Date.now() + (expiresIn - 60) * 1000, // Cache with 60s buffer
    };

    return data.idToken;
  } catch (error) {
    console.error('[API Client] Error fetching ID token:', error);
    return null;
  }
}

/**
 * Get ID token for API calls (client-side)
 * Uses in-memory cache, fetches from API if needed
 */
async function getIdToken(): Promise<string | null> {
  // Check cache first
  if (idTokenCache && Date.now() < idTokenCache.expiresAt) {
    return idTokenCache.token;
  }

  // Fetch fresh token from API
  return await fetchIdTokenFromApi();
}

class ApiClient {
  private instance: AxiosInstance

  constructor() {
    this.instance = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL,
      timeout: 10000, // 10 seconds
      headers: {
        "Content-Type": "application/json",
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    // Request interceptor to add auth token
    this.instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Skip auth for issuer URLs and public endpoints
        if (
          config.url?.includes(process.env.NEXT_PUBLIC_ISSUER || "") ||
          config.url?.includes("auth-info")
        ) {
          return config
        }

        try {
          // Get ID token for API calls (Lambda authorizer requires custom:tenantId claims)
          // Token is fetched from server-side API endpoint and cached in memory
          const idToken = await getIdToken();
          
          if (idToken) {
            config.headers.Authorization = `Bearer ${idToken}`
            if (process.env.NODE_ENV === 'development') {
              console.log('[API Client] Request:', {
                method: config.method?.toUpperCase(),
                url: config.url,
                baseURL: config.baseURL,
                fullURL: `${config.baseURL}${config.url}`,
                hasAuthToken: !!idToken,
                authTokenLength: idToken.length
              });
            }
          } else {
            const errorMsg = 'No ID token available for API request';
            if (process.env.NODE_ENV === 'development') {
              console.error('[API Client]', errorMsg, {
                url: config.url,
                baseURL: config.baseURL,
                cacheState: idTokenCache ? 'exists but expired' : 'does not exist'
              });
            }
            // Return config without auth header - let the API Gateway handle the 401
            // This allows the request to proceed and return a proper 401 response
            // instead of blocking it client-side
            return config;
          }
        } catch (error) {
          console.error('[API Client] Failed to get ID token for API request:', error)
          // Re-throw to prevent request from proceeding without auth
          throw error;
        }

        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Response interceptor for error handling
    this.instance.interceptors.response.use(
      (response) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[API Client] Response:', {
            status: response.status,
            statusText: response.statusText,
            url: response.config.url,
            data: response.data
          });
        }
        return response;
      },
      (error) => {
        if (process.env.NODE_ENV === 'development') {
          console.error('[API Client] Response error:', {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            isNetworkError: !error.response && error.request
          });
        }
        
        if (error.response?.status === 401) {
          // Unauthorized - redirect to sign in
          if (typeof window !== "undefined") {
            window.location.href = "/auth/signin"
          }
        }
        return Promise.reject(error)
      }
    )
  }

  getInstance(): AxiosInstance {
    return this.instance
  }
}

const apiClient = new ApiClient()
export default apiClient.getInstance()

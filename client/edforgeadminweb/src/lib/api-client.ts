import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios"
import { getSession } from "next-auth/react"

class ApiClient {
  private instance: AxiosInstance

  constructor() {
    this.instance = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL,
      timeout: 10000,
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
          const session = await getSession()
          if (session?.accessToken) {
            config.headers.Authorization = `Bearer ${session.accessToken}`
          }
        } catch (error) {
          console.error("Failed to get session for API request:", error)
        }

        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Response interceptor for error handling
    this.instance.interceptors.response.use(
      (response) => response,
      (error) => {
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


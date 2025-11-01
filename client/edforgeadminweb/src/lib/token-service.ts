import { decode } from "next-auth/jwt"
import { cookies } from "next/headers"

/**
 * Token Service -  On-Demand Token Fetching
 * 
 * This service provides secure, on-demand access token fetching for server-side API calls.
 * Architecture:
 * - Stores only refreshToken in JWT cookie
 * - Fetches fresh accessToken on-demand using refreshToken
 * - Caches accessToken in memory per-request to avoid multiple refreshes
 * - Better security: tokens only in memory during API calls
 * 
 * Usage:
 * ```typescript
 * import { getAccessTokenForApiCall } from "@/lib/token-service"
 * const accessToken = await getAccessTokenForApiCall()
 * if (!accessToken) {
 *   throw new Error("Authentication required")
 * }
 * ```
 */

// Cache for well-known configuration to avoid repeated fetches
let wellKnownConfigCache: { token_endpoint: string } | null = null

/**
 * Get token endpoint from Cognito well-known OIDC configuration
 * @returns Token endpoint URL
 */
async function getTokenEndpointFromWellKnown(): Promise<string> {
  // Return cached endpoint if available
  if (wellKnownConfigCache?.token_endpoint) {
    return wellKnownConfigCache.token_endpoint
  }

  const wellKnownUrl = process.env.NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL!
  
  try {
    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Fetching well-known configuration from:", wellKnownUrl)
    }

    const response = await fetch(wellKnownUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch well-known configuration: ${response.status}`)
    }

    const config = await response.json()

    if (!config.token_endpoint) {
      throw new Error("token_endpoint not found in well-known configuration")
    }

    // Cache the configuration
    wellKnownConfigCache = {
      token_endpoint: config.token_endpoint,
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Token endpoint from well-known config:", config.token_endpoint)
    }

    return config.token_endpoint
  } catch (error) {
    console.error("[Token Service] Failed to fetch well-known configuration:", error)
    throw new Error(
      `Failed to get token endpoint from well-known configuration: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

/**
 * Get refreshToken from NextAuth JWT
 * Uses decode() to decrypt JWT cookie directly (works in server actions)

 * 
 * Note: Since we only store refreshToken in JWT (not accessToken/idToken),
 * the cookie should be small (~500 bytes) and not chunked.
 */
async function getRefreshTokenFromJWT(): Promise<string | null> {
  try {
    if (!process.env.NEXTAUTH_SECRET) {
      console.error("[Token Service] NEXTAUTH_SECRET not set")
      return null
    }

    // Get cookies
    const cookieStore = await cookies()
    const allCookies = cookieStore.getAll()

    // Handle chunked cookies (just in case, though should not be needed with small cookies)
    const chunkedPattern = /^next-auth\.session-token\.(\d+)$/
    const chunkedCookies = allCookies.filter((c) => chunkedPattern.test(c.name))
    
    let sessionTokenValue: string | null = null

    if (chunkedCookies.length > 0) {
      // Reassemble chunked cookies (sorted by numeric suffix)
      const sortedChunks = chunkedCookies.sort((a, b) => {
        const aMatch = a.name.match(chunkedPattern)!
        const bMatch = b.name.match(chunkedPattern)!
        return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10)
      })
      sessionTokenValue = sortedChunks.map((c) => c.value || "").join("")
      
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] Reassembled chunked session cookie", {
          chunks: sortedChunks.length,
        })
      }
    } else {
      // No chunking - get single cookie
      const sessionCookie = cookieStore.get("next-auth.session-token")
      sessionTokenValue = sessionCookie?.value || null
    }

    if (!sessionTokenValue) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] No session token cookie found")
      }
      return null
    }

    // ✅ Use decode() directly - works in server actions without full request context
    const decoded = await decode({
      token: sessionTokenValue,
      secret: process.env.NEXTAUTH_SECRET,
    })

    if (!decoded) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] Failed to decode JWT token")
      }
      return null
    }

    if (!decoded.refreshToken) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] No refresh token in decoded JWT", {
          hasDecoded: !!decoded,
          decodedKeys: Object.keys(decoded),
        })
      }
      return null
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Successfully retrieved refresh token from JWT")
    }

    return decoded.refreshToken as string
  } catch (error) {
    console.error("[Token Service] Failed to get refresh token:", error)
    if (error instanceof Error) {
      console.error("[Token Service] Error details:", {
        message: error.message,
        stack: error.stack,
      })
    }
    return null
  }
}

/**
 * Fetch fresh accessToken and idToken from Cognito using refreshToken
 * 
 * ✅ Fix: Uses token endpoint from well-known OIDC configuration (correct Hosted UI domain)
 * instead of manually constructing cognito-idp endpoint which returns 400 BadRequest.
 * 
 * Note: Cognito refresh_token grant returns both access_token and id_token when scope includes "openid"
 */
async function fetchAccessTokenFromCognito(
  refreshToken: string
): Promise<{ accessToken: string; idToken: string; expiresIn: number } | null> {
  try {
    // ✅ Get correct token endpoint from well-known configuration
    const tokenEndpoint = await getTokenEndpointFromWellKnown()

    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Refreshing access token using endpoint:", tokenEndpoint)
    }

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.NEXT_PUBLIC_CLIENT_ID!,
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error("[Token Service] Token refresh failed:", {
        status: response.status,
        error: errorData,
      })
      return null
    }

    const tokens = await response.json()

    // ✅ Cognito returns both access_token and id_token when scope includes "openid"
    if (!tokens.access_token) {
      console.error("[Token Service] No access_token in refresh response")
      return null
    }

    if (!tokens.id_token) {
      console.warn("[Token Service] No id_token in refresh response (may be expected if scope doesn't include openid)")
    }

    return {
      accessToken: tokens.access_token,
      idToken: tokens.id_token || "", // id_token may not always be present
      expiresIn: tokens.expires_in || 3600,
    }
  } catch (error) {
    console.error("[Token Service] Error fetching access token:", error)
    return null
  }
}

// Per-request cache for accessToken and idToken to avoid multiple refreshes
// Using Map to avoid memory leaks (garbage collected with request)
const tokenCache = new Map<string, { accessToken: string; idToken: string; expiresAt: number }>()

/**
 * Get access token for API call
 * 
 * Strategy:
 * 1. Try to get refreshToken from JWT
 * 2. Check if we have a valid cached accessToken
 * 3. If not, fetch fresh accessToken using refreshToken
 * 4. Cache and return accessToken
 * 
 * @returns Fresh access token or null if authentication fails
 */
export async function getAccessTokenForApiCall(): Promise<string | null> {
  try {
    // Step 1: Get refreshToken from JWT
    const refreshToken = await getRefreshTokenFromJWT()

    if (!refreshToken) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] No refresh token available")
      }
      return null
    }

    // Step 2: Check cache (using refreshToken as key)
    // Cache is per-request, so this is safe for concurrent requests
    const cached = tokenCache.get(refreshToken)
    if (cached && Date.now() < cached.expiresAt) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] Using cached access token")
      }
      return cached.accessToken
    }

    // Step 3: Fetch fresh accessToken and idToken
    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Fetching fresh access token from Cognito")
    }

    const tokenData = await fetchAccessTokenFromCognito(refreshToken)

    if (!tokenData) {
      return null
    }

    // Step 4: Cache and return
    const expiresAt = Date.now() + (tokenData.expiresIn - 60) * 1000 // Cache with 60s buffer
    tokenCache.set(refreshToken, {
      accessToken: tokenData.accessToken,
      idToken: tokenData.idToken,
      expiresAt,
    })

    // Clean up expired cache entries periodically
    // (In production, consider using a more sophisticated cache)
    if (tokenCache.size > 100) {
      const now = Date.now()
      for (const [key, value] of tokenCache.entries()) {
        if (now >= value.expiresAt) {
          tokenCache.delete(key)
        }
      }
    }

    return tokenData.accessToken
  } catch (error) {
    console.error("[Token Service] Failed to get access token:", error)
    return null
  }
}

/**
 * Get both access token and ID token for display purposes (e.g., auth info page)
 * 
 * Uses the same caching mechanism as getAccessTokenForApiCall() but returns both tokens
 * 
 * @returns Object with accessToken and idToken, or null if authentication fails
 */
export async function getTokensForDisplay(): Promise<{ accessToken: string; idToken: string } | null> {
  try {
    // Step 1: Get refreshToken from JWT
    const refreshToken = await getRefreshTokenFromJWT()

    if (!refreshToken) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] No refresh token available for display")
      }
      return null
    }

    // Step 2: Check cache
    const cached = tokenCache.get(refreshToken)
    if (cached && Date.now() < cached.expiresAt) {
      if (process.env.NODE_ENV === "development") {
        console.log("[Token Service] Using cached tokens for display")
      }
      return {
        accessToken: cached.accessToken,
        idToken: cached.idToken,
      }
    }

    // Step 3: Fetch fresh tokens
    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Fetching fresh tokens from Cognito for display")
    }

    const tokenData = await fetchAccessTokenFromCognito(refreshToken)

    if (!tokenData) {
      return null
    }

    // Step 4: Cache and return
    const expiresAt = Date.now() + (tokenData.expiresIn - 60) * 1000
    tokenCache.set(refreshToken, {
      accessToken: tokenData.accessToken,
      idToken: tokenData.idToken,
      expiresAt,
    })

    return {
      accessToken: tokenData.accessToken,
      idToken: tokenData.idToken,
    }
  } catch (error) {
    console.error("[Token Service] Failed to get tokens for display:", error)
    return null
  }
}


import { decode } from "next-auth/jwt"
import { cookies } from "next/headers"

/**
 * Token Service -  On-Demand Token Fetching
 * 
 * This service provides secure, on-demand token fetching for server-side API calls.
 * 
 * Enterprise Architecture:
 * - Stores only refreshToken in JWT cookie (~500 bytes, prevents chunking)
 * - Fetches fresh tokens on-demand using refreshToken
 * - Caches tokens in memory per-request to avoid multiple refreshes within same invocation
 * - Better security: tokens only in memory during API calls
 * 
 * Serverless vs Localhost Behavior:
 * - Localhost: In-memory cache persists between requests (long-running Node.js process)
 *   → Fewer Cognito API calls due to persistent cache
 * - Vercel Serverless: Cache is empty on cold starts (fresh process per invocation)
 *   → One refresh per cold start is expected and acceptable
 *   → Within-request caching prevents multiple refreshes in same invocation
 * 
 * Usage:
 * ```typescript
 * import { getIdTokenForApiCall } from "@/lib/token-service"
 * const idToken = await getIdTokenForApiCall()
 * if (!idToken) {
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
    // On Vercel (HTTPS), NextAuth uses __Secure-next-auth.session-token
    // On localhost (HTTP), NextAuth uses next-auth.session-token
    const chunkedPattern = /^(?:__Secure-)?next-auth\.session-token\.(\d+)$/
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
      // On Vercel (HTTPS), NextAuth uses __Secure-next-auth.session-token
      // On localhost (HTTP), NextAuth uses next-auth.session-token
      const secureCookie = cookieStore.get("__Secure-next-auth.session-token")
      const regularCookie = cookieStore.get("next-auth.session-token")
      sessionTokenValue = secureCookie?.value || regularCookie?.value || null
      
      if (process.env.NODE_ENV === "production" && !sessionTokenValue) {
        console.error("[Token Service] No session cookie found in production", {
          hasSecureCookie: !!secureCookie,
          hasRegularCookie: !!regularCookie,
          allCookieNames: allCookies.map(c => c.name),
        })
      }
    }

    if (!sessionTokenValue) {
      console.error("[Token Service] No session token cookie found", {
        environment: process.env.NODE_ENV,
        cookieCount: allCookies.length,
        cookieNames: allCookies.map(c => c.name),
      })
      return null
    }

    // ✅ Use decode() directly - works in server actions without full request context
    const decoded = await decode({
      token: sessionTokenValue,
      secret: process.env.NEXTAUTH_SECRET,
    })

    if (!decoded) {
      console.error("[Token Service] Failed to decode JWT token", {
        environment: process.env.NODE_ENV,
        hasSessionToken: !!sessionTokenValue,
        sessionTokenLength: sessionTokenValue?.length,
      })
      return null
    }

    if (!decoded.refreshToken) {
      console.error("[Token Service] No refresh token in decoded JWT", {
        environment: process.env.NODE_ENV,
        hasDecoded: !!decoded,
        decodedKeys: Object.keys(decoded),
        decodedSub: decoded.sub,
        decodedTenantId: (decoded as any).tenantId,
      })
      return null
    }

    console.log("[Token Service] Successfully retrieved refresh token from JWT", {
      environment: process.env.NODE_ENV,
      hasRefreshToken: !!decoded.refreshToken,
      refreshTokenLength: (decoded.refreshToken as string)?.length,
    })

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
 * ✅ CRITICAL: Uses token endpoint from well-known OIDC configuration (correct Hosted UI domain)
 * instead of manually constructing cognito-idp endpoint which returns 400 BadRequest.
 * 
 * ✅ CRITICAL: Includes scope parameter in refresh token grant to receive id_token.
 * According to AWS Cognito OAuth2/OIDC specification, refresh_token grant MUST include
 * scope parameter with "openid" to receive id_token in response.
 * 
 * @param refreshToken - The refresh token from NextAuth JWT cookie
 * @returns Object with accessToken, idToken, and expiresIn, or null if refresh fails
 */
async function fetchAccessTokenFromCognito(
  refreshToken: string
): Promise<{ accessToken: string; idToken: string; expiresIn: number } | null> {
  try {
    // ✅ Get correct token endpoint from well-known configuration
    const tokenEndpoint = await getTokenEndpointFromWellKnown()

    console.log("[Token Service] Refreshing tokens using endpoint:", {
      environment: process.env.NODE_ENV,
      endpoint: tokenEndpoint,
      hasRefreshToken: !!refreshToken,
      refreshTokenLength: refreshToken?.length,
    })

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.NEXT_PUBLIC_CLIENT_ID!,
        refresh_token: refreshToken,
        scope: "openid profile email",
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error_description || errorData.error || "Unknown error"
      console.error("[Token Service] Token refresh failed:", {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        endpoint: tokenEndpoint,
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken?.length,
      })
      
      // Enhanced error logging for production debugging
      if (process.env.NODE_ENV === "production") {
        console.error("[Token Service] Production error details:", {
          timestamp: new Date().toISOString(),
          errorCode: errorData.error,
          errorDescription: errorMessage,
        })
      }
      
      return null
    }

    const tokens = await response.json()

    // ✅ Cognito returns both access_token and id_token when scope includes "openid"
    if (!tokens.access_token) {
      console.error("[Token Service] No access_token in refresh response", {
        responseKeys: Object.keys(tokens),
        hasIdToken: !!tokens.id_token,
      })
      return null
    }

    if (!tokens.id_token) {
      console.error("[Token Service] CRITICAL: No id_token in refresh response", {
        responseKeys: Object.keys(tokens),
        hasAccessToken: !!tokens.access_token,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type,
      })
      // This should not happen if scope parameter is correctly included
      return null
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[Token Service] Successfully refreshed tokens", {
        hasAccessToken: !!tokens.access_token,
        hasIdToken: !!tokens.id_token,
        expiresIn: tokens.expires_in,
      })
    }

    return {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in || 3600,
    }
  } catch (error) {
    console.error("[Token Service] Error fetching tokens from Cognito:", error)
    if (error instanceof Error) {
      console.error("[Token Service] Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      })
    }
    return null
  }
}

/**
 * Per-request in-memory cache for accessToken and idToken
 * 
 * Cache Behavior:
 * - Localhost: Cache persists between requests (long-running Node.js process)
 *   → Reduces Cognito API calls for subsequent requests
 * - Vercel Serverless: Cache is empty on cold starts (fresh process per invocation)
 *   → Each cold start will refresh tokens (expected behavior)
 *   → Within same request/function invocation, cache prevents multiple refreshes
 * 
 * Using Map to avoid memory leaks (garbage collected with request/function invocation)
 */
const tokenCache = new Map<string, { accessToken: string; idToken: string; expiresAt: number }>()

/**
 * Get ID token for API call
 * 
 * CRITICAL: AWS Cognito ID Token contains custom attributes (custom:tenantId, custom:userRole)
 * required by Lambda authorizer. Access Token may not contain these attributes.
 * 
 * Strategy:
 * 1. Try to get refreshToken from JWT
 * 2. Check if we have a valid cached idToken
 * 3. If not, fetch fresh tokens using refreshToken
 * 4. Cache and return idToken
 * 
 * @returns Fresh ID token or null if authentication fails
 */
export async function getIdTokenForApiCall(): Promise<string | null> {
  try {
    // Step 1: Get refreshToken from JWT
    const refreshToken = await getRefreshTokenFromJWT()

    if (!refreshToken) {
      console.error("[Token Service] No refresh token available", {
        environment: process.env.NODE_ENV,
        hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
      })
      return null
    }

    // Step 2: Check cache (using refreshToken as key)
    const cached = tokenCache.get(refreshToken)
    if (cached && Date.now() < cached.expiresAt) {
      console.log("[Token Service] Using cached ID token", {
        environment: process.env.NODE_ENV,
        cacheExpiresAt: new Date(cached.expiresAt).toISOString(),
        timeUntilExpiry: cached.expiresAt - Date.now(),
      })
      return cached.idToken
    }

    // Step 3: Fetch fresh accessToken and idToken
    console.log("[Token Service] Fetching fresh ID token from Cognito", {
      environment: process.env.NODE_ENV,
      hasRefreshToken: !!refreshToken,
      refreshTokenLength: refreshToken?.length,
      cacheSize: tokenCache.size,
    })

    const tokenData = await fetchAccessTokenFromCognito(refreshToken)

    if (!tokenData || !tokenData.idToken) {
      console.error("[Token Service] No ID token in response", {
        environment: process.env.NODE_ENV,
        hasTokenData: !!tokenData,
        hasIdToken: tokenData?.idToken ? true : false,
        hasAccessToken: tokenData?.accessToken ? true : false,
        refreshTokenLength: refreshToken?.length,
        tokenDataKeys: tokenData ? Object.keys(tokenData) : null,
      })
      return null
    }

    console.log("[Token Service] Successfully obtained ID token", {
      environment: process.env.NODE_ENV,
      hasIdToken: !!tokenData.idToken,
      idTokenLength: tokenData.idToken?.length,
      expiresIn: tokenData.expiresIn,
    })

    // Step 4: Cache and return idToken
    const expiresAt = Date.now() + (tokenData.expiresIn - 60) * 1000 // Cache with 60s buffer
    tokenCache.set(refreshToken, {
      accessToken: tokenData.accessToken,
      idToken: tokenData.idToken,
      expiresAt,
    })

    return tokenData.idToken
  } catch (error) {
    console.error("[Token Service] Failed to get ID token:", error)
    if (error instanceof Error) {
      console.error("[Token Service] Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      })
    }
    return null
  }
}

/**
 * Get access token for API call (DEPRECATED - use getIdTokenForApiCall instead)
 * 
 * ⚠️ Note: Access Token may not contain custom:tenantId required by Lambda authorizer.
 * Use getIdTokenForApiCall() for API Gateway calls that need custom attributes.
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


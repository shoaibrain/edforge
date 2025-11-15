/**
 * This is the core authentication endpoint for EdForge EMIS.
 * Handles OAuth2/OIDC flows with AWS Cognito for multi-tenant SaaS.
 * 
 * Uses Basic Tier User Pool (shared pool for all Basic tier tenants).
 * Tenant context is determined by the JWT's custom:tenantId claim.
 * 
 * Enterprise Architecture:
 * - Stores ONLY refreshToken + user metadata in JWT cookie (~500 bytes)
 * - Fetches accessToken on-demand using refreshToken via token-service
 * - No cookie chunking (small cookies)
 * - Secure, scalable authentication pattern
 */

import NextAuth, { NextAuthOptions } from "next-auth"
import type { JWT } from "next-auth/jwt"

/**
 * Get token endpoint from well-known OIDC configuration
 * Cache to avoid repeated fetches
 */
let wellKnownTokenEndpoint: string | null = null

async function getTokenEndpointFromWellKnown(): Promise<string> {
  if (wellKnownTokenEndpoint) {
    return wellKnownTokenEndpoint
  }

  const wellKnownUrl = process.env.NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL!
  
  try {
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

    wellKnownTokenEndpoint = config.token_endpoint
    return config.token_endpoint
  } catch (error) {
    console.error("[AUTH] Failed to fetch well-known configuration:", error)
    throw error
  }
}

/**
 * Refresh access token using Cognito token endpoint
 * This is called by NextAuth when RefreshAccessTokenError is set
 * 
 * ✅ CRITICAL: Includes scope parameter in refresh token grant to receive id_token.
 * According to AWS Cognito OAuth2/OIDC specification, refresh_token grant MUST include
 * scope parameter with "openid" to receive id_token in response.
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      throw new Error("No refresh token available")
    }
    const tokenEndpoint = await getTokenEndpointFromWellKnown()

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.NEXT_PUBLIC_CLIENT_ID!,
        refresh_token: token.refreshToken,
        scope: "openid profile email", // ✅ CRITICAL: Required for Cognito to return id_token
      }),
    })

    const refreshedTokens = await response.json()

    if (!response.ok) {
      const errorMessage = refreshedTokens.error_description || refreshedTokens.error || "Failed to refresh token"
      console.error("[AUTH] Token refresh failed:", {
        status: response.status,
        statusText: response.statusText,
        error: refreshedTokens,
        endpoint: tokenEndpoint,
      })
      throw new Error(errorMessage)
    }

    // Return updated token with new expiration
    // NOTE: We do NOT store tokens in JWT cookie to avoid chunking
    // Tokens are fetched on-demand server-side via token-service
    // Client-side fetches ID token via /api/auth/id-token endpoint
    return {
      ...token,
      accessTokenExpires: Date.now() + (refreshedTokens.expires_in || 3600) * 1000,
      // Keep the same refreshToken - Cognito refresh tokens don't rotate
      refreshToken: token.refreshToken,
      error: undefined, // Clear any previous errors
    }
  } catch (error) {
    console.error("[AUTH] Error refreshing access token:", error)
    if (error instanceof Error) {
      console.error("[AUTH] Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      })
    }
    return {
      ...token,
      error: "RefreshAccessTokenError",
    }
  }
}

// AWS Cognito OIDC Provider Configuration
// Uses OIDC well-known discovery endpoint for automatic endpoint configuration
const cognitoProvider = {
  id: "cognito",
  name: "Cognito",
  type: "oauth" as const,
  wellKnown: process.env.NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL, // Basic Tier User Pool OIDC discovery
  authorization: {
    params: {
      scope: "openid profile email", // Basic scopes - custom scopes can be added if configured in Cognito
    },
  },
  idToken: true,
  checks: ["pkce", "state"] as const,
  clientId: process.env.NEXT_PUBLIC_CLIENT_ID!, // Basic Tier App Client ID
  clientSecret: undefined,
  client: {
    token_endpoint_auth_method: "none", // This tells NextAuth it's a public client
  },
  profile(profile: any) {
    return {
      id: profile.sub,
      email: profile.email,
      name: profile.name || profile.email,
      tenantId: (profile as any)["custom:tenantId"], // Critical: Used for tenant isolation
      tenantTier: (profile as any)["custom:tenantTier"],
      userRole: (profile as any)["custom:userRole"],
    }
  },
  async refreshAccessToken(token: JWT): Promise<JWT> {
    return await refreshAccessToken(token)
  },
}

export const authOptions: NextAuthOptions = {
  providers: [cognitoProvider as any],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60, // 1 hour (matches Cognito access token expiration)
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async jwt({ token, account, profile, user, trigger }): Promise<JWT> {
      // Initial sign in - store ONLY refreshToken and user metadata (keep cookie small ~500 bytes)
      // CRITICAL: Do NOT store tokens in cookie to avoid chunking
      // Tokens are fetched on-demand server-side via token-service
      // Client-side fetches ID token via /api/auth/id-token endpoint
      if (account && profile) {
        return {
          ...token,
          // Store refreshToken for on-demand token fetching (server-side only)
          refreshToken: account.refresh_token,
          // Store expiration timestamp for validation
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
          // User metadata (small, fits in cookie)
          tenantId: (profile as any)["custom:tenantId"],
          tenantTier: (profile as any)["custom:tenantTier"],
          userRole: (profile as any)["custom:userRole"],
          // Clear any previous errors
          error: undefined,
        }
      }

      // When RefreshAccessTokenError is set, NextAuth calls provider.refreshAccessToken()
      if (token.error === "RefreshAccessTokenError") {
        if (process.env.NODE_ENV === "development") {
          console.log("[AUTH] Refreshing access token via refreshAccessToken callback")
        }
        // NextAuth will call cognitoProvider.refreshAccessToken() automatically
        // Return token with error flag so NextAuth knows to refresh
        return token
      }

      // Token still valid (check expiration timestamp)
      if (Date.now() < (token.accessTokenExpires || 0)) {
        return token
      }

      // NextAuth will detect RefreshAccessTokenError and call refreshAccessToken callback
      if (process.env.NODE_ENV === "development") {
        console.log("[AUTH] Access token expired - triggering refresh")
      }

      if (token.refreshToken) {
        return { ...token, error: "RefreshAccessTokenError" }
      }

      // No refresh token available - user needs to re-authenticate
      return token
    },
    async session({ session, token }): Promise<any> {
      // Session callback - expose user metadata only (no tokens)
      // Tokens are fetched on-demand:
      // - Server-side: via token-service (using refreshToken from JWT)
      // - Client-side: via /api/auth/id-token endpoint
      if (token) {
        session.error = token.error as string | undefined
        session.user = {
          ...session.user,
          id: token.sub!,
          tenantId: token.tenantId as string,
          tenantTier: token.tenantTier as string,
          userRole: token.userRole as string,
        }
      }
      return session
    },
  },
  debug: process.env.NODE_ENV === "development",
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
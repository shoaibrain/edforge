import NextAuth, { NextAuthOptions } from "next-auth"
import type { JWT } from "next-auth/jwt"

/**
 * Extract User Pool ID from well-known endpoint URL
 * Format: https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration
 */
function getUserPoolIdFromWellKnownUrl(): string {
  const wellKnownUrl = process.env.NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL!
  try {
    const url = new URL(wellKnownUrl)
    // Path format: /{userPoolId}/.well-known/openid-configuration
    const pathParts = url.pathname.split("/")
    const userPoolId = pathParts[1] // e.g., "us-east-1_lhufLThrp"
    if (!userPoolId) {
      throw new Error("Could not extract User Pool ID from well-known URL")
    }
    return userPoolId
  } catch (error) {
    throw new Error(
      `Invalid NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL format: ${wellKnownUrl}`
    )
  }
}

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
      }),
    })

    const refreshedTokens = await response.json()

    if (!response.ok) {
      console.error("[AUTH] Token refresh failed:", refreshedTokens)
      throw new Error(
        refreshedTokens.error_description || "Failed to refresh token"
      )
    }

    // Return updated token with new access token
    // NOTE: We only store refreshToken in JWT, not accessToken
    // The refreshToken is kept the same (Cognito doesn't return a new one unless revoked)
    return {
      ...token,
      accessTokenExpires: Date.now() + (refreshedTokens.expires_in || 3600) * 1000,
      // Keep the same refreshToken - Cognito refresh tokens don't rotate
      refreshToken: token.refreshToken,
      error: undefined, // Clear any previous errors
    }
  } catch (error) {
    console.error("[AUTH] Error refreshing access token:", error)
    return {
      ...token,
      error: "RefreshAccessTokenError",
    }
  }
}

// Cognito OIDC Provider Configuration
const cognitoProvider = {
  id: "cognito",
  name: "Cognito",
  type: "oauth" as const,
  wellKnown: process.env.NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL,
  authorization: {
    params: {
      scope: "openid profile email tenant/tenant_read tenant/tenant_write user/user_read user/user_write",
    },
  },
  idToken: true,
  checks: ["pkce", "state"] as const,
  clientId: process.env.NEXT_PUBLIC_CLIENT_ID!,
  clientSecret: undefined,
  client: {
    token_endpoint_auth_method: "none", // This tells NextAuth it's a public client
  },
  profile(profile: any) {
    return {
      id: profile.sub,
      email: profile.email,
      name: profile.name || profile.email,
      tenantId: profile["custom:tenantId"],
      tenantTier: profile["custom:tenantTier"],
      userRole: profile["custom:userRole"],
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
    maxAge: 60 * 60, // 1 hour
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async jwt({ token, account, profile, user, trigger }): Promise<JWT> {
      // Initial sign in - store ONLY refreshToken and user metadata
      if (account && profile) {
        return {
          ...token,
          // Store refreshToken for on-demand token fetching
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
    async session({ session, token }) {
      if (token) {
        // Tokens are NOT stored in session cookie (prevents cookie size issues)
        // AccessToken is fetched on-demand using refreshToken via token-service
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
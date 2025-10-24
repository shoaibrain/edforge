import NextAuth, { NextAuthOptions } from "next-auth"
import type { JWT } from "next-auth/jwt"

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
    async jwt({ token, account, profile, user }): Promise<JWT> {
      // Initial sign in
      if (account && profile) {
        return {
          ...token,
          accessToken: account.access_token,
          idToken: account.id_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
          tenantId: (profile as any)["custom:tenantId"],
          tenantTier: (profile as any)["custom:tenantTier"],
          userRole: (profile as any)["custom:userRole"],
        }
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires || 0)) {
        return token
      }

      // Access token has expired, try to refresh it
      // Note: Implement refresh logic if needed
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.accessToken = token.accessToken as string
        session.idToken = token.idToken as string
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
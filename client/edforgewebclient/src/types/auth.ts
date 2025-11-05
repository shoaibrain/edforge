import { DefaultSession } from "next-auth"
import { JWT } from "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    accessToken?: string
    idToken?: string
    error?: string
    user: {
      id: string
      tenantId: string
      tenantTier: string
      userRole: string
    } & DefaultSession["user"]
  }

  interface User {
    id: string
    email: string
    name: string
    tenantId?: string
    tenantTier?: string
    userRole?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string
    idToken?: string
    refreshToken?: string
    accessTokenExpires?: number
    tenantId?: string
    tenantTier?: string
    userRole?: string
    error?: string
  }
}

export interface AuthUser {
  id: string
  email: string
  name: string
  tenantId: string
  tenantTier: string
  userRole: string
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
  idToken: string
  error?: string
}

"use client"

import { SessionProvider } from "next-auth/react"
import { ReactNode } from "react"

/**
 * Client wrapper for SessionProvider
 * Required because SessionProvider cannot be used directly in Server Components
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}

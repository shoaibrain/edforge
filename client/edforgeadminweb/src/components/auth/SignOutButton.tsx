"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

/**
 * Get Cognito logout URL from well-known OIDC configuration
 * 
 * Extracts the Hosted UI domain from authorization_endpoint and constructs
 * the correct logout URL that Cognito expects.
 * 
 * @returns Cognito logout URL
 */
async function getCognitoLogoutUrl(): Promise<string> {
  const wellKnownUrl = process.env.NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL!
  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID!
  const logoutUri = encodeURIComponent(window.location.origin)

  if (!wellKnownUrl) {
    throw new Error('NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL not configured')
  }

  if (!clientId) {
    throw new Error('NEXT_PUBLIC_CLIENT_ID not configured')
  }

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

    if (!config.authorization_endpoint) {
      throw new Error("authorization_endpoint not found in well-known configuration")
    }

    // Extract Hosted UI domain from authorization endpoint
    // e.g., https://{domain}.auth.us-east-1.amazonaws.com/oauth2/authorize
    // becomes: https://{domain}.auth.us-east-1.amazonaws.com
    const authEndpoint = config.authorization_endpoint
    const cognitoDomain = authEndpoint.replace('/oauth2/authorize', '')

    // Construct logout URL using Hosted UI domain
    const logoutUrl = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${logoutUri}`

    if (process.env.NODE_ENV === 'development') {
      console.log('[AUTH] Cognito logout URL:', logoutUrl)
    }

    return logoutUrl
  } catch (error) {
    console.error('[AUTH] Failed to get logout URL:', error)
    throw error
  }
}

export function SignOutButton() {
  const handleSignOut = async () => {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[AUTH] Starting logout process')
      }

      // Step 1: Clear all browser storage (localStorage, sessionStorage)
      // This ensures no sensitive data remains in the browser
      if (typeof window !== 'undefined') {
        sessionStorage.clear()
        localStorage.clear()
        
        // Also clear any specific keys that might exist
        // (defensive programming - clear everything just in case)
        try {
          const keys = Object.keys(localStorage)
          keys.forEach(key => localStorage.removeItem(key))
        } catch (e) {
          // Ignore errors during cleanup
        }
        
        try {
          const sessionKeys = Object.keys(sessionStorage)
          sessionKeys.forEach(key => sessionStorage.removeItem(key))
        } catch (e) {
          // Ignore errors during cleanup
        }
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[AUTH] Cleared local storage and session storage')
        }
      }
      
      // Step 2: Sign out from NextAuth
      // This clears NextAuth session cookies (next-auth.session-token, etc.)
      // Using redirect: false to prevent automatic redirect so we can handle Cognito logout
      await signOut({ 
        redirect: false,
        // Clear all callback URLs and other NextAuth data
      })
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[AUTH] NextAuth signout completed')
      }
      
      // Step 3: Get Cognito logout URL and redirect
      // This invalidates the refresh token on Cognito's side
      const logoutUrl = await getCognitoLogoutUrl()
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[AUTH] Redirecting to Cognito logout')
      }
      
      // Step 4: Redirect to Cognito logout (uses correct Hosted UI domain)
      // Cognito will invalidate the refresh token and redirect back to our app
      window.location.href = logoutUrl
    } catch (error) {
      console.error('[AUTH] Logout error:', error)
      // Force clear everything and reload on error
      // This ensures we don't leave the user in a partially logged-out state
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.clear()
          localStorage.clear()
          
          // Clear all cookies related to NextAuth
          document.cookie.split(";").forEach((c) => {
            const eqPos = c.indexOf("=")
            const name = eqPos > -1 ? c.substring(0, eqPos).trim() : c.trim()
            // Clear NextAuth cookies
            if (name.startsWith('next-auth.')) {
              document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
            }
          })
        } catch (clearError) {
          console.error('[AUTH] Error during cleanup:', clearError)
        }
        
        // Reload page to ensure clean state
        window.location.href = '/auth/signin'
      }
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSignOut}
    >
      <LogOut className="mr-2 h-4 w-4" />
      Sign Out
    </Button>
  )
}


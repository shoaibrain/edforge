"use client"

import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function SignInButton() {
  return (
    <Button
      onClick={() => signIn("cognito", { callbackUrl: "/tenants" })}
      className="w-full"
      size="lg"
    >
      Sign In with Cognito
    </Button>
  )
}


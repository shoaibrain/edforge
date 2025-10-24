"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
    >
      <LogOut className="mr-2 h-4 w-4" />
      Sign Out
    </Button>
  )
}


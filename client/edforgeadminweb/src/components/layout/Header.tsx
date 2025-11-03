import Link from "next/link"
import { getSession } from "@/lib/auth"
import { User } from "lucide-react"
import { SignOutButton } from "@/components/auth/SignOutButton"
import { Badge } from "@/components/ui/badge"

export async function Header() {
  const session = await getSession()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-xl font-bold">EdForge Admin</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/tenants"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              Tenants
            </Link>
            <Link
              href="/dashboard"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              Dashboard
            </Link>
            <Link
              href="/auth/info"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              Auth Info
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {session?.user && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4" />
                <span className="font-medium">{session.user.email}</span>
                {session.user.userRole && (
                  <Badge variant="secondary">
                    {session.user.userRole}
                  </Badge>
                )}
              </div>
              <SignOutButton />
            </>
          )}
        </div>
      </div>
    </header>
  )
}


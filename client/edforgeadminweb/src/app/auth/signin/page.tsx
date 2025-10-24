import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { SignInButton } from "@/components/auth/SignInButton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function SignInPage() {
  const session = await getSession()
  
  // If already authenticated, redirect to tenants
  if (session) {
    redirect("/tenants")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">EdForge Admin</CardTitle>
          <CardDescription>
            Sign in to manage your SaaS platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Secure authentication with AWS Cognito
            </p>
            <SignInButton />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


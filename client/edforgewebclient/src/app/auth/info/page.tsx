import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { AuthInfoClient } from "@/components/auth/AuthInfoClient"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Shield, User, Key, Clock } from "lucide-react"
import { redirect } from "next/navigation"
import { getTokensForDisplay } from "@/lib/token-service"

export default async function AuthInfoPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/auth/signin")
  }

  const tokens = await getTokensForDisplay()

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="container mx-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
              <Shield className="h-8 w-8" />
              Authentication Information
            </h1>
            <p className="text-muted-foreground">
              View your authentication details, tokens, and session information
            </p>
          </div>

          {/* User Profile Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                User Profile
              </CardTitle>
              <CardDescription>
                Your current user profile and tenant information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Name</label>
                  <p className="text-sm">{session.user?.name || "N/A"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Email</label>
                  <p className="text-sm">{session.user?.email || "N/A"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">User ID</label>
                  <p className="text-sm font-mono text-xs">{session.user?.id || "N/A"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Tenant ID</label>
                  <p className="text-sm font-mono text-xs">{(session.user as any)?.tenantId || "N/A"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Tenant Tier</label>
                  <p className="text-sm">{(session.user as any)?.tenantTier || "N/A"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">User Role</label>
                  <p className="text-sm">{(session.user as any)?.userRole || "N/A"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Session Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Session Information
              </CardTitle>
              <CardDescription>
                Current session details and expiry information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Session Status</label>
                  <p className="text-sm text-green-600">Active</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Provider</label>
                  <p className="text-sm">Cognito</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Session Error</label>
                  <p className="text-sm">{session.error || "None"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Token Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Token Information
              </CardTitle>
              <CardDescription>
                JWT tokens and authentication details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AuthInfoClient 
                accessToken={tokens?.accessToken}
                idToken={tokens?.idToken}
              />
            </CardContent>
          </Card>

          {/* Security Notice */}
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              This page displays sensitive authentication information. 
              Do not share these details with anyone and ensure you're on a secure connection.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useTenant } from "@/services/tenant-service"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface TenantDetailClientProps {
  tenantId: string
}

export function TenantDetailClient({ tenantId }: TenantDetailClientProps) {
  const { data: tenant, isLoading, error } = useTenant(tenantId)

  console.log(`Tenant details: ${JSON.stringify(tenant)}`)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {error instanceof Error ? error.message : "Failed to load tenant"}
        </AlertDescription>
      </Alert>
    )
  }

  if (!tenant) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Tenant not found</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tenants">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tenant.tenantName}</h1>
          <p className="text-muted-foreground">{tenant.email}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tenant Information</CardTitle>
            <CardDescription>Basic tenant details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Tenant ID</p>
              <p className="text-sm text-muted-foreground">{tenant.tenantRegistrationId}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-muted-foreground">{tenant.email}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Tier</p>
              <Badge>{tenant.tier}</Badge>
            </div>
            <div>
              <p className="text-sm font-medium">Status</p>
              <Badge variant={tenant.registrationStatus === "complete" ? "default" : "secondary"}>
                {tenant.registrationStatus}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Additional information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tenant.createdAt && (
              <div>
                <p className="text-sm font-medium">Created At</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(tenant.createdAt).toLocaleString()}
                </p>
              </div>
            )}
            {tenant.updatedAt && (
              <div>
                <p className="text-sm font-medium">Updated At</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(tenant.updatedAt).toLocaleString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


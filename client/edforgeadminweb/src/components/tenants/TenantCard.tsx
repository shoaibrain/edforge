"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye, Trash2 } from "lucide-react"
import type { Tenant } from "@/types/tenant"
import { useState } from "react"
import { DeleteTenantDialog } from "./DeleteTenantDialog"

interface TenantCardProps {
  tenant: Tenant
  onDelete: () => void
  isDeleting?: boolean
}

const TIER_COLORS = {
  basic: "default",
  advanced: "secondary",
  premium: "default",
} as const

const STATUS_COLORS = {
  complete: "default",
  provisioning: "secondary",
  failed: "destructive",
} as const

export function TenantCard({ tenant, onDelete, isDeleting }: TenantCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  
  const tenantName =
    tenant.tenantData?.tenantName ||
    tenant.tenantName ||
    tenant.name ||
    "Unknown Tenant"
  const email = tenant.tenantData?.email || tenant.email || "No email"
  const tier = (tenant.tenantData?.tier || tenant.tier || "unknown").toLowerCase()
  const status = (
    tenant.tenantRegistrationData?.registrationStatus ||
    tenant.registrationStatus ||
    tenant.status ||
    tenant.state ||
    tenant.tenantStatus ||
    "complete"
  ).toLowerCase()
  const isActive = tenant.sbtaws_active !== false

  return (
    <>
      <Card
        className={`transition-all hover:shadow-md ${
          !isActive ? "opacity-60 grayscale" : ""
        }`}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="space-y-1 flex-1">
            <h3 className="font-semibold leading-none tracking-tight">
              {tenantName}
            </h3>
            <p className="text-sm text-muted-foreground">{email}</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" asChild>
              <Link href={{
                    pathname: `/tenants/${tenant.tenantId}`,
                    query: { 
                      regId: tenant.tenantRegistrationData?.tenantRegistrationId || 
                              tenant.tenantRegistrationId || 
                              tenant.tenantId,  // ← FALLBACK to tenantId like AdminWeb does
                      tenantName: tenant.tenantData?.tenantName || tenant.tenantName || tenant.name,
                      email: tenant.tenantData?.email || tenant.email,
                      tier: tenant.tenantData?.tier || tenant.tier,
                      active: String(tenant.sbtaws_active !== false)
                    }
                  }}
                >
                <Eye className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowDeleteDialog(true)}
              disabled={!isActive || isDeleting}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Badge variant={TIER_COLORS[tier as keyof typeof TIER_COLORS] || "default"}>
              {tier.toUpperCase()}
            </Badge>
            <Badge variant={STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "default"}>
              {status.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">ID: {tenant.tenantId}</p>
        </CardContent>
      </Card>

      <DeleteTenantDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        tenantName={tenantName}
        onConfirm={() => {
          onDelete()
          setShowDeleteDialog(false)
        }}
      />
    </>
  )
}


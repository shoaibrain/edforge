"use client"

import { useCreateTenant } from "@/services/tenant-service"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, CheckCircle2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function CreateTenantForm() {
  const router = useRouter()
  const createMutation = useCreateTenant()
  const [formData, setFormData] = useState({
    tenantName: "",
    tenantEmail: "",
    tenantTier: "ADVANCED" as "BASIC" | "ADVANCED" | "PREMIUM",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      await createMutation.mutateAsync(formData)
      // Success - redirect to tenants list
      router.push("/tenants")
    } catch (error) {
      // Error is handled by mutation
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="tenantName">Tenant Name</Label>
        <Input
          id="tenantName"
          value={formData.tenantName}
          onChange={(e) =>
            setFormData({ ...formData, tenantName: e.target.value })
          }
          placeholder="Acme Corporation"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tenantEmail">Email</Label>
        <Input
          id="tenantEmail"
          type="email"
          value={formData.tenantEmail}
          onChange={(e) =>
            setFormData({ ...formData, tenantEmail: e.target.value })
          }
          placeholder="admin@acme.com"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tenantTier">Tier</Label>
        <select
          id="tenantTier"
          value={formData.tenantTier}
          onChange={(e) =>
            setFormData({
              ...formData,
              tenantTier: e.target.value as "BASIC" | "ADVANCED" | "PREMIUM",
            })
          }
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          <option value="BASIC">Basic</option>
          <option value="ADVANCED">Advanced</option>
          <option value="PREMIUM">Premium</option>
        </select>
      </div>

      {createMutation.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : "Failed to create tenant"}
          </AlertDescription>
        </Alert>
      )}

      {createMutation.isSuccess && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Tenant created successfully! Redirecting...
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={createMutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Create Tenant
        </Button>
      </div>
    </form>
  )
}


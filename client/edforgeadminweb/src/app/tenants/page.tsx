import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PageLayout } from "@/components/layout/PageLayout"
import { TenantListClient } from "@/components/tenants/TenantListClient"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { PlusCircle } from "lucide-react"

export default async function TenantsPage() {
  const session = await getSession()
  
  if (!session) {
    redirect("/auth/signin")
  }

  return (
    <PageLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
            <p className="text-muted-foreground">
              Manage and monitor all tenant organizations in your SaaS platform
            </p>
          </div>
          <Button asChild>
            <Link href="/tenants/create">
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Tenant
            </Link>
          </Button>
        </div>

        <TenantListClient />
      </div>
    </PageLayout>
  )
}


import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PageLayout } from "@/components/layout/PageLayout"
import { CreateTenantForm } from "@/components/tenants/CreateTenantForm"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function CreateTenantPage() {
  const session = await getSession()
  
  if (!session) {
    redirect("/auth/signin")
  }

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create New Tenant</h1>
          <p className="text-muted-foreground">
            Add a new tenant organization to your SaaS platform
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tenant Details</CardTitle>
            <CardDescription>
              Enter the information for the new tenant
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateTenantForm />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}


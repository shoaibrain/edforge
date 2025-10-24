import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PageLayout } from "@/components/layout/PageLayout"
import { TenantDetailClient } from "@/components/tenants/TenantDetailClient"

interface TenantDetailPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { regId?: string }
}) {
  const tenantId = searchParams.regId || params.id
  const session = await getSession()
  
  if (!session) {
    redirect("/auth/signin")
  }

  return (
    <PageLayout>
      <TenantDetailClient tenantId={tenantId} />
    </PageLayout>
  )
}


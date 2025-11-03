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
  searchParams: Promise<{ 
    regId?: string
    tenantName?: string
    email?: string
    tier?: string
    active?: string
  }>
}) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  const tenantId = resolvedSearchParams.regId || resolvedParams.id
  const session = await getSession()
  
  if (!session) {
    redirect("/auth/signin")
  }

  // Pass tenant data from query params
  const tenantData = {
    tenantName: resolvedSearchParams.tenantName,
    email: resolvedSearchParams.email,
    tier: resolvedSearchParams.tier,
    active: resolvedSearchParams.active
  }

  return (
    <PageLayout>
      <TenantDetailClient tenantId={tenantId} tenantData={tenantData} />
    </PageLayout>
  )
}


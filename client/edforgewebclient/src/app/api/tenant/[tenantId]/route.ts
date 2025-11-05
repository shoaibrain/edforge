/**
 * Tenant API Route - Server-side tenant fetching
 * 
 * Fetches tenant details from backend API using tenantId from session
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import serverApiClient from "@/lib/api-server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    // Next.js 15: params is now a Promise, must be awaited
    const { tenantId: requestedTenantId } = await params;
    
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify tenantId matches session tenantId
    const sessionTenantId = (session.user as any)?.tenantId;

    if (sessionTenantId !== requestedTenantId) {
      return NextResponse.json(
        { error: "Forbidden: Tenant ID mismatch" },
        { status: 403 }
      );
    }

    // Fetch tenant details from backend API
    try {
      const tenantData = await serverApiClient.get<{
        tenantId: string;
        tenantName: string;
        tier?: string;
        status?: string;
        createdAt?: string;
        [key: string]: any;
      }>(`/tenant-config/${requestedTenantId}`);

      return NextResponse.json(tenantData);
    } catch (apiError: any) {
      // If tenant-config endpoint doesn't exist, return basic info
      console.log("[Tenant API] tenant-config endpoint not available, returning basic info");
      
      return NextResponse.json({
        tenantId: requestedTenantId,
        tenantName: requestedTenantId,
        tier: (session.user as any)?.tenantTier,
      });
    }
  } catch (error) {
    console.error("[Tenant API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


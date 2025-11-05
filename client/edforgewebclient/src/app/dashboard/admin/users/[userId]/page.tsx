/**
 * EdForge EMIS - User Detail Page (DISABLED)
 * 
 * This page is disabled because GET /users/{userId} endpoint is not available
 * in the API Gateway contract (tenant-api-prod.json).
 * 
 * Only GET /users (list) and POST /users (create) are currently supported.
 * 
 * If needed in the future, this endpoint must be added to the API Gateway first.
 */

export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";

interface UserDetailPageProps {
	params: Promise<{
		userId: string;
	}>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
	// Redirect to users list page - detail view not supported by API Gateway
	redirect("/dashboard/admin/users");
}


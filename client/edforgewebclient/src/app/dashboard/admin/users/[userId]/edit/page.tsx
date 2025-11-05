/**
 * EdForge EMIS - Edit User Page (DISABLED)
 * 
 * This page is disabled because GET /users/{userId} and PUT /users/{userId} endpoints
 * are not available in the API Gateway contract (tenant-api-prod.json).
 * 
 * Only GET /users (list) and POST /users (create) are currently supported.
 * 
 * If needed in the future, these endpoints must be added to the API Gateway first.
 */

export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";

interface EditUserPageProps {
	params: Promise<{
		userId: string;
	}>;
}

export default async function EditUserPage({ params }: EditUserPageProps) {
	// Redirect to users list page - edit functionality not supported by API Gateway
	redirect("/dashboard/admin/users");
}


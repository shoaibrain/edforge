/**
 * EdForge EMIS - Dashboard Page
 * 
 * This is the main dashboard page that shows role-specific content and metrics.
 * Different users see different dashboards based on their role.
 * 
 * URL Management:
 * - If tenant has schools: redirects to /dashboard?schoolId={schoolId}
 * - If tenant has no schools: shows empty state with create school callout (URL stays /dashboard)
 * 
 * This is a Server Component for security and performance.
 */

export const dynamic = 'force-dynamic'

import { getCurrentUser } from "@/lib/auth";
import { DashboardContent } from "@/components/dashboard-content";
import { DashboardEmptyState } from "@/components/dashboard-empty-state";
import { DashboardSchoolRedirect } from "@/components/dashboard-school-redirect";
import { getSchoolsAction } from "@/actions/school-actions";
import { Suspense } from "react";
import {
	AlertCircle,
} from "lucide-react";

export default async function DashboardPage() {
	// Get user from server-side authentication
	const user = await getCurrentUser();

	if (!user) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">Authentication required</p>
				</div>
			</div>
		);
	}

	// Fetch schools list for tenant
	let schools: import("@/types/school").School[] = [];
	try {
		schools = await getSchoolsAction();
	} catch (error) {
		console.error("[DashboardPage] Error fetching schools:", error);
		// Continue - will show empty state
	}

	// If no schools exist, show empty state
	if (schools.length === 0) {
		return <DashboardEmptyState />;
	}

	// Continue with normal dashboard
	// DashboardSchoolRedirect will handle client-side redirect to add schoolId to URL
	return (
		<>
			<DashboardSchoolRedirect />
			<Suspense fallback={<div>Loading dashboard...</div>}>
				<DashboardContent user={user} />
			</Suspense>
		</>
	);
}


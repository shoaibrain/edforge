/**
 * EdForge EMIS - Dashboard Layout
 * 
 * This layout wraps all dashboard pages with:
 * - Server-side authentication and RBAC
 * - Sidebar navigation with school context
 * - Persistent top navigation
 * - Main content area
 * 
 * Note: Layouts don't receive searchParams in Next.js App Router.
 * School selection is handled via URL (?schoolId=...) and read in pages/components.
 */

import { AppSidebarServer } from "@/components/app-sidebar-server";
import { DashboardHeaderServer } from "@/components/dashboard-header-server";
import { DashboardClientWrapper } from "@/components/dashboard-client-wrapper";
import { SchoolContextProviderServer } from "@/components/school-context-provider-server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSchoolsAction, getPrimarySchoolAction } from "@/actions/school-actions";
import type { School } from "@edforge/shared-types";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Server-side authentication check
	const user = await getCurrentUser();
	
	if (!user) {
		// Redirect to sign-in if not authenticated
		redirect("/auth/signin");
	}

	// Fetch schools list and primary school for initial context
	// Note: Specific schoolId will be read from URL in client components
	let schools: School[] = [];
	let primarySchool: School | null = null;

	try {
		schools = await getSchoolsAction();
		primarySchool = await getPrimarySchoolAction();
	} catch (error) {
		console.error("[DashboardLayout] Error fetching schools:", error);
		// Continue with empty state - will be handled by components
	}

	return (
		<SchoolContextProviderServer
			initialSchool={primarySchool}
			initialSchools={schools}
		>
			<DashboardClientWrapper
				sidebar={<AppSidebarServer />}
				header={<DashboardHeaderServer />}
				content={children}
			/>
		</SchoolContextProviderServer>
	);
}
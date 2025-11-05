/**
 * EdForge EMIS - App Sidebar Server Wrapper
 * 
 * Server component that fetches user data and school data, then passes it to the client sidebar component.
 * This ensures proper server-side authentication while keeping the sidebar interactive.
 * 
 * Note: School selection is handled client-side via URL search params and SchoolContext.
 * This component fetches all schools and primary school for initial render.
 */

import { getCurrentUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { getSchoolsAction, getPrimarySchoolAction } from "@/actions/school-actions";
import type { School } from "@edforge/shared-types";

export async function AppSidebarServer() {
	const user = await getCurrentUser();
	
	if (!user) {
		return null;
	}

	// Fetch schools list for tenant
	// Note: Current school is determined client-side from URL search params
	let schools: School[] = [];
	let primarySchool: School | null = null;

	try {
		schools = await getSchoolsAction();
		primarySchool = await getPrimarySchoolAction();
	} catch (error) {
		console.error("[AppSidebarServer] Error fetching schools:", error);
		// Continue with empty state
	}
	
	return (
		<AppSidebar 
			user={user}
			schools={schools}
			currentSchool={primarySchool}
		/>
	);
}

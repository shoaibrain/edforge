/**
 * EdForge EMIS - Dashboard Header Server Wrapper
 * 
 * Server component that fetches user data and passes it to the client header component.
 * This ensures proper server-side authentication while keeping the header interactive.
 */

import { getCurrentUser } from "@/lib/auth";
import { DashboardHeader } from "@/components/dashboard-header";

export async function DashboardHeaderServer() {
	const user = await getCurrentUser();
	
	if (!user) {
		return null;
	}
	
	return <DashboardHeader user={user} />;
}

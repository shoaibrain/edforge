/**
 * EdForge EMIS - School Academic Calendar Page
 */

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { Suspense } from "react";

export const dynamic = 'force-dynamic'
import { AlertCircle } from "lucide-react";

export default async function SchoolAcademicCalendarPage() {
	// Server-side authentication and authorization
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


	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<p>School Academic Calendar page</p>
		</div>
	);
}
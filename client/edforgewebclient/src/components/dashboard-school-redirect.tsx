/**
 * EdForge EMIS - Dashboard School Redirect Component
 * 
 * Client component that handles automatic redirect to /dashboard?schoolId=X
 * when user first lands on /dashboard without a schoolId.
 * 
 * Uses client-side navigation to avoid server-side redirect console messages.
 * This ensures the URL always has a schoolId when schools exist.
 */

"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSchool } from "@/contexts/school-context";

export function DashboardSchoolRedirect() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { schools, currentSchool } = useSchool();
	const [hasRedirected, setHasRedirected] = React.useState(false);

	React.useEffect(() => {
		// Only run on dashboard page
		if (pathname !== '/dashboard') return;

		// Only redirect once per mount
		if (hasRedirected) return;

		// Check if schoolId is already in URL
		const schoolIdFromUrl = searchParams.get('schoolId');
		
		// If no schoolId in URL and we have schools, redirect to add schoolId
		if (!schoolIdFromUrl && schools.length > 0) {
			// Use the current school from context (which should be set by SchoolContext)
			// or fall back to first school
			const schoolToUse = currentSchool || schools[0];
			
			if (schoolToUse) {
				setHasRedirected(true);
				// Use router.push for client-side navigation (no console errors)
				// This preserves any other query params that might exist
				const params = new URLSearchParams(searchParams.toString());
				params.set('schoolId', schoolToUse.schoolId);
				router.push(`/dashboard?${params.toString()}`);
			}
		}
	}, [pathname, searchParams, schools, currentSchool, hasRedirected, router]);

	// This component doesn't render anything
	return null;
}


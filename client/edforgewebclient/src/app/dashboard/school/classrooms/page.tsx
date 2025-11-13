/**
 * EdForge EMIS - Classroom Management Page
 * 
 * Enterprise-grade classroom listing and management interface with RBAC integration.
 * Provides comprehensive classroom overview, filtering, and management capabilities.
 * 
 * This is a Server Component for security and performance.
 */

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { mockClassrooms } from "@/data/mock-classrooms";
import { ClassesPageContent } from "@/components/classes-page-content";
import { Suspense } from "react";

export const dynamic = 'force-dynamic'
import { AlertCircle } from "lucide-react";

export default async function ClassesPage() {
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

	// Check permissions for viewing classes
	const canViewClasses = await hasPermission(user, "VIEW_CLASSES");
	if (!canViewClasses) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to view classes</p>
				</div>
			</div>
		);
	}

	const classrooms = mockClassrooms;

	return (
		<Suspense fallback={<div>Loading classes...</div>}>
			<ClassesPageContent initialClassrooms={classrooms} />
		</Suspense>
	);
}
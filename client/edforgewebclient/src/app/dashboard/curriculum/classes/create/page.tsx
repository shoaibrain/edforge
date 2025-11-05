/**
 * EdForge EMIS - Create Classroom Page
 * 
 * Server component for creating new classrooms with proper authentication and authorization.
 * 
 * This is a Server Component for security and performance.
 */
export const dynamic = 'force-dynamic'
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { CreateClassroomContent } from "@/components/create-classroom-content";
import { Suspense } from "react";
import { AlertCircle } from "lucide-react";

export default async function CreateClassroomPage() {
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

	// Check permissions for creating classes
	const canCreateClasses = await hasPermission(user, "CREATE_CLASSES");
	if (!canCreateClasses) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to create classes</p>
				</div>
			</div>
		);
	}

	return (
		<Suspense fallback={<div>Loading create classroom form...</div>}>
			<CreateClassroomContent />
		</Suspense>
	);
}
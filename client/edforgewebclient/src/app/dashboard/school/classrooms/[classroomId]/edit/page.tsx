/**
 * EdForge EMIS - Edit Classroom Page
 * 
 * Server component for editing existing classrooms with proper authentication and authorization.
 * 
 * This is a Server Component for security and performance.
 */

import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getClassroomById } from "@/data/mock-classrooms";
import { EditClassroomContent } from "@/components/edit-classroom-content";
import { Suspense } from "react";
import { AlertCircle } from "lucide-react";

interface EditClassroomPageProps {
	params: Promise<{
		classroomId: string;
	}>;
}

export default async function EditClassroomPage({ params }: EditClassroomPageProps) {
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

	const { classroomId } = await params;
	const classroom = getClassroomById(classroomId);

	if (!classroom) {
		notFound();
	}

	// Check permissions for editing classroom
	const canEditClassroom = await hasPermission(user, "CREATE_CLASSES", classroomId);
	if (!canEditClassroom) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to edit this classroom</p>
				</div>
			</div>
		);
	}

	return (
		<Suspense fallback={<div>Loading edit classroom form...</div>}>
			<EditClassroomContent classroom={classroom} />
		</Suspense>
	);
}

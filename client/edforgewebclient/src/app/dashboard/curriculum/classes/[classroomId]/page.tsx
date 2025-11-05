/**
 * EdForge EMIS - Classroom Details Page
 * 
 * Server component for viewing classroom details with proper authentication and authorization.
 * 
 * This is a Server Component for security and performance.
 */

import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getClassroomById } from "@/data/mock-classrooms";
import { ClassroomDetailsContent } from "@/components/classroom-details-content";
import { Suspense } from "react";
import { AlertCircle } from "lucide-react";

interface ClassroomDetailsPageProps {
	params: Promise<{
		classroomId: string;
	}>;
}

export default async function ClassroomDetailsPage({ params }: ClassroomDetailsPageProps) {
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

	// Check permissions for viewing classroom details
	const canViewClassroom = await hasPermission(user, "VIEW_CLASSROOM_DETAILS", classroomId);
	if (!canViewClassroom) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to view this classroom</p>
				</div>
			</div>
		);
	}

	return (
		<Suspense fallback={<div>Loading classroom details...</div>}>
			<ClassroomDetailsContent classroom={classroom} />
		</Suspense>
	);
}
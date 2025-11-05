/**
 * EdForge EMIS - Create School Page
 * 
 * Server Component wrapper for school creation form.
 */

export const dynamic = 'force-dynamic';

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { Permission } from "@/types/rbac";
import { CreateSchoolForm } from "./_components/create-school-form";
import { AlertCircle, Lock } from "lucide-react";

export default async function CreateSchoolPage() {
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

	// Check if user has permission to create schools
	const canCreateSchool = await hasPermission(user, Permission.MANAGE_USERS);
	if (!canCreateSchool) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<Lock className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to create schools</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<CreateSchoolForm />
		</div>
	);
}


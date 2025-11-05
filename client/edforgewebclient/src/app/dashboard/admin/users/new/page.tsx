/**
 * EdForge EMIS - Create User Page
 * 
 * Page for creating new users in the system
 */

export const dynamic = 'force-dynamic';

import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CreateUserForm } from "@/components/create-user-form";

export default async function CreateUserPage() {
	// Server-side authentication and authorization
	const user = await getCurrentUser();
	
	if (!user) {
		redirect("/auth/signin");
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Create New User</h1>
					<p className="text-muted-foreground">Add a new user to your organization</p>
				</div>
			</div>

			<CreateUserForm />
		</div>
	);
}


/**
 * EdForge EMIS - Schools List Page
 * 
 * Server Component that lists all schools for the tenant.
 * If no schools exist, shows empty state with "Create School" button.
 */

export const dynamic = 'force-dynamic';

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { Permission } from "@/types/rbac";
import { getSchoolsAction } from "@/actions/school-actions";
import { SchoolsListContent } from "./_components/schools-list-content";
import { AlertCircle, Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { School } from "@edforge/shared-types";

export default async function SchoolsPage() {
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

	// Check if user has permission to view schools
	const canViewSchools = await hasPermission(user, Permission.MANAGE_USERS);
	if (!canViewSchools) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<Lock className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to view schools</p>
				</div>
			</div>
		);
	}

	// Fetch schools for tenant
	let schools: School[] = [];
	try {
		schools = await getSchoolsAction();
	} catch (error) {
		console.error("[SchoolsPage] Error fetching schools:", error);
		// Continue with empty array - will show empty state
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Schools</h1>
					<p className="text-muted-foreground">
						Manage your educational institutions
					</p>
				</div>
				<Button asChild>
					<Link href="/dashboard/admin/schools/create">
						<Plus className="mr-2 h-4 w-4" />
						Create School
					</Link>
				</Button>
			</div>

			{schools.length === 0 ? (
				<Card className="border-2 border-dashed">
					<CardContent className="p-12 text-center">
						<div className="flex flex-col items-center gap-4">
							<div className="p-4 rounded-full bg-primary/10">
								<Building2 className="h-12 w-12 text-primary" />
							</div>
							<div>
								<h3 className="text-lg font-semibold text-foreground mb-2">
									No schools found
								</h3>
								<p className="text-sm text-muted-foreground mb-6">
									Get started by creating your first school
								</p>
							</div>
							<Button asChild>
								<Link href="/dashboard/admin/schools/create">
									<Plus className="mr-2 h-4 w-4" />
									Create School
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				<SchoolsListContent schools={schools} />
			)}
		</div>
	);
}


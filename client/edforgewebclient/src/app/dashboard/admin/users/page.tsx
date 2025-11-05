/**
 * EdForge EMIS - User Management Page
 * 
 * Comprehensive user listing with search, filtering, and CRUD operations.
 * Displays user information in an elegant table format with RBAC considerations.
 * 
 * This is a Server Component for security and performance.
 */
export const dynamic = 'force-dynamic';

import { getCurrentUser } from "@/lib/auth";
import { fetchUsersAction } from "@/actions/user-actions";
import type { User } from "@/types/user";
import {
	Users,
	UserPlus,
	Shield,
	CheckCircle2,
	AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { UsersTable } from "@/components/users-table";
import { UsersFilters } from "@/components/users-filters";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface UsersPageProps {
	searchParams: Promise<{
		search?: string;
		role?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
	}>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
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

	// Fetch users using Server Action (runs server-side, uses api-server.ts)
	let users: User[] = [];
	let error: string | null = null;
	
	try {
		users = await fetchUsersAction();
	} catch (err) {
		console.error("[UsersPage] Error fetching users:", err);
		error = err instanceof Error ? err.message : "Failed to fetch users";
	}

	// Get unique roles and statuses for filters
	const roles = Array.from(
		new Set(users.map((u) => u.role || u.userRole || "Unknown").filter(Boolean))
	).sort();
	const statuses = Array.from(
		new Set(users.map((u) => u.status || (u.enabled ? "active" : "inactive")).filter(Boolean))
	).sort();

	const params = await searchParams;

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			{/* Header with Action Button */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">User Management</h1>
					<p className="text-muted-foreground">Manage users and their roles for your organization</p>
				</div>
				<Button asChild>
					<Link href="/dashboard/admin/users/new">
						<UserPlus className="h-4 w-4 mr-2" />
						Add User
					</Link>
				</Button>
			</div>

			{/* Error Display */}
			{error && (
				<Card className="border-destructive">
					<CardContent className="p-4">
						<div className="flex items-center gap-2 text-destructive">
							<AlertCircle className="h-5 w-5" />
							<p>{error}</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Professional Compact Stats Cards */}
			<div className="grid gap-2 md:grid-cols-4">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Users</p>
								<p className="text-lg font-semibold text-foreground">{users.length}</p>
								<p className="text-xs text-muted-foreground/70">Active accounts</p>
							</div>
							<Users className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Active Users</p>
								<p className="text-lg font-semibold text-foreground">
									{users.filter((u) => u.enabled !== false && u.status !== "inactive").length}
								</p>
								<p className="text-xs text-muted-foreground/70">Currently enabled</p>
							</div>
							<CheckCircle2 className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Admins</p>
								<p className="text-lg font-semibold text-primary">
									{users.filter((u) => 
										(u.role || u.userRole || "").toLowerCase().includes("admin")
									).length}
								</p>
								<p className="text-xs text-muted-foreground/70">Administrators</p>
							</div>
							<Shield className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Verified</p>
								<p className="text-lg font-semibold text-foreground">
									{users.filter((u) => u.verified !== false).length}
								</p>
								<p className="text-xs text-muted-foreground/70">Email verified</p>
							</div>
							<CheckCircle2 className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Filters and Search - Client Component */}
			<Suspense fallback={<div>Loading filters...</div>}>
				<UsersFilters roles={roles} statuses={statuses} />
			</Suspense>

			{/* Users Table - Client Component */}
			<Suspense fallback={<div>Loading users table...</div>}>
				<UsersTable users={users} />
			</Suspense>
		</div>
	);
}


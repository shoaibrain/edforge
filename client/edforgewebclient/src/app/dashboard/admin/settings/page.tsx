/**
 * EdForge EMIS - Institution Settings Page
 * 
 * Main settings page for institution administrators to configure
 * various aspects of the school management system.
 * 
 * This is a Server Component for security and performance.
 * Fetches school data and academic years server-side based on schoolId from URL.
 */
export const dynamic = 'force-dynamic'

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { Permission } from "@/types/rbac";
import { InstitutionSettingsContent } from "@/app/dashboard/admin/settings/_components/institution-settings-content";
import { getPrimarySchoolAction, getAcademicYearsAction, getSchoolAction } from "@/actions/school-actions";
import { Suspense } from "react";
import { AlertCircle, Lock, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { redirect } from "next/navigation";

interface InstitutionSettingsPageProps {
	searchParams: Promise<{
		schoolId?: string;
		activeTab?: string;
	}>;
}

export default async function InstitutionSettingsPage({ searchParams }: InstitutionSettingsPageProps) {
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

	// Check if user has permission to access settings
	const canAccessSettings = await hasPermission(user, "VIEW_SETTINGS");
	if (!canAccessSettings) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<Lock className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to access settings</p>
				</div>
			</div>
		);
	}

	// Get search params from URL
	const params = await searchParams;
	const schoolId = params?.schoolId;
	const activeTab = params?.activeTab;

	// Fetch school for tenant (use schoolId from URL if provided, otherwise primary school)
	let currentSchool = null;
	let academicYears: import("@/types/school").AcademicYear[] = [];
	try {
		if (schoolId) {
			// Use schoolId from URL
			try {
				currentSchool = await getSchoolAction(schoolId);
				// Verify school belongs to tenant (security check)
				if (!currentSchool || currentSchool.tenantId !== user.tenantId) {
					console.warn("[SettingsPage] School does not belong to tenant, using primary school");
					currentSchool = null;
				}
			} catch (error) {
				console.error("[SettingsPage] Error fetching school by ID:", error);
				currentSchool = null;
			}
		}

		// Fallback: Use primary school if no schoolId provided or school not found
		if (!currentSchool) {
			currentSchool = await getPrimarySchoolAction();
		}

		if (currentSchool) {
			// Ensure schoolId is in URL for consistency and security
			// If schoolId was missing from URL but we found a school, redirect to include it
			if (!schoolId && currentSchool) {
				redirect(`/dashboard/admin/settings?schoolId=${currentSchool.schoolId}`);
			}

			// Fetch academic years for the school
			try {
				academicYears = await getAcademicYearsAction(currentSchool.schoolId);
			} catch (error) {
				console.error("[SettingsPage] Error fetching academic years:", error);
				// Continue with empty array
			}
		}
	} catch (error) {
		console.error("[SettingsPage] Error fetching school:", error);
		// Continue - will show empty state
	}

	// If no school exists, show empty state with create button
	if (!currentSchool) {
		return (
			<div className="flex flex-1 flex-col gap-6 p-6 w-full">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold tracking-tight">Institution Settings</h1>
						<p className="text-muted-foreground">
							Configure your school's settings and preferences
						</p>
					</div>
				</div>

				<Card className="border-2 border-dashed">
					<CardContent className="p-12 text-center">
						<div className="flex flex-col items-center gap-4">
							<div className="p-4 rounded-full bg-primary/10">
								<Building2 className="h-12 w-12 text-primary" />
							</div>
							<div>
								<h3 className="text-lg font-semibold text-foreground mb-2">
									No school found
								</h3>
								<p className="text-sm text-muted-foreground mb-6">
									Create a school to get started with institution settings
								</p>
							</div>
							<Button asChild>
								<Link href="/dashboard/admin/schools/create">
									<Building2 className="mr-2 h-4 w-4" />
									Create School
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<Suspense fallback={
				<div className="animate-pulse space-y-4">
					<div className="h-8 bg-muted rounded w-1/4"></div>
					<div className="h-4 bg-muted rounded w-1/2"></div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="h-64 bg-muted rounded"></div>
						<div className="h-64 bg-muted rounded"></div>
					</div>
				</div>
			}>
			<InstitutionSettingsContent 
				user={user} 
				school={currentSchool}
				academicYears={academicYears}
				initialActiveTab={activeTab}
			/>
			</Suspense>
		</div>
	);
}

/**
 * EdForge EMIS - School Staff Onboarding Page
 * This is a Server Component for security and performance.
 */
export const dynamic = 'force-dynamic'
import { getCurrentUser } from "@/lib/auth";
import { OnboardingDashboard } from "./_components/onboarding-dashboard";

interface PeopleOnboardingPageProps {
	searchParams: Promise<{
		search?: string;
		grade?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
	}>;
}

import type { OnboardingDashboardData } from "@/lib/schemas"

export default async function PeopleOnboardingPage({ searchParams }: PeopleOnboardingPageProps) {
	// Server-side authentication and authorization
	const user = await getCurrentUser();
	
	if (!user) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<p className="text-muted-foreground">Authentication required</p>
				</div>
			</div>
		);
	}

	const params = await searchParams;

	// Comprehensive onboarding stats data aligned with SABER framework
	// Demonstrates enterprise-grade EMIS capabilities with data-driven decision support
	// Business-critical: Department-Role breakdown shows staffing composition and resource allocation
	const onboardingData: OnboardingDashboardData = {
		stats: {
			totalOnboarded: 156,
			monthlyIncrease: 12, // +8.3% month-over-month growth
			completionRate: 94.2, // High performance indicator - SABER efficiency metric
			averageTime: 5.5, // Efficient process - below industry average
			inProgress: 9, // Active pipeline - 5.8% of total
		},
		departmentRoleBreakdown: [
			{
				department: "Academic",
				totalCount: 68, // Largest department - 43.6% of total
				roles: [
					{ role: "Teacher", count: 58, percentage: 85.3 }, // Core academic staff
					{ role: "Administrator", count: 5, percentage: 7.4 }, // Department leadership
					{ role: "Counselor", count: 3, percentage: 4.4 }, // Student support
					{ role: "Librarian", count: 2, percentage: 2.9 }, // Resource management
				],
			},
			{
				department: "Administration",
				totalCount: 32, // 20.5% of total
				roles: [
					{ role: "Administrator", count: 19, percentage: 59.4 }, // Primary role
					{ role: "Support Staff", count: 10, percentage: 31.2 }, // Administrative support
					{ role: "IT Staff", count: 2, percentage: 6.3 }, // Technical support
					{ role: "Counselor", count: 1, percentage: 3.1 }, // Specialized support
				],
			},
			{
				department: "Support Staff",
				totalCount: 28, // 17.9% of total
				roles: [
					{ role: "Support Staff", count: 18, percentage: 64.3 }, // Primary role
					{ role: "Maintenance", count: 6, percentage: 21.4 }, // Facilities
					{ role: "IT Staff", count: 3, percentage: 10.7 }, // Technical support
					{ role: "Administrator", count: 1, percentage: 3.6 }, // Management
				],
			},
			{
				department: "IT",
				totalCount: 15, // 9.6% of total
				roles: [
					{ role: "IT Staff", count: 10, percentage: 66.7 }, // Primary role
					{ role: "Support Staff", count: 3, percentage: 20.0 }, // IT support
					{ role: "Administrator", count: 2, percentage: 13.3 }, // IT management
				],
			},
			{
				department: "Maintenance",
				totalCount: 13, // 8.3% of total
				roles: [
					{ role: "Maintenance", count: 7, percentage: 53.8 }, // Primary role
					{ role: "Support Staff", count: 5, percentage: 38.5 }, // Support staff
					{ role: "Administrator", count: 1, percentage: 7.7 }, // Facilities management
				],
			},
		],
		statusBreakdown: [
			{ status: "Completed", count: 147, percentage: 94.2 }, // High completion rate
			{ status: "In Progress", count: 9, percentage: 5.8 }, // Active pipeline
		],
		trends: [
			{ month: "Jan", onboarded: 8, completed: 7 }, // Post-holiday ramp-up
			{ month: "Feb", onboarded: 12, completed: 11 }, // Growth trend
			{ month: "Mar", onboarded: 15, completed: 14 }, // Continued growth
			{ month: "Apr", onboarded: 18, completed: 17 }, // Peak hiring season
			{ month: "May", onboarded: 14, completed: 13 }, // Slight dip
			{ month: "Jun", onboarded: 16, completed: 15 }, // Recovery
			{ month: "Jul", onboarded: 19, completed: 18 }, // Peak month (summer hiring)
			{ month: "Aug", onboarded: 12, completed: 11 }, // End of peak season
		],
		recentActivities: [
			{
				id: 1,
				type: "completed",
				title: "Onboarding completed",
				description: "Sarah Johnson - Teacher (Mathematics)",
				time: "2 hours ago",
			},
			{
				id: 2,
				type: "in_progress",
				title: "Onboarding in progress",
				description: "Michael Chen - IT Staff (Day 3 of 5)",
				time: "5 hours ago",
			},
			{
				id: 3,
				type: "started",
				title: "New onboarding started",
				description: "Emily Davis - Support Staff",
				time: "1 day ago",
			},
			{
				id: 4,
				type: "completed",
				title: "Onboarding completed",
				description: "Robert Martinez - Administrator (Human Resources)",
				time: "1 day ago",
			},
			{
				id: 5,
				type: "in_progress",
				title: "Onboarding in progress",
				description: "Jennifer Lee - Teacher (Science) - Day 4 of 5",
				time: "2 days ago",
			},
			{
				id: 6,
				type: "started",
				title: "New onboarding started",
				description: "David Thompson - Counselor",
				time: "2 days ago",
			},
			{
				id: 7,
				type: "completed",
				title: "Onboarding completed",
				description: "Patricia Garcia - Librarian",
				time: "3 days ago",
			},
		],
	};
    
	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<OnboardingDashboard data={onboardingData} />
		</div>
	);
}

/**
 * EdForge EMIS - Students Enrollment Page
 * This is a Server Component for security and performance.
 */
export const dynamic = 'force-dynamic'
import { getCurrentUser } from "@/lib/auth";
import { EnrollmentDashboard } from "./_components/enrollment-dashboard";

interface StudentEnrollmentPageProps {
	searchParams: Promise<{
		search?: string;
		grade?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
	}>;
}

import type {
	EnrollmentDashboardData,
	EnrollmentStats,
	RecentActivity,
	EnrollmentAlert,
	EnrollmentTrendData,
	GradeDistributionData,
	CompletionFunnelData,
	StatusBreakdownData,
	EnrollmentDashboardAnalytics,
} from "@/lib/schemas";

export default async function StudentEnrollmentPage({ searchParams }: StudentEnrollmentPageProps) {
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

	// Comprehensive enrollment stats data aligned with SABER framework
	// Demonstrates enterprise-grade EMIS capabilities with data-driven decision support
	const enrollmentData: EnrollmentDashboardData = {
		stats: {
			totalEnrolled: 2847, // Total student enrollment - SABER enrollment rate metric
			monthlyIncrease: 245, // +9.4% month-over-month growth - SABER access rate indicator
			completionRate: 99.9, // Excellent completion rate - SABER efficiency metric
			pendingReviews: 3, // Minimal backlog - SABER data quality indicator
		},
		recentActivities: [
			{
				id: 1,
				type: "enrollment",
				title: "New student enrolled",
				description: "Emma Wilson joined Grade 10 - Section A",
				time: "5 minutes ago",
			},
			{
				id: 2,
				type: "review",
				title: "Application pending review",
				description: "John Doe - Grade 9 application requires verification",
				time: "1 hour ago",
			},
			{
				id: 3,
				type: "completed",
				title: "Enrollment completed",
				description: "Sarah Johnson - Grade 11 enrollment finalized",
				time: "2 hours ago",
			},
			{
				id: 4,
				type: "enrollment",
				title: "Bulk import completed",
				description: "45 students imported from CSV file",
				time: "3 hours ago",
			},
			{
				id: 5,
				type: "completed",
				title: "Enrollment completed",
				description: "Michael Chen - Grade 8 enrollment finalized",
				time: "4 hours ago",
			},
		],
		alerts: [
			{
				id: 1,
				type: "warning",
				message: "3 enrollment applications require immediate review",
			},
			{
				id: 2,
				type: "info",
				message: "Peak enrollment period: June - August. Prepare for increased volume.",
			},
		],
		analytics: {
			trends: [
				{ date: "2024-01", enrollments: 198, completed: 195, pending: 3 }, // Post-holiday enrollment
				{ date: "2024-02", enrollments: 215, completed: 212, pending: 3 }, // Growth trend
				{ date: "2024-03", enrollments: 234, completed: 231, pending: 3 }, // Continued growth
				{ date: "2024-04", enrollments: 267, completed: 264, pending: 3 }, // Spring enrollment
				{ date: "2024-05", enrollments: 289, completed: 286, pending: 3 }, // Pre-summer increase
				{ date: "2024-06", enrollments: 312, completed: 309, pending: 3 }, // Peak enrollment (summer start)
				{ date: "2024-07", enrollments: 298, completed: 295, pending: 3 }, // High summer enrollment
				{ date: "2024-08", enrollments: 245, completed: 242, pending: 3 }, // End of peak season
			],
			gradeDistribution: [
				{ grade: "Kindergarten", count: 142, percentage: 5.0 }, // Entry level
				{ grade: "Grade 1", count: 198, percentage: 7.0 }, // Elementary growth
				{ grade: "Grade 2", count: 213, percentage: 7.5 },
				{ grade: "Grade 3", count: 227, percentage: 8.0 },
				{ grade: "Grade 4", count: 241, percentage: 8.5 },
				{ grade: "Grade 5", count: 256, percentage: 9.0 },
				{ grade: "Grade 6", count: 284, percentage: 10.0 }, // Middle school peak
				{ grade: "Grade 7", count: 298, percentage: 10.5 },
				{ grade: "Grade 8", count: 312, percentage: 11.0 }, // Peak enrollment
				{ grade: "Grade 9", count: 341, percentage: 12.0 }, // High school entry peak
				{ grade: "Grade 10", count: 298, percentage: 10.5 },
				{ grade: "Grade 11", count: 156, percentage: 5.5 }, // Graduation attrition
				{ grade: "Grade 12", count: 121, percentage: 4.5 }, // Final year
			],
			completionFunnel: [
				{ step: "Student Information", count: 2847, percentage: 100 }, // Entry point
				{ step: "Contact Details", count: 2756, percentage: 96.8 }, // 3.2% drop-off
				{ step: "Academics", count: 2689, percentage: 94.5 }, // Additional 2.3% drop-off
				{ step: "Review & Finalize", count: 2844, percentage: 99.9 }, // Near-complete (0.1% pending)
			],
			statusBreakdown: [
				{ status: "Completed", count: 2844, percentage: 99.9, color: "success" }, // High completion - SABER efficiency
				{ status: "Pending Review", count: 3, percentage: 0.1, color: "warning" }, // Minimal backlog
			],
			averageCompletionTime: 2.5, // Hours - efficient process - SABER efficiency metric
			peakEnrollmentPeriod: "June - August", // Summer enrollment peak - SABER seasonal pattern
			enrollmentSources: [
				{ source: "Online Application", count: 1847, percentage: 64.9 }, // Primary channel - digital transformation
				{ source: "Walk-in", count: 623, percentage: 21.9 }, // Traditional channel
				{ source: "Referral", count: 287, percentage: 10.1 }, // Word-of-mouth
				{ source: "Bulk Import", count: 90, percentage: 3.2 }, // Administrative efficiency
			],
		},
	};

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<EnrollmentDashboard data={enrollmentData} />
		</div>
	);
}

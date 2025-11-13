/**
 * EdForge EMIS - Students List Page
 * 
 * Comprehensive students listing with search, filtering, and sorting capabilities.
 * Displays student information in an elegant table format with RBAC considerations.
 * 
 * This is a Server Component for security and performance.
 */
export const dynamic = 'force-dynamic'
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getAllStudents } from "@/data/mock-students";
import type { StudentProfileSummary } from "@/lib/schemas";
import {
	Users,
	GraduationCap,
	Calendar,
	Award,
	Mail,
	Phone,
	AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentsTable } from "@/components/students-table";
import { StudentsFilters } from "@/components/students-filters";
import { Suspense } from "react";
import { GradeDistributionChart } from "./_components/charts/grade-distribution-chart";
import { PerformanceTrendsChart } from "./_components/charts/performance-trends-chart";
import { EnrollmentTrendsChart } from "./_components/charts/enrollment-trends-chart";
import { StatusBreakdownChart } from "./_components/charts/status-breakdown-chart";
import { GradeLevelPerformanceChart } from "./_components/charts/grade-level-performance-chart";
import { RiskIndicatorsChart } from "./_components/charts/risk-indicators-chart";

interface StudentsPageProps {
	searchParams: Promise<{
		search?: string;
		grade?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
	}>;
}

export default async function StudentsPage({ searchParams }: StudentsPageProps) {
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

	const params = await searchParams;
	const students = getAllStudents();

	// Get unique grades and statuses for filters
	const grades = Array.from(new Set(students.map((s) => s.grade))).sort();
	const statuses = Array.from(new Set(students.map((s) => s.status))).sort();

	// Calculate grade distribution
	const gradeDistribution = [
		{ grade: "A", count: students.filter(s => s.overallGPA >= 3.7).length, percentage: (students.filter(s => s.overallGPA >= 3.7).length / students.length) * 100 },
		{ grade: "B", count: students.filter(s => s.overallGPA >= 3.0 && s.overallGPA < 3.7).length, percentage: (students.filter(s => s.overallGPA >= 3.0 && s.overallGPA < 3.7).length / students.length) * 100 },
		{ grade: "C", count: students.filter(s => s.overallGPA >= 2.0 && s.overallGPA < 3.0).length, percentage: (students.filter(s => s.overallGPA >= 2.0 && s.overallGPA < 3.0).length / students.length) * 100 },
		{ grade: "D", count: students.filter(s => s.overallGPA >= 1.0 && s.overallGPA < 2.0).length, percentage: (students.filter(s => s.overallGPA >= 1.0 && s.overallGPA < 2.0).length / students.length) * 100 },
		{ grade: "F", count: students.filter(s => s.overallGPA < 1.0).length, percentage: (students.filter(s => s.overallGPA < 1.0).length / students.length) * 100 },
	].filter(g => g.count > 0);

	// Performance trends (12 months)
	const performanceTrends = [
		{ period: "2023-09", averageGPA: 3.45, averageScore: 85.2 },
		{ period: "2023-10", averageGPA: 3.48, averageScore: 85.8 },
		{ period: "2023-11", averageGPA: 3.52, averageScore: 86.5 },
		{ period: "2023-12", averageGPA: 3.55, averageScore: 87.1 },
		{ period: "2024-01", averageGPA: 3.58, averageScore: 87.6 },
		{ period: "2024-02", averageGPA: 3.61, averageScore: 88.2 },
		{ period: "2024-03", averageGPA: 3.63, averageScore: 88.7 },
		{ period: "2024-04", averageGPA: 3.65, averageScore: 89.1 },
		{ period: "2024-05", averageGPA: 3.67, averageScore: 89.5 },
		{ period: "2024-06", averageGPA: 3.68, averageScore: 89.8 },
		{ period: "2024-07", averageGPA: 3.69, averageScore: 90.0 },
		{ period: "2024-08", averageGPA: 3.70, averageScore: 90.2 },
	];

	// Enrollment trends
	const enrollmentTrends = [
		{ period: "2023-09", total: 142, active: 140, graduated: 2 },
		{ period: "2023-10", total: 145, active: 142, graduated: 2 },
		{ period: "2023-11", total: 147, active: 144, graduated: 2 },
		{ period: "2023-12", total: 148, active: 145, graduated: 3 },
		{ period: "2024-01", total: 150, active: 147, graduated: 3 },
		{ period: "2024-02", total: 152, active: 149, graduated: 3 },
		{ period: "2024-03", total: 154, active: 151, graduated: 3 },
		{ period: "2024-04", total: 156, active: 153, graduated: 3 },
		{ period: "2024-05", total: 158, active: 155, graduated: 3 },
		{ period: "2024-06", total: 160, active: 157, graduated: 3 },
		{ period: "2024-07", total: 162, active: 159, graduated: 3 },
		{ period: "2024-08", total: 165, active: 162, graduated: 3 },
	];

	// Status breakdown
	const statusBreakdown = [
		{ status: "Active", count: students.filter(s => s.status === "active").length, percentage: (students.filter(s => s.status === "active").length / students.length) * 100, color: "#10B981" },
		{ status: "Graduated", count: students.filter(s => s.status === "graduated").length, percentage: (students.filter(s => s.status === "graduated").length / students.length) * 100, color: "#3B82F6" },
		{ status: "Transferred", count: students.filter(s => s.status === "transferred").length, percentage: (students.filter(s => s.status === "transferred").length / students.length) * 100, color: "#8B5CF6" },
		{ status: "Suspended", count: students.filter(s => s.status === "suspended").length, percentage: (students.filter(s => s.status === "suspended").length / students.length) * 100, color: "#EF4444" },
	].filter(s => s.count > 0);

	// Grade-level performance
	const gradeLevelPerformance = grades.map(grade => {
		const gradeStudents = students.filter(s => s.grade === grade);
		const avgGPA = gradeStudents.reduce((sum, s) => sum + s.overallGPA, 0) / gradeStudents.length;
		return {
			grade,
			averageGPA: avgGPA,
			studentCount: gradeStudents.length,
			passRate: (gradeStudents.filter(s => s.overallGPA >= 2.0).length / gradeStudents.length) * 100,
		};
	});

	// Risk indicators
	const riskIndicators = [
		{
			category: "Low GPA",
			count: students.filter(s => s.overallGPA < 2.0).length,
			percentage: (students.filter(s => s.overallGPA < 2.0).length / students.length) * 100,
			riskLevel: "high" as const,
		},
		{
			category: "Poor Attendance",
			count: Math.floor(students.length * 0.08), // 8% estimated
			percentage: 8.0,
			riskLevel: "medium" as const,
		},
		{
			category: "Behavioral Issues",
			count: Math.floor(students.length * 0.04), // 4% estimated
			percentage: 4.0,
			riskLevel: "medium" as const,
		},
		{
			category: "At Risk",
			count: students.filter(s => s.overallGPA < 2.5).length,
			percentage: (students.filter(s => s.overallGPA < 2.5).length / students.length) * 100,
			riskLevel: "high" as const,
		},
	].filter(r => r.count > 0);

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			{/* Professional Compact Stats Cards */}
			<div className="grid gap-2 md:grid-cols-4">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-1">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Students</p>
								<p className="text-lg font-semibold text-foreground">{students.length}</p>
								<p className="text-xs text-muted-foreground/70">+12% from last semester</p>
							</div>
							<Users className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Active Students</p>
								<p className="text-lg font-semibold text-foreground">
									{students.filter((s) => s.status === "active").length}
								</p>
								<p className="text-xs text-muted-foreground/70">Currently enrolled</p>
							</div>
							<GraduationCap className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Average GPA</p>
								<p className="text-lg font-semibold text-primary">
									{(
										students
											.filter((s) => s.status === "active")
											.reduce((sum, s) => sum + s.overallGPA, 0) /
										students.filter((s) => s.status === "active").length
									).toFixed(2)}
								</p>
								<p className="text-xs text-muted-foreground/70">School average</p>
							</div>
							<Award className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Graduation Rate</p>
								<p className="text-lg font-semibold text-foreground">94%</p>
								<p className="text-xs text-muted-foreground/70">Class of 2024</p>
							</div>
							<Calendar className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Comprehensive Analytics Dashboard */}
			<div className="space-y-6">
				{/* Row 2: Grade Distribution & Performance Trends */}
				<div className="grid gap-6 lg:grid-cols-2">
					<GradeDistributionChart data={gradeDistribution} />
					<PerformanceTrendsChart data={performanceTrends} />
				</div>

				{/* Row 3: Enrollment Trends & Status Breakdown */}
				<div className="grid gap-6 lg:grid-cols-2">
					<EnrollmentTrendsChart data={enrollmentTrends} />
					<StatusBreakdownChart data={statusBreakdown} />
				</div>

				{/* Row 4: Grade-Level Performance & Risk Indicators */}
				<div className="grid gap-6 lg:grid-cols-2">
					<GradeLevelPerformanceChart data={gradeLevelPerformance} />
					<RiskIndicatorsChart data={riskIndicators} />
				</div>
			</div>

			{/* Filters and Search - Client Component */}
			<Suspense fallback={<div>Loading filters...</div>}>
				<StudentsFilters grades={grades} statuses={statuses} />
			</Suspense>

			{/* Students Table - Client Component */}
			<Suspense fallback={<div>Loading students table...</div>}>
				<StudentsTable students={students} />
			</Suspense>
		</div>
	);
}

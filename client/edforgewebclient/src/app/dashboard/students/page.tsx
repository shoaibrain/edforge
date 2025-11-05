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
import type { StudentProfile } from "@/types/student";
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

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			{/* Professional Compact Stats Cards */}
			<div className="grid gap-2 md:grid-cols-4">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
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

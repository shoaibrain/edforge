/**
 * EdForge EMIS - Student Profile Page
 * 
 * Comprehensive student profile with radar chart, academic details,
 * contact information, and performance analytics.
 * 
 * This is a Server Component for security and performance.
 */

import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getStudentById } from "@/data/mock-students";
import type { ComprehensiveStudentProfile } from "@/lib/schemas";
import { StudentPerformanceChart } from "@/components/student-performance-chart";
import {
	ArrowLeft,
	Mail,
	Phone,
	MapPin,
	Calendar,
	GraduationCap,
	Award,
	Users,
	BookOpen,
	Activity,
	TrendingUp,
	TrendingDown,
	Minus,
	Edit,
	Download,
	Share,
	MoreHorizontal,
	AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StudentProfileActions } from "@/components/student-profile-actions";
import { Suspense } from "react";
import { AcademicGrowthAnalytics } from "./_components/academic-growth-analytics";
import { ComprehensiveStudentPerformance } from "./_components/comprehensive-student-performance";
import { BehavioralAnalytics } from "./_components/behavioral-analytics";
import { SubjectPerformanceComparisonChart } from "./_components/charts/subject-performance-comparison-chart";

interface StudentProfilePageProps {
	params: Promise<{
		studentId: string;
	}>;
}

export default async function StudentProfilePage({ params }: StudentProfilePageProps) {
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

	const { studentId } = await params;
	const student = getStudentById(studentId);

	if (!student) {
		notFound();
	}

	// Check permissions for viewing student details
	const canViewStudentDetails = await hasPermission(user, "VIEW_STUDENT_DETAILS", studentId);
	if (!canViewStudentDetails) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">You don't have permission to view this student</p>
				</div>
			</div>
		);
	}

	// Calculate average performance
	const averageScore = Math.round(
		student.performanceData.reduce((sum, item) => sum + item.score, 0) / student.performanceData.length,
	);

	// Get trend icon
	const getTrendIcon = (trend?: "up" | "down" | "stable") => {
		switch (trend) {
			case "up":
				return <TrendingUp className="h-3 w-3 text-success" />;
			case "down":
				return <TrendingDown className="h-3 w-3 text-error" />;
			default:
				return <Minus className="h-3 w-3 text-muted-foreground" />;
		}
	};

	// Get performance level badge
	const getPerformanceLevel = (score: number) => {
		if (score >= 90) return { label: "Excellent", variant: "default" as const };
		if (score >= 80) return { label: "Good", variant: "secondary" as const };
		if (score >= 70) return { label: "Satisfactory", variant: "outline" as const };
		return { label: "Needs Improvement", variant: "destructive" as const };
	};

	const performanceLevel = getPerformanceLevel(averageScore);


	// Get attendance percentage
	const getAttendancePercentage = (attendance: any) => {
		return Math.round((attendance.present / attendance.total) * 100);
	};

	// Comprehensive analytics data for student
	const academicGrowthData = {
		academicGrowthTrends: [
			{ period: "2023-09", gpa: 3.45, averageGrade: 82.5, improvement: 5.2, trend: "up" as const },
			{ period: "2023-10", gpa: 3.48, averageGrade: 83.2, improvement: 6.1, trend: "up" as const },
			{ period: "2023-11", gpa: 3.52, averageGrade: 84.1, improvement: 7.2, trend: "up" as const },
			{ period: "2023-12", gpa: 3.55, averageGrade: 84.8, improvement: 7.8, trend: "up" as const },
			{ period: "2024-01", gpa: 3.58, averageGrade: 85.2, improvement: 8.1, trend: "up" as const },
			{ period: "2024-02", gpa: 3.61, averageGrade: 85.8, improvement: 8.5, trend: "up" as const },
			{ period: "2024-03", gpa: 3.63, averageGrade: 86.3, improvement: 9.0, trend: "up" as const },
			{ period: "2024-04", gpa: 3.65, averageGrade: 86.9, improvement: 9.3, trend: "up" as const },
			{ period: "2024-05", gpa: 3.67, averageGrade: 87.5, improvement: 9.6, trend: "up" as const },
			{ period: "2024-06", gpa: 3.68, averageGrade: 88.1, improvement: 9.8, trend: "up" as const },
			{ period: "2024-07", gpa: 3.69, averageGrade: 88.5, improvement: 10.0, trend: "up" as const },
			{ period: "2024-08", gpa: 3.72, averageGrade: 89.2, improvement: 10.2, trend: "up" as const },
		],
		gradeTrendsBySubject: student.performanceData.map(pd => ({
			subject: pd.category,
			trends: [
				{ period: "2023-09", grade: pd.score - 5 },
				{ period: "2023-12", grade: pd.score - 2 },
				{ period: "2024-03", grade: pd.score },
				{ period: "2024-08", grade: pd.score + (pd.trend === "up" ? 2 : pd.trend === "down" ? -2 : 0) },
			],
		})),
		classPerformanceBreakdown: student.classes.map(cls => ({
			classId: cls.id,
			className: cls.name,
			subject: cls.name.split(" ")[0],
			averageGrade: getAttendancePercentage(cls.attendance) > 90 ? 88.5 : 82.3,
			gradeTrend: [82.1, 84.3, 85.2, 88.5],
			attendanceRate: getAttendancePercentage(cls.attendance),
			studentGrowth: 8.5,
			currentGrade: cls.grade || "B+",
		})),
		attendanceCorrelation: 0.89,
		interventionHistory: [
			{
				date: "2024-06-15",
				type: "Academic Support",
				effectiveness: 85,
				description: "One-on-one tutoring sessions for World History",
			},
			{
				date: "2024-03-20",
				type: "Study Skills Workshop",
				effectiveness: 78,
				description: "Time management and study techniques",
			},
		],
	};

	const comprehensivePerformanceData = {
		overallPerformanceScore: averageScore,
		performanceBreakdown: {
			academics: averageScore,
			behavior: 93,
			attendance: Math.round(student.classes.reduce((sum, cls) => sum + getAttendancePercentage(cls.attendance), 0) / student.classes.length),
			engagement: 88,
		},
		keyMetrics: {
			gpa: student.overallGPA,
			attendance: Math.round(student.classes.reduce((sum, cls) => sum + getAttendancePercentage(cls.attendance), 0) / student.classes.length),
			engagement: 88,
			growthRate: 10.2,
		},
		benchmarking: {
			gradeAverage: 3.45,
			schoolAverage: 3.40,
			districtAverage: 3.35,
			percentile: 85,
		},
		predictiveIndicators: {
			projectedGPA: 3.78,
			graduationReadiness: 92,
			collegeReadiness: 88,
			timeframe: "6 months",
			confidence: "high",
			onTrack: true,
		},
		actionableInsights: {
			strengths: [
				{
					area: "Technology & Computer Science",
					evidence: "95% score, highest in class",
					impact: "Strong analytical and problem-solving skills",
				},
				{
					area: "Science Performance",
					evidence: "92% score with consistent improvement",
					impact: "Excellent understanding of scientific concepts",
				},
			],
			improvementAreas: [
				{
					area: "Social Studies",
					current: 78,
					target: 85,
					recommendation: "Increase reading time and practice essay writing",
					expectedImpact: "+7% improvement in 3 months",
				},
			],
			recommendations: [
				{
					title: "Enhanced Social Studies Support",
					priority: "Medium",
					rationale: "Current score below grade average, needs targeted intervention",
					expectedImpact: "Improve to 85% within one semester",
				},
			],
		},
	};

	const behavioralAnalyticsData = {
		attendanceTrends: [
			{ period: "2023-09", present: 45, absent: 2, tardy: 1, attendanceRate: 94.2 },
			{ period: "2023-10", present: 46, absent: 1, tardy: 1, attendanceRate: 95.8 },
			{ period: "2023-11", present: 47, absent: 1, tardy: 0, attendanceRate: 97.9 },
			{ period: "2023-12", present: 45, absent: 2, tardy: 1, attendanceRate: 94.2 },
			{ period: "2024-01", present: 46, absent: 1, tardy: 1, attendanceRate: 95.8 },
			{ period: "2024-02", present: 47, absent: 1, tardy: 0, attendanceRate: 97.9 },
			{ period: "2024-03", present: 48, absent: 0, tardy: 0, attendanceRate: 100 },
			{ period: "2024-04", present: 47, absent: 1, tardy: 0, attendanceRate: 97.9 },
			{ period: "2024-05", present: 48, absent: 0, tardy: 0, attendanceRate: 100 },
			{ period: "2024-06", present: 47, absent: 1, tardy: 0, attendanceRate: 97.9 },
			{ period: "2024-07", present: 48, absent: 0, tardy: 0, attendanceRate: 100 },
			{ period: "2024-08", present: 48, absent: 0, tardy: 0, attendanceRate: 100 },
		],
		behavioralTrends: [
			{ period: "2023-09", positiveBehaviors: 12, incidents: 0, improvement: 5 },
			{ period: "2023-10", positiveBehaviors: 14, incidents: 0, improvement: 7 },
			{ period: "2023-11", positiveBehaviors: 15, incidents: 0, improvement: 8 },
			{ period: "2023-12", positiveBehaviors: 16, incidents: 0, improvement: 9 },
			{ period: "2024-01", positiveBehaviors: 17, incidents: 0, improvement: 10 },
			{ period: "2024-02", positiveBehaviors: 18, incidents: 0, improvement: 11 },
			{ period: "2024-03", positiveBehaviors: 19, incidents: 0, improvement: 12 },
			{ period: "2024-04", positiveBehaviors: 20, incidents: 0, improvement: 13 },
			{ period: "2024-05", positiveBehaviors: 21, incidents: 0, improvement: 14 },
			{ period: "2024-06", positiveBehaviors: 22, incidents: 0, improvement: 15 },
			{ period: "2024-07", positiveBehaviors: 23, incidents: 0, improvement: 16 },
			{ period: "2024-08", positiveBehaviors: 24, incidents: 0, improvement: 17 },
		],
		riskAssessment: {
			riskLevel: "low" as const,
			factors: [
				{
					factor: "Academic Performance",
					severity: "low" as const,
					description: "GPA above grade average, consistent improvement",
				},
				{
					factor: "Attendance",
					severity: "low" as const,
					description: "Excellent attendance record, minimal absences",
				},
			],
			overallRisk: 15,
		},
		interventionHistory: [
			{
				date: "2024-06-15",
				type: "Academic Support",
				effectiveness: 85,
				description: "One-on-one tutoring sessions for World History",
				outcome: "Improved from 75% to 78% in Social Studies",
			},
			{
				date: "2024-03-20",
				type: "Study Skills Workshop",
				effectiveness: 78,
				description: "Time management and study techniques",
				outcome: "Better organization and time management",
			},
		],
		engagementMetrics: {
			participation: 88,
			collaboration: 91,
			leadership: 84,
			overall: 88,
		},
	};

	const subjectPerformanceData = student.performanceData.map(pd => ({
		subject: pd.category,
		currentScore: pd.score,
		averageScore: pd.score + (pd.trend === "up" ? -5 : pd.trend === "down" ? 5 : 0),
		trend: (pd.trend || "stable") as "up" | "down" | "stable",
	}));

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div className="flex items-center gap-4">
						{/* Student Avatar */}
						<div className="relative">
							<Avatar className="h-16 w-16 ring-4 ring-primary/20">
								<AvatarImage 
									src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${student.firstName}-${student.lastName}`} 
									alt={`${student.firstName} ${student.lastName}`}
								/>
								<AvatarFallback className="text-lg font-bold bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
									{student.firstName[0]}{student.lastName[0]}
								</AvatarFallback>
							</Avatar>
							<div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-success border-2 border-background"></div>
						</div>
						<div>
							<h1 className="text-3xl font-bold tracking-tight">
								{student.firstName} {student.lastName}
							</h1>
							<p className="text-muted-foreground">
								Student ID: {student.studentId} • {student.grade} • {student.academicYear}
							</p>
						</div>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Badge className={`${performanceLevel.variant} text-sm px-3 py-1`}>
						{performanceLevel.label}
					</Badge>
					<StudentProfileActions studentId={studentId} />
				</div>
			</div>

			{/* Professional Compact Student Overview Cards */}
			<div className="grid gap-2 md:grid-cols-4">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Overall GPA</p>
								<p className="text-lg font-semibold text-primary">
									{student.overallGPA.toFixed(2)}
								</p>
								<p className="text-xs text-muted-foreground/70">{student.grade} Student</p>
							</div>
							<GraduationCap className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Average Score</p>
								<p className="text-lg font-semibold text-foreground">{averageScore}%</p>
								<p className="text-xs text-muted-foreground/70">{student.performanceData.length} categories</p>
							</div>
							<Activity className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Classes Enrolled</p>
								<p className="text-lg font-semibold text-foreground">{student.classes.length}</p>
								<p className="text-xs text-muted-foreground/70">{student.classes.reduce((sum, cls) => sum + cls.credits, 0)} credits</p>
							</div>
							<BookOpen className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-3">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Attendance Rate</p>
								<p className="text-lg font-semibold text-foreground">
									{Math.round(
										student.classes.reduce((sum, cls) => sum + getAttendancePercentage(cls.attendance), 0) /
											student.classes.length,
									)}%
								</p>
								<p className="text-xs text-muted-foreground/70">Overall attendance</p>
							</div>
							<Calendar className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Row 1: Academic Growth Trends & Subject Performance */}
			<div className="grid gap-6 lg:grid-cols-2">
				<AcademicGrowthAnalytics data={academicGrowthData} />
				<SubjectPerformanceComparisonChart data={subjectPerformanceData} />
			</div>

			{/* Row 2: Comprehensive Performance Dashboard */}
			<ComprehensiveStudentPerformance data={comprehensivePerformanceData} />

			{/* Row 3: Behavioral Analytics & Class Performance */}
			<div className="grid gap-6 lg:grid-cols-2">
				<BehavioralAnalytics data={behavioralAnalyticsData} />
				<Card className="bg-card border-border shadow-md">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<BookOpen className="h-5 w-5 text-primary" />
							Academic Classes
						</CardTitle>
						<CardDescription className="text-sm">
							Current enrollment and performance in each subject
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{student.classes.map((cls) => (
								<div
									key={cls.id}
									className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card/80 transition-all duration-200 hover:shadow-md"
								>
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<h4 className="font-semibold text-sm">{cls.name}</h4>
											<Badge variant="outline" className="text-xs">
												{cls.credits} credit{cls.credits !== 1 ? "s" : ""}
											</Badge>
										</div>
										<p className="text-xs text-muted-foreground">
											{cls.teacher} • {cls.room}
										</p>
										<p className="text-xs text-muted-foreground">{cls.schedule}</p>
									</div>
									<div className="text-right space-y-2">
										{cls.grade && (
											<Badge 
												variant={
													cls.grade.startsWith("A") ? "default" : 
													cls.grade.startsWith("B") ? "secondary" : 
													cls.grade.startsWith("C") ? "outline" : "destructive"
												}
												className="text-sm font-semibold"
											>
												{cls.grade}
											</Badge>
										)}
										<div className="flex items-center gap-1">
											<Calendar className="h-3 w-3 text-muted-foreground" />
											<span className="text-xs text-muted-foreground">
												{getAttendancePercentage(cls.attendance)}%
											</span>
										</div>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Contact & Medical Information - Compact Side-by-Side Cards */}
			<div className="grid gap-6 md:grid-cols-2">
				{/* Contact Information Card */}
				<Card className="bg-card border-border shadow-lg">
					<CardHeader className="pb-4">
						<CardTitle className="flex items-center gap-2 text-lg">
							<Users className="h-5 w-5 text-primary" />
							Contact Information
						</CardTitle>
						<CardDescription>
							Primary contacts and address details
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Student Address */}
						<div className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/30">
							<MapPin className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
							<div>
								<p className="text-sm font-semibold text-foreground">Address</p>
								<p className="text-sm text-muted-foreground mt-1">
									{student.address.street}<br />
									{student.address.city}, {student.address.state} {student.address.zipCode}
								</p>
							</div>
						</div>

						{/* Primary Contacts */}
						{student.contacts.map((contact, index) => (
							<div key={index} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/30">
								<Users className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
								<div className="space-y-2 flex-1">
									<div>
										<p className="text-sm font-semibold text-foreground">{contact.name}</p>
										<p className="text-sm text-muted-foreground">{contact.relationship}</p>
									</div>
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<Phone className="h-3 w-3 text-muted-foreground" />
											<span className="text-xs text-muted-foreground">{contact.phone}</span>
										</div>
										{contact.email && (
											<div className="flex items-center gap-2">
												<Mail className="h-3 w-3 text-muted-foreground" />
												<span className="text-xs text-muted-foreground">{contact.email}</span>
											</div>
										)}
									</div>
								</div>
							</div>
						))}
					</CardContent>
				</Card>

				{/* Medical Information Card */}
				<Card className="bg-card border-border shadow-lg">
					<CardHeader className="pb-4">
						<CardTitle className="flex items-center gap-2 text-lg">
							<Activity className="h-5 w-5 text-primary" />
							Medical Information
						</CardTitle>
						<CardDescription>
							Health details and emergency contacts
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Blood Type */}
						{student.medical.bloodType && (
							<div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30">
								<div className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full bg-primary"></div>
									<span className="text-sm font-medium text-foreground">Blood Type</span>
								</div>
								<Badge variant="outline" className="text-xs font-semibold">
									{student.medical.bloodType}
								</Badge>
							</div>
						)}

						{/* Allergies */}
						{student.medical.allergies && student.medical.allergies.length > 0 && (
							<div className="p-3 rounded-lg border border-border/50 bg-muted/30">
								<div className="flex items-center gap-2 mb-2">
									<div className="h-2 w-2 rounded-full bg-warning"></div>
									<span className="text-sm font-medium text-foreground">Allergies</span>
								</div>
								<div className="flex flex-wrap gap-1">
									{student.medical.allergies.map((allergy, idx) => (
										<Badge key={idx} variant="destructive" className="text-xs">
											{allergy}
										</Badge>
									))}
								</div>
							</div>
						)}

						{/* Medical Conditions */}
						{student.medical.conditions && student.medical.conditions.length > 0 && (
							<div className="p-3 rounded-lg border border-border/50 bg-muted/30">
								<div className="flex items-center gap-2 mb-2">
									<div className="h-2 w-2 rounded-full bg-secondary"></div>
									<span className="text-sm font-medium text-foreground">Medical Conditions</span>
								</div>
								<div className="flex flex-wrap gap-1">
									{student.medical.conditions.map((condition, idx) => (
										<Badge key={idx} variant="secondary" className="text-xs">
											{condition}
										</Badge>
									))}
								</div>
							</div>
						)}

						{/* Emergency Contact */}
						<div className="p-3 rounded-lg border border-border/50 bg-muted/30">
							<div className="flex items-center gap-2 mb-2">
								<div className="h-2 w-2 rounded-full bg-error"></div>
								<span className="text-sm font-medium text-foreground">Emergency Contact</span>
							</div>
							<p className="text-sm text-muted-foreground">{student.medical.emergencyContact}</p>
						</div>

						{/* Insurance Provider */}
						{student.medical.insuranceProvider && (
							<div className="p-3 rounded-lg border border-border/50 bg-muted/30">
								<div className="flex items-center gap-2 mb-2">
									<div className="h-2 w-2 rounded-full bg-success"></div>
									<span className="text-sm font-medium text-foreground">Insurance Provider</span>
								</div>
								<p className="text-sm text-muted-foreground">{student.medical.insuranceProvider}</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Extracurricular Activities & Awards - Compact Design */}
			<div className="grid gap-4 md:grid-cols-2">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardHeader className="pb-3">
						<CardTitle className="flex items-center gap-2 text-lg">
							<Activity className="h-5 w-5 text-primary" />
							Extracurricular Activities
						</CardTitle>
						<CardDescription className="text-sm">
							Student involvement beyond academics
						</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						{student.extracurriculars && student.extracurriculars.length > 0 ? (
							<div className="flex flex-wrap gap-2">
								{student.extracurriculars.map((activity, index) => (
									<Badge key={index} variant="secondary" className="text-xs">
										{activity}
									</Badge>
								))}
							</div>
						) : (
							<div className="text-center py-4">
								<Activity className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
								<p className="text-xs text-muted-foreground">No activities recorded</p>
							</div>
						)}
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardHeader className="pb-3">
						<CardTitle className="flex items-center gap-2 text-lg">
							<Award className="h-5 w-5 text-primary" />
							Awards & Achievements
						</CardTitle>
						<CardDescription className="text-sm">
							Recognition and accomplishments
						</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						{student.awards && student.awards.length > 0 ? (
							<div className="space-y-2">
								{student.awards.map((award, index) => (
									<div key={index} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/50">
										<Award className="h-3 w-3 text-muted-foreground flex-shrink-0" />
										<span className="text-xs font-medium text-foreground">{award}</span>
									</div>
								))}
							</div>
						) : (
							<div className="text-center py-4">
								<Award className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
								<p className="text-xs text-muted-foreground">No awards recorded</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

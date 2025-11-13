/**
 * EdForge EMIS - School People Page
 * This is a Server Component for security and performance.
 * Implements SABER framework: well-selected teachers, proper assignment, systematic incentives, results-oriented management
 */
export const dynamic = 'force-dynamic'
import { getCurrentUser } from "@/lib/auth";
import { PeopleDashboard } from "./_components/people-dashboard";
import type { 
	PeopleDashboardData,
	PeopleStats,
	StaffProfileSummary,
} from "@/lib/schemas";

interface PeoplePageProps {
	searchParams: Promise<{
		search?: string;
		department?: string;
		role?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
	}>;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
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

	// Hardcoded dummy data for people dashboard (will be replaced with API call later)
	// Data structure matches PeopleDashboardData schema from @/lib/schemas
	const peopleData: PeopleDashboardData = {
		stats: {
			totalStaff: 156,
			activeTeachers: 98,
			studentToTeacherRatio: 18.2,
			averageEffectiveness: 87.5,
			recentHires: 12,
			retentionRate: 94.2,
			professionalDevelopmentCompletion: 82.1,
		},
		staff: [
			{
				staffId: "staff-001",
				employeeNumber: "EMP-2020-001",
				firstName: "Sarah",
				lastName: "Johnson",
				middleName: "Marie",
				email: "sarah.johnson@school.edu",
				phone: "+1-555-0101",
				department: "Mathematics",
				primaryRole: "Teacher",
				roles: ["Teacher", "Department Head"],
				status: "active",
				hireDate: "2020-08-15",
				classesAssigned: 5,
				studentCount: 142,
				effectivenessScore: 92.5,
				yearsOfService: 4,
				attendanceRate: 98.5,
			},
			{
				staffId: "staff-009",
				employeeNumber: "EMP-2023-078",
				firstName: "Patricia",
				lastName: "Garcia",
				email: "patricia.garcia@school.edu",
				phone: "+1-555-0109",
				department: "English",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2023-08-20",
				classesAssigned: 4,
				studentCount: 112,
				effectivenessScore: 87.3,
				yearsOfService: 1,
				attendanceRate: 96.2,
			},
			{
				staffId: "staff-010",
				employeeNumber: "EMP-2021-045",
				firstName: "Christopher",
				lastName: "Lee",
				email: "christopher.lee@school.edu",
				phone: "+1-555-0110",
				department: "Science",
				primaryRole: "Teacher",
				roles: ["Teacher", "Lab Coordinator"],
				status: "active",
				hireDate: "2021-09-01",
				classesAssigned: 5,
				studentCount: 138,
				effectivenessScore: 89.7,
				yearsOfService: 3,
				attendanceRate: 97.8,
			},
			{
				staffId: "staff-011",
				employeeNumber: "EMP-2019-023",
				firstName: "Amanda",
				lastName: "White",
				email: "amanda.white@school.edu",
				phone: "+1-555-0111",
				department: "History",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2019-08-15",
				classesAssigned: 6,
				studentCount: 168,
				effectivenessScore: 91.2,
				yearsOfService: 5,
				attendanceRate: 98.3,
			},
			{
				staffId: "staff-012",
				employeeNumber: "EMP-2022-091",
				firstName: "Daniel",
				lastName: "Harris",
				email: "daniel.harris@school.edu",
				phone: "+1-555-0112",
				department: "Physical Education",
				primaryRole: "Teacher",
				roles: ["Teacher", "Athletic Director"],
				status: "active",
				hireDate: "2022-08-10",
				classesAssigned: 4,
				studentCount: 124,
				effectivenessScore: 88.9,
				yearsOfService: 2,
				attendanceRate: 97.1,
			},
			{
				staffId: "staff-013",
				employeeNumber: "EMP-2020-067",
				firstName: "Jessica",
				lastName: "Martinez",
				email: "jessica.martinez@school.edu",
				phone: "+1-555-0113",
				department: "Arts",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2020-09-05",
				classesAssigned: 5,
				studentCount: 145,
				effectivenessScore: 90.5,
				yearsOfService: 4,
				attendanceRate: 98.7,
			},
			{
				staffId: "staff-014",
				employeeNumber: "EMP-2018-034",
				firstName: "Kevin",
				lastName: "Taylor",
				email: "kevin.taylor@school.edu",
				phone: "+1-555-0114",
				department: "Mathematics",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2018-08-20",
				classesAssigned: 5,
				studentCount: 152,
				effectivenessScore: 93.1,
				yearsOfService: 6,
				attendanceRate: 99.2,
			},
			{
				staffId: "staff-015",
				employeeNumber: "EMP-2021-089",
				firstName: "Nicole",
				lastName: "Clark",
				email: "nicole.clark@school.edu",
				phone: "+1-555-0115",
				department: "Counseling",
				primaryRole: "Counselor",
				roles: ["Counselor"],
				status: "active",
				hireDate: "2021-09-01",
				classesAssigned: 0,
				studentCount: 0,
				effectivenessScore: 0,
				yearsOfService: 3,
				attendanceRate: 98.9,
			},
			{
				staffId: "staff-002",
				employeeNumber: "EMP-2019-045",
				firstName: "Michael",
				lastName: "Chen",
				email: "michael.chen@school.edu",
				phone: "+1-555-0102",
				department: "Science",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2019-09-01",
				classesAssigned: 4,
				studentCount: 118,
				effectivenessScore: 89.3,
				yearsOfService: 5,
				attendanceRate: 97.2,
			},
			{
				staffId: "staff-003",
				employeeNumber: "EMP-2021-023",
				firstName: "Emily",
				lastName: "Rodriguez",
				email: "emily.rodriguez@school.edu",
				phone: "+1-555-0103",
				department: "English",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2021-08-20",
				classesAssigned: 6,
				studentCount: 156,
				effectivenessScore: 91.8,
				yearsOfService: 3,
				attendanceRate: 99.1,
			},
			{
				staffId: "staff-004",
				employeeNumber: "EMP-2018-012",
				firstName: "David",
				lastName: "Williams",
				email: "david.williams@school.edu",
				phone: "+1-555-0104",
				department: "History",
				primaryRole: "Teacher",
				roles: ["Teacher", "Grade Coordinator"],
				status: "active",
				hireDate: "2018-09-05",
				classesAssigned: 5,
				studentCount: 135,
				effectivenessScore: 88.7,
				yearsOfService: 6,
				attendanceRate: 96.8,
			},
			{
				staffId: "staff-005",
				employeeNumber: "EMP-2022-067",
				firstName: "Jennifer",
				lastName: "Martinez",
				email: "jennifer.martinez@school.edu",
				phone: "+1-555-0105",
				department: "Mathematics",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2022-08-10",
				classesAssigned: 4,
				studentCount: 108,
				effectivenessScore: 85.2,
				yearsOfService: 2,
				attendanceRate: 95.5,
			},
			{
				staffId: "staff-006",
				employeeNumber: "EMP-2020-034",
				firstName: "Robert",
				lastName: "Anderson",
				email: "robert.anderson@school.edu",
				phone: "+1-555-0106",
				department: "Science",
				primaryRole: "Teacher",
				roles: ["Teacher"],
				status: "active",
				hireDate: "2020-09-15",
				classesAssigned: 5,
				studentCount: 145,
				effectivenessScore: 90.1,
				yearsOfService: 4,
				attendanceRate: 98.9,
			},
			{
				staffId: "staff-007",
				employeeNumber: "EMP-2017-089",
				firstName: "Lisa",
				lastName: "Thompson",
				email: "lisa.thompson@school.edu",
				phone: "+1-555-0107",
				department: "Administration",
				primaryRole: "Principal",
				roles: ["Principal"],
				status: "active",
				hireDate: "2017-07-01",
				classesAssigned: 0,
				studentCount: 0,
				effectivenessScore: 95.0,
				yearsOfService: 7,
				attendanceRate: 99.5,
			},
			{
				staffId: "staff-008",
				employeeNumber: "EMP-2019-056",
				firstName: "James",
				lastName: "Brown",
				email: "james.brown@school.edu",
				phone: "+1-555-0108",
				department: "IT",
				primaryRole: "Support Staff",
				roles: ["Support Staff"],
				status: "active",
				hireDate: "2019-10-01",
				classesAssigned: 0,
				studentCount: 0,
				effectivenessScore: 0,
				yearsOfService: 5,
				attendanceRate: 97.8,
			},
		],
		departmentDistribution: [
			{ department: "Mathematics", count: 24, percentage: 15.4 },
			{ department: "Science", count: 22, percentage: 14.1 },
			{ department: "English", count: 20, percentage: 12.8 },
			{ department: "History", count: 18, percentage: 11.5 },
			{ department: "Administration", count: 12, percentage: 7.7 },
			{ department: "Support Staff", count: 28, percentage: 17.9 },
			{ department: "Physical Education", count: 10, percentage: 6.4 },
			{ department: "Arts", count: 12, percentage: 7.7 },
			{ department: "IT", count: 10, percentage: 6.4 },
		],
		roleDistribution: [
			{ role: "Teacher", count: 98, percentage: 62.8 },
			{ role: "Administrator", count: 12, percentage: 7.7 },
			{ role: "Support Staff", count: 28, percentage: 17.9 },
			{ role: "Counselor", count: 10, percentage: 6.4 },
			{ role: "Librarian", count: 4, percentage: 2.6 },
			{ role: "Nurse", count: 2, percentage: 1.3 },
			{ role: "Security", count: 2, percentage: 1.3 },
		],
		roleDistributionWithOutcomes: [
			{
				role: "Teacher",
				count: 98,
				percentage: 62.8,
				outcomeMetrics: {
					averageStudentGrade: 87.5, // High student outcomes - primary teaching role
					passRate: 94.2, // Excellent pass rate
					improvementRate: 8.3, // Strong improvement rate
					studentEngagementScore: 89.7, // High engagement
					interventionSuccessRate: 76.5, // Good intervention success
					totalStudentsImpacted: 2847, // All students impacted by teachers
				},
			},
			{
				role: "Administrator",
				count: 12,
				percentage: 7.7,
				outcomeMetrics: {
					averageStudentGrade: 82.1, // Moderate outcomes - indirect impact
					passRate: 88.5, // Good pass rate
					improvementRate: 5.2, // Moderate improvement
					studentEngagementScore: 85.3, // Good engagement
					interventionSuccessRate: 68.2, // Moderate intervention success
					totalStudentsImpacted: 2847, // All students (school-wide impact)
				},
			},
			{
				role: "Support Staff",
				count: 28,
				percentage: 17.9,
				outcomeMetrics: {
					// No direct teaching - indirect impact on outcomes
					studentEngagementScore: 78.5, // Moderate engagement support
					interventionSuccessRate: 62.3, // Support role interventions
					totalStudentsImpacted: 1423, // Estimated indirect impact
				},
			},
			{
				role: "Counselor",
				count: 10,
				percentage: 6.4,
				outcomeMetrics: {
					// High engagement focus - not direct academic outcomes
					studentEngagementScore: 92.3, // Excellent engagement
					interventionSuccessRate: 78.5, // Strong intervention success
					totalStudentsImpacted: 568, // Students receiving counseling
				},
			},
			{
				role: "Librarian",
				count: 4,
				percentage: 2.6,
				outcomeMetrics: {
					averageStudentGrade: 79.8, // Moderate outcomes - resource support
					passRate: 85.1, // Good pass rate
					improvementRate: 4.1, // Moderate improvement
					studentEngagementScore: 81.2, // Good engagement
					totalStudentsImpacted: 1139, // Students using library resources
				},
			},
			{
				role: "Nurse",
				count: 2,
				percentage: 1.3,
				outcomeMetrics: {
					// Health services - indirect impact on attendance/engagement
					studentEngagementScore: 75.2, // Health-related engagement
					interventionSuccessRate: 85.7, // High success in health interventions
					totalStudentsImpacted: 2847, // All students (health services)
				},
			},
			{
				role: "Security",
				count: 2,
				percentage: 1.3,
				outcomeMetrics: {
					// Safety services - indirect impact on learning environment
					studentEngagementScore: 72.8, // Safety-related engagement
					totalStudentsImpacted: 2847, // All students (safety services)
				},
			},
		],
		ratioTrends: [
			{ month: "2024-01", ratio: 19.2, studentCount: 2847, teacherCount: 148 },
			{ month: "2024-02", ratio: 18.8, studentCount: 2856, teacherCount: 152 },
			{ month: "2024-03", ratio: 18.5, studentCount: 2862, teacherCount: 155 },
			{ month: "2024-04", ratio: 18.3, studentCount: 2865, teacherCount: 156 },
			{ month: "2024-05", ratio: 18.2, studentCount: 2847, teacherCount: 156 },
			{ month: "2024-06", ratio: 18.1, studentCount: 2844, teacherCount: 157 },
			{ month: "2024-07", ratio: 18.2, studentCount: 2847, teacherCount: 156 },
			{ month: "2024-08", ratio: 18.2, studentCount: 2847, teacherCount: 156 },
		],
		comprehensiveRatioTrends: [
			// 18 months of comprehensive data showing realistic trends, seasonal patterns, and outcome correlations
			// Aligned with comprehensiveRatioTrendSchema - SABER framework metrics
			{
				month: "2023-03",
				studentToTeacherRatio: 20.1,
				teacherToStudentRatio: 0.0498,
				studentCount: 2812,
				teacherCount: 140,
				averageStudentGrade: 81.2,
				passRate: 88.1,
				status: "concerning",
				trend: "declining", // Spring enrollment increase without corresponding hiring
			},
			{
				month: "2023-04",
				studentToTeacherRatio: 20.3,
				teacherToStudentRatio: 0.0493,
				studentCount: 2825,
				teacherCount: 139,
				averageStudentGrade: 81.0,
				passRate: 87.9,
				status: "concerning",
				trend: "declining", // Continued enrollment growth
			},
			{
				month: "2023-05",
				studentToTeacherRatio: 20.5,
				teacherToStudentRatio: 0.0488,
				studentCount: 2838,
				teacherCount: 138,
				averageStudentGrade: 80.8,
				passRate: 87.6,
				status: "concerning",
				trend: "declining", // End of year enrollment peak
			},
			{
				month: "2023-06",
				studentToTeacherRatio: 20.2,
				teacherToStudentRatio: 0.0495,
				studentCount: 2820,
				teacherCount: 140,
				averageStudentGrade: 81.1,
				passRate: 88.0,
				status: "concerning",
				trend: "improving", // Summer enrollment dip, slight improvement
			},
			{
				month: "2023-07",
				studentToTeacherRatio: 19.9,
				teacherToStudentRatio: 0.0503,
				studentCount: 2805,
				teacherCount: 141,
				averageStudentGrade: 81.5,
				passRate: 88.4,
				status: "concerning",
				trend: "improving", // Strategic hiring begins
			},
			{
				month: "2023-08",
				studentToTeacherRatio: 19.7,
				teacherToStudentRatio: 0.0508,
				studentCount: 2810,
				teacherCount: 143,
				averageStudentGrade: 81.8,
				passRate: 88.7,
				status: "concerning",
				trend: "improving", // Pre-fall hiring initiative
			},
			{
				month: "2023-09",
				studentToTeacherRatio: 19.8,
				teacherToStudentRatio: 0.0505,
				studentCount: 2847,
				teacherCount: 144,
				averageStudentGrade: 82.3,
				passRate: 89.2,
				status: "concerning",
				trend: "stable", // Fall enrollment surge, ratio stable due to hiring
			},
			{
				month: "2023-10",
				studentToTeacherRatio: 19.6,
				teacherToStudentRatio: 0.0510,
				studentCount: 2851,
				teacherCount: 145,
				averageStudentGrade: 82.8,
				passRate: 89.8,
				status: "concerning",
				trend: "improving", // Continued strategic hiring
			},
			{
				month: "2023-11",
				studentToTeacherRatio: 19.4,
				teacherToStudentRatio: 0.0515,
				studentCount: 2849,
				teacherCount: 147,
				averageStudentGrade: 83.2,
				passRate: 90.1,
				status: "concerning",
				trend: "improving", // Mid-year hiring push
			},
			{
				month: "2023-12",
				studentToTeacherRatio: 19.3,
				teacherToStudentRatio: 0.0518,
				studentCount: 2845,
				teacherCount: 147,
				averageStudentGrade: 83.5,
				passRate: 90.5,
				status: "concerning",
				trend: "improving", // End of year improvement
			},
			{
				month: "2024-01",
				studentToTeacherRatio: 19.2,
				teacherToStudentRatio: 0.0521,
				studentCount: 2847,
				teacherCount: 148,
				averageStudentGrade: 84.1,
				passRate: 91.2,
				status: "concerning",
				trend: "improving", // New year hiring initiative
			},
			{
				month: "2024-02",
				studentToTeacherRatio: 18.8,
				teacherToStudentRatio: 0.0532,
				studentCount: 2856,
				teacherCount: 152,
				averageStudentGrade: 84.8,
				passRate: 91.8,
				status: "acceptable",
				trend: "improving", // Major hiring push - crosses into acceptable range
			},
			{
				month: "2024-03",
				studentToTeacherRatio: 18.5,
				teacherToStudentRatio: 0.0541,
				studentCount: 2862,
				teacherCount: 155,
				averageStudentGrade: 85.3,
				passRate: 92.4,
				status: "acceptable",
				trend: "improving", // Continued improvement
			},
			{
				month: "2024-04",
				studentToTeacherRatio: 18.3,
				teacherToStudentRatio: 0.0546,
				studentCount: 2865,
				teacherCount: 156,
				averageStudentGrade: 85.9,
				passRate: 92.9,
				status: "acceptable",
				trend: "improving", // Spring enrollment managed with hiring
			},
			{
				month: "2024-05",
				studentToTeacherRatio: 18.2,
				teacherToStudentRatio: 0.0549,
				studentCount: 2847,
				teacherCount: 156,
				averageStudentGrade: 86.2,
				passRate: 93.1,
				status: "acceptable",
				trend: "stable", // Stable ratio, outcomes continue improving
			},
			{
				month: "2024-06",
				studentToTeacherRatio: 18.1,
				teacherToStudentRatio: 0.0552,
				studentCount: 2844,
				teacherCount: 157,
				averageStudentGrade: 86.5,
				passRate: 93.5,
				status: "acceptable",
				trend: "improving", // Additional hiring
			},
			{
				month: "2024-07",
				studentToTeacherRatio: 18.2,
				teacherToStudentRatio: 0.0549,
				studentCount: 2847,
				teacherCount: 156,
				averageStudentGrade: 86.8,
				passRate: 93.8,
				status: "acceptable",
				trend: "stable", // Summer stability
			},
			{
				month: "2024-08",
				studentToTeacherRatio: 18.2,
				teacherToStudentRatio: 0.0549,
				studentCount: 2847,
				teacherCount: 156,
				averageStudentGrade: 87.2,
				passRate: 94.1,
				status: "acceptable",
				trend: "improving", // Outcomes continue improving despite stable ratio (quality improvement)
			},
		],
		effectivenessDistribution: [
			{ range: "90-100", count: 32, percentage: 20.5 },
			{ range: "80-89", count: 45, percentage: 28.8 },
			{ range: "70-79", count: 18, percentage: 11.5 },
			{ range: "60-69", count: 3, percentage: 1.9 },
			{ range: "Below 60", count: 0, percentage: 0 },
		],
	};
    
	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<PeopleDashboard data={peopleData} />
		</div>
	);
}

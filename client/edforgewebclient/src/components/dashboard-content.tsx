/**
 * EdForge EMIS - Dashboard Content
 * 
 * Server component for dashboard content with server-side user data.
 * Handles role-specific dashboard rendering with secure server-side data.
 */

import type { User } from "@/types/rbac";
import { UserRole } from "@/types/rbac";

interface DashboardContentProps {
	user: User;
}

export function DashboardContent({ user }: DashboardContentProps) {

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			{/* Role-Specific Dashboard Content */}
			{user.role === UserRole.TENANT_ADMIN && <TenantAdminDashboard />}
			{user.role === UserRole.PRINCIPAL && <PrincipalDashboard />}
			{user.role === UserRole.TEACHER && <TeacherDashboard />}
			{user.role === UserRole.STUDENT && <StudentDashboard />}
			{user.role === UserRole.PARENT && <ParentDashboard />}
		</div>
	);
}

// Dashboard components remain the same but are now in a client component
import {
	Users,
	GraduationCap,
	BookOpen,
	Calendar,
	TrendingUp,
	Award,
	Clock,
	Mail,
	CheckCircle2,
	BarChart3,
	FileText,
} from "lucide-react";

// ============================================
// Tenant Admin Dashboard
// ============================================

function TenantAdminDashboard() {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					title="Total Students"
					value="2,847"
					change="+12.5%"
					icon={Users}
					trend="up"
				/>
				<MetricCard
					title="Total Teachers"
					value="142"
					change="+5.2%"
					icon={GraduationCap}
					trend="up"
				/>
				<MetricCard
					title="Active Classes"
					value="89"
					change="0%"
					icon={BookOpen}
					trend="neutral"
				/>
				<MetricCard
					title="Attendance Rate"
					value="94.3%"
					change="+2.1%"
					icon={CheckCircle2}
					trend="up"
				/>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div className="p-6 rounded-lg border border-border bg-card">
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-semibold">Recent Activities</h3>
						<BarChart3 className="h-5 w-5 text-muted-foreground" />
					</div>
					<div className="space-y-4">
						<ActivityItem
							title="New student enrolled"
							description="Emma Wilson joined Grade 10"
							time="5 minutes ago"
							icon={Users}
						/>
						<ActivityItem
							title="Teacher assigned"
							description="Dr. Smith assigned to Chemistry"
							time="1 hour ago"
							icon={GraduationCap}
						/>
						<ActivityItem
							title="Grade report generated"
							description="Q2 reports ready for review"
							time="2 hours ago"
							icon={FileText}
						/>
					</div>
				</div>

				<div className="p-6 rounded-lg border border-border bg-card">
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-semibold">Quick Actions</h3>
						<Clock className="h-5 w-5 text-muted-foreground" />
					</div>
					<div className="space-y-2">
						<QuickActionButton title="Add New Student" icon={Users} />
						<QuickActionButton title="Manage Users" icon={Users} />
						<QuickActionButton
							title="View Analytics"
							icon={BarChart3}
						/>
						<QuickActionButton
							title="Send Announcement"
							icon={Mail}
						/>
					</div>
				</div>
			</div>
		</>
	);
}

// ============================================
// Principal Dashboard
// ============================================

function PrincipalDashboard() {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					title="Students"
					value="2,847"
					change="+12.5%"
					icon={Users}
					trend="up"
				/>
				<MetricCard
					title="Teachers"
					value="142"
					change="+5.2%"
					icon={GraduationCap}
					trend="up"
				/>
				<MetricCard
					title="Avg. Performance"
					value="87.5%"
					change="+3.2%"
					icon={Award}
					trend="up"
				/>
				<MetricCard
					title="Attendance"
					value="94.3%"
					change="+2.1%"
					icon={Calendar}
					trend="up"
				/>
			</div>

			<div className="p-6 rounded-lg border border-border bg-card">
				<h3 className="text-lg font-semibold mb-4">
					Academic Overview
				</h3>
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<span className="text-sm text-muted-foreground">
							Student Performance
						</span>
						<span className="text-sm font-medium">Excellent</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-sm text-muted-foreground">
							Teacher Effectiveness
						</span>
						<span className="text-sm font-medium">Very Good</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-sm text-muted-foreground">
							Curriculum Completion
						</span>
						<span className="text-sm font-medium">78%</span>
					</div>
				</div>
			</div>
		</>
	);
}

// ============================================
// Teacher Dashboard
// ============================================

function TeacherDashboard() {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					title="My Classes"
					value="6"
					icon={BookOpen}
					trend="neutral"
				/>
				<MetricCard
					title="Total Students"
					value="142"
					icon={Users}
					trend="neutral"
				/>
				<MetricCard
					title="Pending Grades"
					value="28"
					icon={Award}
					trend="neutral"
				/>
				<MetricCard
					title="Today's Classes"
					value="4"
					icon={Calendar}
					trend="neutral"
				/>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div className="p-6 rounded-lg border border-border bg-card">
					<h3 className="text-lg font-semibold mb-4">
						Today's Schedule
					</h3>
					<div className="space-y-3">
						<ScheduleItem
							time="09:00 AM"
							class="Mathematics - Grade 11"
							room="Room 204"
						/>
						<ScheduleItem
							time="11:00 AM"
							class="Algebra - Grade 10"
							room="Room 205"
						/>
						<ScheduleItem
							time="02:00 PM"
							class="Geometry - Grade 9"
							room="Room 206"
						/>
					</div>
				</div>

				<div className="p-6 rounded-lg border border-border bg-card">
					<h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
					<div className="space-y-2">
						<QuickActionButton
							title="Take Attendance"
							icon={Calendar}
						/>
						<QuickActionButton title="Enter Grades" icon={Award} />
						<QuickActionButton
							title="View Student Records"
							icon={Users}
						/>
						<QuickActionButton
							title="Send Message"
							icon={Mail}
						/>
					</div>
				</div>
			</div>
		</>
	);
}

// ============================================
// Student Dashboard
// ============================================

function StudentDashboard() {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<MetricCard
					title="Current GPA"
					value="3.7"
					icon={Award}
					trend="neutral"
				/>
				<MetricCard
					title="Attendance"
					value="96%"
					icon={Calendar}
					trend="neutral"
				/>
				<MetricCard
					title="Enrolled Courses"
					value="8"
					icon={BookOpen}
					trend="neutral"
				/>
				<MetricCard
					title="Assignments Due"
					value="3"
					icon={Clock}
					trend="neutral"
				/>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div className="p-6 rounded-lg border border-border bg-card">
					<h3 className="text-lg font-semibold mb-4">Recent Grades</h3>
					<div className="space-y-3">
						<GradeItem subject="Mathematics" grade="A" score="92%" />
						<GradeItem subject="Physics" grade="B+" score="87%" />
						<GradeItem subject="English" grade="A-" score="90%" />
					</div>
				</div>

				<div className="p-6 rounded-lg border border-border bg-card">
					<h3 className="text-lg font-semibold mb-4">
						Upcoming Assignments
					</h3>
					<div className="space-y-3">
						<AssignmentItem
							title="Math Homework Ch. 5"
							due="Tomorrow"
							status="pending"
						/>
						<AssignmentItem
							title="Physics Lab Report"
							due="In 3 days"
							status="pending"
						/>
						<AssignmentItem
							title="English Essay"
							due="Next week"
							status="completed"
						/>
					</div>
				</div>
			</div>
		</>
	);
}

// ============================================
// Parent Dashboard
// ============================================

function ParentDashboard() {
	return (
		<>
			<div className="p-6 rounded-lg border border-border bg-card mb-6">
				<h3 className="text-lg font-semibold mb-4">My Children</h3>
				<div className="grid gap-4 md:grid-cols-2">
					<ChildCard name="Emily Williams" grade="Grade 9" gpa="3.8" />
					<ChildCard name="James Williams" grade="Grade 7" gpa="3.6" />
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div className="p-6 rounded-lg border border-border bg-card">
					<h3 className="text-lg font-semibold mb-4">
						Recent Updates
					</h3>
					<div className="space-y-4">
						<ActivityItem
							title="Grade Posted"
							description="Emily - Mathematics: A"
							time="2 hours ago"
							icon={Award}
						/>
						<ActivityItem
							title="Attendance Alert"
							description="James - Marked present"
							time="5 hours ago"
							icon={Calendar}
						/>
						<ActivityItem
							title="Assignment Due"
							description="Emily - English Essay tomorrow"
							time="1 day ago"
							icon={Clock}
						/>
					</div>
				</div>

				<div className="p-6 rounded-lg border border-border bg-card">
					<h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
					<div className="space-y-2">
						<QuickActionButton
							title="View Academic Progress"
							icon={TrendingUp}
						/>
						<QuickActionButton
							title="Check Attendance"
							icon={Calendar}
						/>
						<QuickActionButton
							title="Message Teachers"
							icon={Mail}
						/>
						<QuickActionButton
							title="View Announcements"
							icon={FileText}
						/>
					</div>
				</div>
			</div>
		</>
	);
}

// ============================================
// Shared UI Components
// ============================================

function MetricCard({
	title,
	value,
	change,
	icon: Icon,
	trend,
}: {
	title: string;
	value: string;
	change?: string;
	icon: React.ComponentType<{ className?: string }>;
	trend?: "up" | "down" | "neutral";
}) {
	return (
		<div className="p-6 rounded-lg border border-border bg-card hover:shadow-md transition-shadow">
			<div className="flex items-center justify-between mb-2">
				<p className="text-sm font-medium text-muted-foreground">{title}</p>
				<Icon className="h-5 w-5 text-muted-foreground" />
			</div>
			<div className="flex items-baseline gap-2">
				<p className="text-3xl font-bold">{value}</p>
				{change && (
					<p
						className={`text-sm ${
							trend === "up"
								? "text-success"
								: trend === "down"
									? "text-error"
									: "text-muted-foreground"
						}`}
					>
						{change}
					</p>
				)}
			</div>
		</div>
	);
}

function ActivityItem({
	title,
	description,
	time,
	icon: Icon,
}: {
	title: string;
	description: string;
	time: string;
	icon: React.ComponentType<{ className?: string }>;
}) {
	return (
		<div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
			<div className="p-2 rounded-lg bg-primary/10">
				<Icon className="h-4 w-4 text-primary" />
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium truncate">{title}</p>
				<p className="text-xs text-muted-foreground truncate">
					{description}
				</p>
				<p className="text-xs text-muted-foreground mt-1">{time}</p>
			</div>
		</div>
	);
}

function QuickActionButton({
	title,
	icon: Icon,
}: {
	title: string;
	icon: React.ComponentType<{ className?: string }>;
}) {
	return (
		<button
			type="button"
			className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
		>
			<Icon className="h-5 w-5 text-primary flex-shrink-0" />
			<span className="text-sm font-medium">{title}</span>
		</button>
	);
}

function ScheduleItem({
	time,
	class: className,
	room,
}: {
	time: string;
	class: string;
	room: string;
}) {
	return (
		<div className="flex items-center gap-3 p-3 rounded-lg border border-border">
			<div className="text-center min-w-[80px]">
				<p className="text-sm font-medium">{time}</p>
			</div>
			<div className="flex-1">
				<p className="text-sm font-medium">{className}</p>
				<p className="text-xs text-muted-foreground">{room}</p>
			</div>
		</div>
	);
}

function GradeItem({
	subject,
	grade,
	score,
}: {
	subject: string;
	grade: string;
	score: string;
}) {
	return (
		<div className="flex items-center justify-between p-3 rounded-lg border border-border">
			<span className="text-sm font-medium">{subject}</span>
			<div className="flex items-center gap-3">
				<span className="text-sm text-muted-foreground">{score}</span>
				<span className="text-sm font-bold text-primary">{grade}</span>
			</div>
		</div>
	);
}

function AssignmentItem({
	title,
	due,
	status,
}: {
	title: string;
	due: string;
	status: "pending" | "completed";
}) {
	return (
		<div className="flex items-center justify-between p-3 rounded-lg border border-border">
			<div className="flex-1">
				<p className="text-sm font-medium">{title}</p>
				<p className="text-xs text-muted-foreground">{due}</p>
			</div>
			{status === "completed" ? (
				<CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
			) : (
				<Clock className="h-5 w-5 text-warning flex-shrink-0" />
			)}
		</div>
	);
}

function ChildCard({
	name,
	grade,
	gpa,
}: {
	name: string;
	grade: string;
	gpa: string;
}) {
	return (
		<div className="p-4 rounded-lg border border-border hover:shadow-md transition-shadow">
			<div className="flex items-center gap-3 mb-3">
				<div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
					<Users className="h-6 w-6 text-primary" />
				</div>
				<div>
					<p className="font-semibold">{name}</p>
					<p className="text-sm text-muted-foreground">{grade}</p>
				</div>
			</div>
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">GPA</span>
				<span className="text-lg font-bold text-primary">{gpa}</span>
          </div>
        </div>
	);
}

"use client";

/**
 * EdForge EMIS - Classroom Details Content
 * 
 * Client component for displaying classroom details with interactive features.
 * Restored to match the original Google Classroom-style UI design.
 */

import * as React from "react";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getClassroomById, getEnrollmentsByClassroom, getClassroomAnalytics } from "@/data/mock-classrooms";
import { 
	Classroom, 
	StudentEnrollment, 
	ClassroomAnalytics,
	ClassroomPermission,
	hasClassroomPermission,
	getClassroomStatusColor,
	getEnrollmentPercentage,
	formatSchedule,
	getGradeColor
} from "@/types/classroom";
import { UserRole } from "@/types/rbac";
import {
	ArrowLeft,
	Edit,
	Settings,
	Users,
	Calendar,
	Clock,
	MapPin,
	BookOpen,
	BarChart2,
	BarChart3,
	Bell,
	Share,
	Archive,
	MoreHorizontal,
	UserPlus,
	Mail,
	Phone,
	GraduationCap,
	TrendingUp,
	TrendingDown,
	Minus,
	Activity,
	Award,
	FileText,
	Plus,
	HelpCircle,
	MessageSquare,
	Video,
	Download,
	Upload,
	Eye,
	EyeOff,
	ChevronRight,
	Star,
	AlertCircle,
	CheckCircle,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Progress
} from "@/components/ui/progress";

interface ClassroomDetailsContentProps {
	classroom: Classroom;
}

export function ClassroomDetailsContent({ classroom }: ClassroomDetailsContentProps) {
	// Mock user for now - in real app this would come from context or props
	const user = {
		id: "1",
		name: "Dr. Sarah Chen",
		email: "sarah.chen@edforge.io",
		role: UserRole.TEACHER,
		avatar: "SC",
		tenantId: "springfield-high",
		tenantName: "Springfield High School",
	};

	const router = useRouter();
	const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
	const [analytics, setAnalytics] = useState<ClassroomAnalytics | null>(null);
	const [assignments, setAssignments] = useState<any[]>([]);
	const [activeTab, setActiveTab] = useState("stream");

	useEffect(() => {
		if (classroom.id) {
			setEnrollments(getEnrollmentsByClassroom(classroom.id));
			const analyticsData = getClassroomAnalytics(classroom.id);
			setAnalytics(analyticsData || null);
		}
	}, [classroom.id]);

	// Permission checks
	const canEditClassroom = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.EDIT_CLASSROOM);
	const canManageStudents = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.MANAGE_STUDENTS);
	const canViewStudents = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.VIEW_STUDENTS);
	const canViewGrades = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.VIEW_GRADES);
	const canManageGrades = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.MANAGE_GRADES);
	const canViewAnalytics = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.VIEW_ANALYTICS);
	const canManageSettings = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.MANAGE_SETTINGS);
	const canManageAssignments = user && classroom && hasClassroomPermission(user.role, ClassroomPermission.MANAGE_ASSIGNMENTS);

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "enrolled":
				return <CheckCircle className="h-4 w-4 text-green-600" />;
			case "pending":
				return <AlertCircle className="h-4 w-4 text-yellow-600" />;
			case "waitlisted":
				return <Clock className="h-4 w-4 text-blue-600" />;
			default:
				return <Minus className="h-4 w-4 text-gray-600" />;
		}
	};

	const getTrendIcon = (trend: string) => {
		switch (trend) {
			case "improving":
				return <TrendingUp className="h-4 w-4 text-green-600" />;
			case "declining":
				return <TrendingDown className="h-4 w-4 text-red-600" />;
			default:
				return <Minus className="h-4 w-4 text-gray-600" />;
		}
	};
	return (
		<div className="flex flex-1 flex-col min-h-screen">
			{/* Google Classroom-inspired Banner */}
			<div className="relative">
				{/* Banner Background */}
				<div 
					className="h-64 w-full relative overflow-hidden"
					style={{ 
						background: classroom.themeColor ? 
							`linear-gradient(135deg, ${classroom.themeColor}20 0%, ${classroom.themeColor}40 100%)` :
							'linear-gradient(135deg, #3B82F620 0%, #3B82F640 100%)'
					}}
				>
					{/* Decorative Pattern Overlay */}
					<div className="absolute inset-0 opacity-10">
						<svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
							<defs>
								<pattern id="classroom-grid" width="40" height="40" patternUnits="userSpaceOnUse">
									<path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
								</pattern>
							</defs>
							<rect width="100%" height="100%" fill="url(#classroom-grid)" />
						</svg>
					</div>

					{/* Navigation and Actions */}
					<div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
						<Button variant="ghost" size="sm" asChild className="text-white hover:bg-white/20">
							<Link href="/dashboard/curriculum/classes" className="flex items-center gap-2">
								<ArrowLeft className="h-4 w-4" />
								Back to Classes
							</Link>
						</Button>
						<div className="flex items-center gap-2">
							<Badge 
								variant="secondary" 
								className="bg-white/20 text-white border-white/30 backdrop-blur-sm"
							>
								{classroom.status}
							</Badge>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="sm" className="text-white hover:bg-white/20">
										<MoreHorizontal className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>Actions</DropdownMenuLabel>
									<DropdownMenuSeparator />
									{canManageSettings && (
										<DropdownMenuItem asChild>
											<Link href={`/dashboard/curriculum/classes/${classroom.id}/edit`}>
												<Settings className="h-4 w-4 mr-2" />
												Classroom Settings
											</Link>
										</DropdownMenuItem>
									)}
									{canManageStudents && (
										<DropdownMenuItem>
											<Users className="h-4 w-4 mr-2" />
											Manage Students
										</DropdownMenuItem>
									)}
									<DropdownMenuItem>
										<Share className="h-4 w-4 mr-2" />
										Share Classroom
									</DropdownMenuItem>
									<DropdownMenuItem>
										<Download className="h-4 w-4 mr-2" />
										Export Data
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>

					{/* Classroom Title Overlay */}
					<div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/60 to-transparent">
						<div className="flex items-center gap-4">
							<div 
								className="h-16 w-16 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg"
								style={{ backgroundColor: classroom.themeColor || "#3B82F6" }}
							>
								{classroom.name.charAt(0)}
							</div>
							<div>
								<h1 className="text-3xl font-bold text-white">{classroom.name}</h1>
								<p className="text-white/80 mt-1">
									{classroom.code} • {classroom.subject} • {classroom.grade}
								</p>
							</div>
						</div>
					</div>
				</div>

				{/* Quick Info Bar */}
				<div className="bg-background border-b">
					<div className="px-6 py-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-6">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Users className="h-4 w-4" />
									<span>{classroom.enrolled} of {classroom.capacity} students</span>
								</div>
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Calendar className="h-4 w-4" />
									<span>{formatSchedule(classroom.schedule)}</span>
								</div>
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<MapPin className="h-4 w-4" />
									<span>{classroom.room.name}</span>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<GraduationCap className="h-4 w-4" />
									<span>{classroom.primaryTeacher.teacherName}</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="flex-1 bg-background">
				{/* Elegant Tab Navigation - EdForge Theme */}
				<div className="border-b border-border bg-background">
					<div className="max-w-7xl mx-auto px-6">
						<div className="flex space-x-8">
							<button
								onClick={() => setActiveTab("stream")}
								className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
									activeTab === "stream"
										? "border-primary text-primary"
										: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
								}`}
							>
								<div className="flex items-center gap-2">
									<MessageSquare className="h-4 w-4" />
									Stream
								</div>
							</button>
							<button
								onClick={() => setActiveTab("classwork")}
								className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
									activeTab === "classwork"
										? "border-primary text-primary"
										: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
								}`}
							>
								<div className="flex items-center gap-2">
									<BookOpen className="h-4 w-4" />
									Classwork
								</div>
							</button>
							{canViewStudents && (
								<button
									onClick={() => setActiveTab("people")}
									className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
										activeTab === "people"
											? "border-primary text-primary"
											: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
									}`}
								>
									<div className="flex items-center gap-2">
										<Users className="h-4 w-4" />
										People
									</div>
								</button>
							)}
							{canViewGrades && (
								<button
									onClick={() => setActiveTab("grades")}
									className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
										activeTab === "grades"
											? "border-primary text-primary"
											: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
									}`}
								>
									<div className="flex items-center gap-2">
										<GraduationCap className="h-4 w-4" />
										Grades
									</div>
								</button>
							)}
							{canViewAnalytics && (
								<button
									onClick={() => setActiveTab("progress")}
									className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
										activeTab === "progress"
											? "border-primary text-primary"
											: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
									}`}
								>
									<div className="flex items-center gap-2">
										<BarChart2 className="h-4 w-4" />
										Progress
									</div>
								</button>
							)}
						</div>
					</div>
				</div>

				{/* Tab Content */}
				<div className="max-w-7xl mx-auto px-6 py-6">
					{/* Stream Tab - Google Classroom Style */}
					{activeTab === "stream" && (
						<div className="grid gap-6 lg:grid-cols-3">
							{/* Main Stream Content */}
							<div className="lg:col-span-2 space-y-6">
								{/* Share Something Card */}
								{canManageAssignments && (
									<Card className="bg-card border-border">
										<CardContent className="p-6">
											<div className="flex items-center gap-4">
												<Avatar className="h-10 w-10">
													<AvatarFallback className="bg-primary text-primary-foreground">
														{classroom?.primaryTeacher.teacherName.charAt(0)}
													</AvatarFallback>
												</Avatar>
												<div className="flex-1">
													<Input 
														placeholder="Share something with your class..."
														className="border-border bg-background"
													/>
												</div>
												<Button size="sm">
													<Plus className="h-4 w-4 mr-2" />
													Post
												</Button>
											</div>
										</CardContent>
									</Card>
								)}

								{/* Stream Posts */}
								<div className="space-y-4">
									{/* Teacher Announcement */}
									<Card className="bg-card border-border">
										<CardContent className="p-6">
											<div className="flex items-start gap-4">
												<Avatar className="h-10 w-10">
													<AvatarFallback className="bg-primary text-primary-foreground">
														{classroom?.primaryTeacher.teacherName.charAt(0)}
													</AvatarFallback>
												</Avatar>
												<div className="flex-1">
													<div className="flex items-center gap-2 mb-2">
														<span className="font-medium text-foreground">{classroom?.primaryTeacher.teacherName}</span>
														<span className="text-sm text-muted-foreground">•</span>
														<span className="text-sm text-muted-foreground">2 hours ago</span>
													</div>
													<div className="prose prose-sm max-w-none">
														<p className="text-foreground mb-3">
															Welcome to {classroom?.name}! I'm excited to start this academic year with all of you. 
															Please review the syllabus and don't hesitate to reach out if you have any questions.
														</p>
														<div className="flex items-center gap-4 text-sm text-muted-foreground">
															<Button variant="ghost" size="sm" className="h-8 px-2">
																<MessageSquare className="h-4 w-4 mr-1" />
																3 Comments
															</Button>
															<Button variant="ghost" size="sm" className="h-8 px-2">
																<Plus className="h-4 w-4 mr-1" />
																Add Material
															</Button>
														</div>
													</div>
												</div>
											</div>
										</CardContent>
									</Card>

									{/* Assignment Post */}
									<Card className="bg-card border-border">
										<CardContent className="p-6">
											<div className="flex items-start gap-4">
												<div className="p-2 rounded-full bg-primary/10">
													<FileText className="h-5 w-5 text-primary" />
												</div>
												<div className="flex-1">
													<div className="flex items-center gap-2 mb-2">
														<span className="font-medium text-foreground">{classroom?.primaryTeacher.teacherName}</span>
														<span className="text-sm text-muted-foreground">•</span>
														<span className="text-sm text-muted-foreground">1 day ago</span>
													</div>
													<div className="space-y-3">
														<div>
															<h3 className="font-semibold text-foreground mb-1">Chapter 1 Practice Problems</h3>
															<p className="text-sm text-muted-foreground">
																Complete exercises 1-15 from Chapter 1. Due: Friday, October 15th at 11:59 PM
															</p>
														</div>
														<div className="flex items-center gap-4 text-sm text-muted-foreground">
															<Button variant="ghost" size="sm" className="h-8 px-2">
																<MessageSquare className="h-4 w-4 mr-1" />
																7 Comments
															</Button>
															<Button variant="ghost" size="sm" className="h-8 px-2">
																<Download className="h-4 w-4 mr-1" />
																View Assignment
															</Button>
														</div>
													</div>
												</div>
											</div>
										</CardContent>
									</Card>

									{/* Quiz Post */}
									<Card className="bg-card border-border">
										<CardContent className="p-6">
											<div className="flex items-start gap-4">
												<div className="p-2 rounded-full bg-orange-100">
													<HelpCircle className="h-5 w-5 text-orange-600" />
												</div>
												<div className="flex-1">
													<div className="flex items-center gap-2 mb-2">
														<span className="font-medium text-foreground">{classroom?.primaryTeacher.teacherName}</span>
														<span className="text-sm text-muted-foreground">•</span>
														<span className="text-sm text-muted-foreground">3 days ago</span>
													</div>
													<div className="space-y-3">
														<div>
															<h3 className="font-semibold text-foreground mb-1">Weekly Quiz #2</h3>
															<p className="text-sm text-muted-foreground">
																Quiz covering topics from Week 2. You have 30 minutes to complete.
															</p>
														</div>
														<div className="flex items-center gap-4 text-sm text-muted-foreground">
															<Button variant="ghost" size="sm" className="h-8 px-2">
																<MessageSquare className="h-4 w-4 mr-1" />
																2 Comments
															</Button>
															<Button variant="ghost" size="sm" className="h-8 px-2">
																<BookOpen className="h-4 w-4 mr-1" />
																Take Quiz
															</Button>
														</div>
													</div>
												</div>
											</div>
										</CardContent>
									</Card>
								</div>
							</div>

							{/* Sidebar */}
							<div className="space-y-6">
								{/* Upcoming */}
								<Card className="bg-card border-border">
									<CardHeader className="pb-3">
										<CardTitle className="text-lg">Upcoming</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3">
										<div className="p-3 rounded-lg bg-muted/50 border border-border">
											<p className="font-medium text-sm text-foreground">Chapter 1 Practice Problems</p>
											<p className="text-xs text-muted-foreground">Due Friday, Oct 15</p>
										</div>
										<div className="p-3 rounded-lg bg-muted/50 border border-border">
											<p className="font-medium text-sm text-foreground">Midterm Exam</p>
											<p className="text-xs text-muted-foreground">Due Monday, Oct 25</p>
										</div>
										<Button variant="ghost" size="sm" className="w-full text-primary">
											View All
										</Button>
									</CardContent>
								</Card>

								{/* Class Code */}
								<Card className="bg-card border-border">
									<CardHeader className="pb-3">
										<CardTitle className="text-lg">Class Code</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="p-3 rounded-lg bg-muted/50 border border-border text-center">
											<code className="text-lg font-mono font-bold text-foreground">ABC123</code>
											<p className="text-xs text-muted-foreground mt-1">Share this code with students</p>
										</div>
									</CardContent>
								</Card>
							</div>
						</div>
					)}

					{/* Classwork Tab */}
					{activeTab === "classwork" && (
						<div className="space-y-6">
							{/* Create Assignment Section */}
							{canManageAssignments && (
								<Card className="bg-card border-2 border-dashed border-border hover:border-primary/50 transition-colors">
									<CardContent className="p-8 text-center">
										<div className="flex flex-col items-center gap-4">
											<div className="p-4 rounded-full bg-primary/10">
												<Plus className="h-8 w-8 text-primary" />
											</div>
											<div>
												<h3 className="text-lg font-semibold text-foreground">Create Assignment</h3>
												<p className="text-sm text-muted-foreground">Add homework, quizzes, or exams for your students</p>
											</div>
											<div className="flex gap-2">
												<Button>
													<FileText className="h-4 w-4 mr-2" />
													Assignment
												</Button>
												<Button variant="outline">
													<HelpCircle className="h-4 w-4 mr-2" />
													Quiz
												</Button>
												<Button variant="outline">
													<BookOpen className="h-4 w-4 mr-2" />
													Exam
												</Button>
											</div>
										</div>
									</CardContent>
								</Card>
							)}

							{/* Assignments List */}
							<div className="space-y-4">
								<h2 className="text-xl font-semibold text-foreground">Recent Assignments</h2>
								{assignments.length > 0 ? (
									<div className="grid gap-4">
										{assignments.map((assignment) => (
											<Card key={assignment.id} className="hover:shadow-md transition-shadow">
												<CardContent className="p-6">
													<div className="flex items-center justify-between">
														<div className="flex items-center gap-4">
															<div className="p-3 rounded-full bg-primary/10">
																<FileText className="h-6 w-6 text-primary" />
															</div>
															<div>
																<h3 className="font-semibold text-lg">{assignment.title}</h3>
																<p className="text-sm text-muted-foreground">{assignment.description}</p>
																<div className="flex items-center gap-4 mt-2">
																	<span className="text-xs text-muted-foreground">
																		Due: {new Date(assignment.dueDate).toLocaleDateString()}
																	</span>
																	<Badge variant="outline" className={
																		assignment.status === "Completed" ? "bg-green-50 text-green-700 border-green-200" :
																		assignment.status === "Overdue" ? "bg-red-50 text-red-700 border-red-200" :
																		"bg-blue-50 text-blue-700 border-blue-200"
																	}>
																		{assignment.status}
																	</Badge>
																</div>
															</div>
														</div>
														<div className="flex items-center gap-2">
															{canViewGrades && assignment.grade !== undefined && (
																<span className="text-sm font-medium">
																	{assignment.grade}/{assignment.maxPoints}
																</span>
															)}
															<Button variant="ghost" size="sm">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</div>
													</div>
												</CardContent>
											</Card>
										))}
									</div>
								) : (
									<Card>
										<CardContent className="p-8 text-center">
											<FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
											<h3 className="text-lg font-semibold text-foreground">No Assignments Yet</h3>
											<p className="text-muted-foreground">Create your first assignment to get started.</p>
										</CardContent>
									</Card>
								)}
							</div>
						</div>
					)}

					{/* People Tab */}
					{activeTab === "people" && (
						<div className="space-y-6">
							{/* Teachers Section */}
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<h2 className="text-xl font-semibold text-foreground">Teachers</h2>
									{canManageStudents && (
										<Dialog>
											<DialogTrigger asChild>
												<Button variant="outline" size="sm">
													<Plus className="h-4 w-4 mr-2" />
													Invite Teacher
												</Button>
											</DialogTrigger>
											<DialogContent className="sm:max-w-[425px]">
												<DialogHeader>
													<DialogTitle>Invite Teacher</DialogTitle>
													<DialogDescription>
														Add a new teacher to this classroom by entering their details.
													</DialogDescription>
												</DialogHeader>
												<div className="grid gap-4 py-4">
													<div className="grid grid-cols-4 items-center gap-4">
														<Label htmlFor="teacher-name" className="text-right">
															Name
														</Label>
														<Input
															id="teacher-name"
															placeholder="Enter teacher name"
															className="col-span-3"
														/>
													</div>
													<div className="grid grid-cols-4 items-center gap-4">
														<Label htmlFor="teacher-email" className="text-right">
															Email
														</Label>
														<Input
															id="teacher-email"
															type="email"
															placeholder="teacher@school.edu"
															className="col-span-3"
														/>
													</div>
												</div>
												<DialogFooter>
													<Button type="submit">Send Invitation</Button>
												</DialogFooter>
											</DialogContent>
										</Dialog>
									)}
								</div>
								<Card>
									<CardContent className="p-4">
										<div className="flex items-center gap-4">
											<Avatar className="h-12 w-12">
												<AvatarFallback className="bg-primary text-primary-foreground">
													{classroom?.primaryTeacher.teacherName.split(' ').map(n => n[0]).join('')}
												</AvatarFallback>
											</Avatar>
											<div className="flex-1">
												<h3 className="font-semibold text-foreground">{classroom?.primaryTeacher.teacherName}</h3>
												<p className="text-sm text-muted-foreground">{classroom?.primaryTeacher.teacherEmail}</p>
											</div>
											<div className="flex items-center gap-2">
												<Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
													Primary Teacher
												</Badge>
												{canManageStudents && (
													<Button variant="ghost" size="sm">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												)}
											</div>
										</div>
									</CardContent>
								</Card>
							</div>

							{/* Students Section */}
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<h2 className="text-xl font-semibold text-foreground">Students ({enrollments.length})</h2>
									{canManageStudents && (
										<Dialog>
											<DialogTrigger asChild>
												<Button variant="outline" size="sm">
													<Plus className="h-4 w-4 mr-2" />
													Invite Students
												</Button>
											</DialogTrigger>
											<DialogContent className="sm:max-w-[425px]">
												<DialogHeader>
													<DialogTitle>Invite Students</DialogTitle>
													<DialogDescription>
														Add students to this classroom by entering their details or sending invitations.
													</DialogDescription>
												</DialogHeader>
												<div className="grid gap-4 py-4">
													<div className="grid grid-cols-4 items-center gap-4">
														<Label htmlFor="student-email" className="text-right">
															Email
														</Label>
														<Input
															id="student-email"
															type="email"
															placeholder="student@school.edu"
															className="col-span-3"
														/>
													</div>
												</div>
												<DialogFooter>
													<Button type="submit">Send Invitation</Button>
												</DialogFooter>
											</DialogContent>
										</Dialog>
									)}
								</div>
								<div className="grid gap-3">
									{enrollments.map((enrollment) => (
										<Card key={enrollment.id} className="hover:shadow-md transition-shadow">
											<CardContent className="p-4">
												<div className="flex items-center gap-4">
													<Avatar className="h-10 w-10">
														<AvatarFallback className="bg-secondary text-secondary-foreground">
															{enrollment.studentId.split('-').pop()?.slice(0, 2).toUpperCase() || 'S'}
														</AvatarFallback>
													</Avatar>
													<div className="flex-1">
														<h3 className="font-medium text-foreground">Student {enrollment.studentId}</h3>
														<p className="text-sm text-muted-foreground">student{enrollment.studentId}@school.edu</p>
													</div>
													<div className="flex items-center gap-2">
														{getStatusIcon(enrollment.status)}
														<Badge variant="outline" className={
															enrollment.status === "enrolled" ? "bg-green-50 text-green-700 border-green-200" :
															enrollment.status === "pending" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
															"bg-blue-50 text-blue-700 border-blue-200"
														}>
															{enrollment.status}
														</Badge>
														{canManageStudents && (
															<Button variant="ghost" size="sm">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														)}
													</div>
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							</div>
						</div>
					)}

					{/* Grades Tab */}
					{activeTab === "grades" && (
						<div className="space-y-6">
							<div className="flex items-center justify-between">
								<h2 className="text-xl font-semibold text-foreground">Gradebook</h2>
								{canManageGrades && (
									<Button>
										<Plus className="h-4 w-4 mr-2" />
										Add Grade Column
									</Button>
								)}
							</div>
							<Card>
								<CardContent className="p-6">
									<div className="text-center py-12">
										<GraduationCap className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
										<h3 className="text-lg font-semibold text-foreground mb-2">No Grades Yet</h3>
										<p className="text-muted-foreground">Grades will appear here once assignments are created and graded.</p>
									</div>
								</CardContent>
							</Card>
						</div>
					)}

					{/* Progress Tab */}
					{activeTab === "progress" && (
						<div className="space-y-6">
							<h2 className="text-xl font-semibold text-foreground">Class Progress</h2>
							{analytics ? (
								<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-base">Average Grade</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="text-3xl font-bold text-primary mb-2">
												{analytics.averageGrade}%
											</div>
											<div className="flex items-center gap-2">
												{getTrendIcon("stable")}
												<span className="text-sm text-muted-foreground">
													Stable
												</span>
											</div>
										</CardContent>
									</Card>
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-base">Assignment Completion</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="text-3xl font-bold text-primary mb-2">
												{analytics.assignmentCompletionRate}%
											</div>
											<Progress value={analytics.assignmentCompletionRate} className="mt-2" />
										</CardContent>
									</Card>
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-base">Active Students</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="text-3xl font-bold text-primary mb-2">
												{analytics.totalStudents || 0}
											</div>
											<span className="text-sm text-muted-foreground">
												of {classroom.enrolled} total
											</span>
										</CardContent>
									</Card>
								</div>
							) : (
								<Card>
									<CardContent className="p-8 text-center">
										<BarChart2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
										<h3 className="text-lg font-semibold text-foreground">No Analytics Yet</h3>
										<p className="text-muted-foreground">Analytics will appear here once students start submitting assignments.</p>
									</CardContent>
								</Card>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

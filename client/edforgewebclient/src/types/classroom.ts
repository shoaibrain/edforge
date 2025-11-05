/**
 * EdForge EMIS - Classroom Management Type Definitions
 * 
 * This module defines the core types for classroom management including:
 * - Classroom data structures
 * - Student enrollment
 * - Teacher assignments
 * - Course materials and assignments
 * - Grade management
 */

import { UserRole } from "./rbac";

// ============================================
// Core Classroom Types
// ============================================

export interface Classroom {
	id: string;
	name: string;
	code: string;
	description?: string;
	subject: string;
	grade: string;
	gradeLevel: number;
	academicYear: string;
	semester: string;
	
	// Capacity and Enrollment
	capacity: number;
	enrolled: number;
	waitlistCount?: number;
	
	// Staff Assignment
	primaryTeacher: TeacherAssignment;
	assistantTeachers?: TeacherAssignment[];
	
	// Schedule and Location
	schedule: ClassSchedule;
	room: RoomAssignment;
	
	// Status and Metadata
	status: ClassroomStatus;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	tenantId: string;
	
	// Theme and Branding
	themeColor?: string;
	bannerImage?: string;
	
	// Settings
	settings: ClassroomSettings;
}

export interface TeacherAssignment {
	id: string;
	teacherId: string;
	teacherName: string;
	teacherEmail: string;
	role: TeacherRole;
	assignedAt: string;
	isActive: boolean;
}

export enum TeacherRole {
	PRIMARY = "PRIMARY",
	ASSISTANT = "ASSISTANT",
	SUBSTITUTE = "SUBSTITUTE",
	OBSERVER = "OBSERVER"
}

export enum ClassroomStatus {
	ACTIVE = "active",
	INACTIVE = "inactive",
	ARCHIVED = "archived",
	DRAFT = "draft"
}

export interface ClassSchedule {
	days: DayOfWeek[];
	startTime: string;
	endTime: string;
	timezone: string;
	sessionType: SessionType;
}

export enum DayOfWeek {
	MONDAY = "monday",
	TUESDAY = "tuesday",
	WEDNESDAY = "wednesday",
	THURSDAY = "thursday",
	FRIDAY = "friday",
	SATURDAY = "saturday",
	SUNDAY = "sunday"
}

export enum SessionType {
	REGULAR = "regular",
	LAB = "lab",
	TUTORIAL = "tutorial",
	SEMINAR = "seminar",
	WORKSHOP = "workshop"
}

export interface RoomAssignment {
	id: string;
	name: string;
	building: string;
	floor?: number;
	capacity: number;
	type: RoomType;
	equipment?: string[];
}

export enum RoomType {
	CLASSROOM = "classroom",
	LABORATORY = "laboratory",
	AUDITORIUM = "auditorium",
	LIBRARY = "library",
	GYMNASIUM = "gymnasium",
	COMPUTER_LAB = "computer_lab"
}

export interface ClassroomSettings {
	allowStudentEnrollment: boolean;
	requireApprovalForEnrollment: boolean;
	allowLateEnrollment: boolean;
	enrollmentDeadline?: string;
	allowGuestAccess: boolean;
	enableDiscussions: boolean;
	enableAnnouncements: boolean;
	enableGradebook: boolean;
	enableAttendance: boolean;
	enableMessaging: boolean;
	enableFileSharing: boolean;
	enableVideoConferencing: boolean;
	enableParentAccess: boolean;
	notifications: NotificationSettings;
}

export interface NotificationSettings {
	emailNotifications: boolean;
	pushNotifications: boolean;
	announcementAlerts: boolean;
	assignmentReminders: boolean;
	gradeUpdates: boolean;
	attendanceAlerts: boolean;
}

// ============================================
// Student Enrollment
// ============================================

export interface StudentEnrollment {
	id: string;
	studentId: string;
	studentName: string;
	studentEmail: string;
	classroomId: string;
	enrolledAt: string;
	status: EnrollmentStatus;
	grade?: string;
	attendanceRate?: number;
	lastActivity?: string;
	parentGuardians?: ParentGuardian[];
}

export enum EnrollmentStatus {
	ENROLLED = "enrolled",
	PENDING = "pending",
	WAITLISTED = "waitlisted",
	DROPPED = "dropped",
	TRANSFERRED = "transferred"
}

export interface ParentGuardian {
	id: string;
	name: string;
	email: string;
	phone?: string;
	relationship: string;
	isPrimary: boolean;
}

// ============================================
// Course Materials and Assignments
// ============================================

export interface CourseMaterial {
	id: string;
	classroomId: string;
	title: string;
	description?: string;
	type: MaterialType;
	content: string;
	attachments?: Attachment[];
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	isPublished: boolean;
	visibility: MaterialVisibility;
	tags?: string[];
}

export enum MaterialType {
	ANNOUNCEMENT = "announcement",
	ASSIGNMENT = "assignment",
	LESSON = "lesson",
	RESOURCE = "resource",
	QUIZ = "quiz",
	EXAM = "exam",
	PROJECT = "project",
	SYLLABUS = "syllabus",
	RUBRIC = "rubric"
}

export enum MaterialVisibility {
	EVERYONE = "everyone",
	STUDENTS_ONLY = "students_only",
	TEACHERS_ONLY = "teachers_only",
	PARENTS_ONLY = "parents_only"
}

export interface Attachment {
	id: string;
	name: string;
	url: string;
	type: string;
	size: number;
	uploadedAt: string;
}

export interface Assignment extends CourseMaterial {
	dueDate: string;
	points: number;
	allowLateSubmission: boolean;
	latePenalty?: number;
	submissionType: SubmissionType;
	maxAttempts?: number;
	timeLimit?: number; // in minutes
	rubric?: Rubric;
}

export enum SubmissionType {
	ONLINE = "online",
	OFFLINE = "offline",
	BOTH = "both"
}

export interface Rubric {
	id: string;
	criteria: RubricCriteria[];
	totalPoints: number;
}

export interface RubricCriteria {
	id: string;
	name: string;
	description: string;
	points: number;
	levels: RubricLevel[];
}

export interface RubricLevel {
	id: string;
	name: string;
	description: string;
	points: number;
}

// ============================================
// Grade Management
// ============================================

export interface Grade {
	id: string;
	studentId: string;
	classroomId: string;
	assignmentId?: string;
	grade: number;
	maxGrade: number;
	percentage: number;
	letterGrade?: string;
	feedback?: string;
	gradedBy: string;
	gradedAt: string;
	isFinal: boolean;
	comments?: string;
}

export interface Gradebook {
	id: string;
	classroomId: string;
	studentId: string;
	studentName: string;
	assignments: AssignmentGrade[];
	totalPoints: number;
	earnedPoints: number;
	percentage: number;
	letterGrade: string;
	gpa?: number;
	lastUpdated: string;
}

export interface AssignmentGrade {
	assignmentId: string;
	assignmentName: string;
	points: number;
	maxPoints: number;
	percentage: number;
	letterGrade?: string;
	submittedAt?: string;
	gradedAt?: string;
	feedback?: string;
}

// ============================================
// Analytics and Reporting
// ============================================

export interface ClassroomAnalytics {
	classroomId: string;
	totalStudents: number;
	averageGrade: number;
	attendanceRate: number;
	assignmentCompletionRate: number;
	engagementScore: number;
	topPerformers: StudentPerformance[];
	needsAttention: StudentPerformance[];
	recentActivity: ActivityItem[];
}

export interface StudentPerformance {
	studentId: string;
	studentName: string;
	grade: number;
	attendance: number;
	engagement: number;
	trend: PerformanceTrend;
}

export enum PerformanceTrend {
	IMPROVING = "improving",
	STABLE = "stable",
	DECLINING = "declining"
}

export interface ActivityItem {
	id: string;
	type: ActivityType;
	description: string;
	userId: string;
	userName: string;
	timestamp: string;
	metadata?: Record<string, any>;
}

export enum ActivityType {
	ASSIGNMENT_SUBMITTED = "assignment_submitted",
	GRADE_POSTED = "grade_posted",
	ANNOUNCEMENT_CREATED = "announcement_created",
	STUDENT_ENROLLED = "student_enrolled",
	STUDENT_DROPPED = "student_dropped",
	MATERIAL_SHARED = "material_shared",
	ATTENDANCE_TAKEN = "attendance_taken"
}

// ============================================
// Access Control and Permissions
// ============================================

export interface ClassroomAccess {
	userId: string;
	userRole: UserRole;
	classroomId: string;
	permissions: ClassroomPermission[];
	grantedAt: string;
	grantedBy: string;
	expiresAt?: string;
	isActive: boolean;
}

export enum ClassroomPermission {
	VIEW_CLASSROOM = "VIEW_CLASSROOM",
	EDIT_CLASSROOM = "EDIT_CLASSROOM",
	DELETE_CLASSROOM = "DELETE_CLASSROOM",
	MANAGE_STUDENTS = "MANAGE_STUDENTS",
	VIEW_STUDENTS = "VIEW_STUDENTS",
	MANAGE_GRADES = "MANAGE_GRADES",
	VIEW_GRADES = "VIEW_GRADES",
	MANAGE_ASSIGNMENTS = "MANAGE_ASSIGNMENTS",
	VIEW_ASSIGNMENTS = "VIEW_ASSIGNMENTS",
	MANAGE_MATERIALS = "MANAGE_MATERIALS",
	VIEW_MATERIALS = "VIEW_MATERIALS",
	MANAGE_ATTENDANCE = "MANAGE_ATTENDANCE",
	VIEW_ATTENDANCE = "VIEW_ATTENDANCE",
	SEND_ANNOUNCEMENTS = "SEND_ANNOUNCEMENTS",
	VIEW_ANNOUNCEMENTS = "VIEW_ANNOUNCEMENTS",
	MANAGE_SETTINGS = "MANAGE_SETTINGS",
	VIEW_ANALYTICS = "VIEW_ANALYTICS"
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if user has permission for classroom
 */
export function hasClassroomPermission(
	userRole: UserRole,
	permission: ClassroomPermission,
	isTeacher: boolean = false,
	isStudent: boolean = false
): boolean {
	// Define role-based permission mappings
	const rolePermissions: Record<UserRole, ClassroomPermission[]> = {
		[UserRole.SUPER_ADMIN]: Object.values(ClassroomPermission),
		[UserRole.TENANT_ADMIN]: Object.values(ClassroomPermission),
		[UserRole.PRINCIPAL]: [
			ClassroomPermission.VIEW_CLASSROOM,
			ClassroomPermission.VIEW_STUDENTS,
			ClassroomPermission.VIEW_GRADES,
			ClassroomPermission.VIEW_ASSIGNMENTS,
			ClassroomPermission.VIEW_MATERIALS,
			ClassroomPermission.VIEW_ATTENDANCE,
			ClassroomPermission.VIEW_ANNOUNCEMENTS,
			ClassroomPermission.VIEW_ANALYTICS
		],
		[UserRole.TEACHER]: [
			ClassroomPermission.VIEW_CLASSROOM,
			ClassroomPermission.EDIT_CLASSROOM,
			ClassroomPermission.MANAGE_STUDENTS,
			ClassroomPermission.VIEW_STUDENTS,
			ClassroomPermission.MANAGE_GRADES,
			ClassroomPermission.VIEW_GRADES,
			ClassroomPermission.MANAGE_ASSIGNMENTS,
			ClassroomPermission.VIEW_ASSIGNMENTS,
			ClassroomPermission.MANAGE_MATERIALS,
			ClassroomPermission.VIEW_MATERIALS,
			ClassroomPermission.MANAGE_ATTENDANCE,
			ClassroomPermission.VIEW_ATTENDANCE,
			ClassroomPermission.SEND_ANNOUNCEMENTS,
			ClassroomPermission.VIEW_ANNOUNCEMENTS,
			ClassroomPermission.MANAGE_SETTINGS,
			ClassroomPermission.VIEW_ANALYTICS
		],
		[UserRole.STUDENT]: [
			ClassroomPermission.VIEW_CLASSROOM,
			ClassroomPermission.VIEW_ASSIGNMENTS,
			ClassroomPermission.VIEW_MATERIALS,
			ClassroomPermission.VIEW_ATTENDANCE,
			ClassroomPermission.VIEW_ANNOUNCEMENTS
		],
		[UserRole.PARENT]: [
			ClassroomPermission.VIEW_CLASSROOM,
			ClassroomPermission.VIEW_STUDENTS,
			ClassroomPermission.VIEW_GRADES,
			ClassroomPermission.VIEW_ASSIGNMENTS,
			ClassroomPermission.VIEW_MATERIALS,
			ClassroomPermission.VIEW_ATTENDANCE,
			ClassroomPermission.VIEW_ANNOUNCEMENTS
		]
	};

	return rolePermissions[userRole]?.includes(permission) || false;
}

/**
 * Get classroom status color for UI
 */
export function getClassroomStatusColor(status: ClassroomStatus): string {
	const colors: Record<ClassroomStatus, string> = {
		[ClassroomStatus.ACTIVE]: "bg-green-100 text-green-800 border-green-200",
		[ClassroomStatus.INACTIVE]: "bg-gray-100 text-gray-800 border-gray-200",
		[ClassroomStatus.ARCHIVED]: "bg-orange-100 text-orange-800 border-orange-200",
		[ClassroomStatus.DRAFT]: "bg-blue-100 text-blue-800 border-blue-200"
	};
	return colors[status];
}

/**
 * Calculate enrollment percentage
 */
export function getEnrollmentPercentage(enrolled: number, capacity: number): number {
	return Math.round((enrolled / capacity) * 100);
}

/**
 * Get grade color based on percentage
 */
export function getGradeColor(percentage: number): string {
	if (percentage >= 90) return "text-green-600";
	if (percentage >= 80) return "text-blue-600";
	if (percentage >= 70) return "text-yellow-600";
	if (percentage >= 60) return "text-orange-600";
	return "text-red-600";
}

/**
 * Format classroom schedule for display
 */
export function formatSchedule(schedule: ClassSchedule): string {
	const days = schedule.days.map(day => 
		day.charAt(0).toUpperCase() + day.slice(1).slice(0, 3)
	).join(", ");
	
	return `${days} ${schedule.startTime} - ${schedule.endTime}`;
}

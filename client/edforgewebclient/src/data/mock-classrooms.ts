/**
 * EdForge EMIS - Mock Classroom Data
 * 
 * This file contains mock data for classroom management testing and development.
 * In production, this would be replaced with actual API calls.
 */

import { 
	Classroom, 
	TeacherAssignment, 
	TeacherRole, 
	ClassroomStatus,
	DayOfWeek,
	SessionType,
	RoomType,
	EnrollmentStatus,
	StudentEnrollment,
	MaterialType,
	MaterialVisibility,
	ClassroomAnalytics,
	PerformanceTrend,
	ActivityType
} from "@/types/classroom";

export const mockClassrooms: Classroom[] = [
	{
		id: "CLS-2024-001",
		name: "Advanced Mathematics A",
		code: "MATH-11A",
		description: "Advanced placement mathematics course covering calculus, algebra, and statistics. Designed for students seeking college-level preparation.",
		subject: "Mathematics",
		grade: "11th Grade",
		gradeLevel: 11,
		academicYear: "2024-2025",
		semester: "Fall",
		capacity: 30,
		enrolled: 28,
		waitlistCount: 3,
		primaryTeacher: {
			id: "TCH-001",
			teacherId: "TCH-001",
			teacherName: "Dr. Sarah Chen",
			teacherEmail: "sarah.chen@springfield.edu",
			role: TeacherRole.PRIMARY,
			assignedAt: "2024-08-15T00:00:00Z",
			isActive: true
		},
		assistantTeachers: [
			{
				id: "TCH-002",
				teacherId: "TCH-002",
				teacherName: "Prof. Michael Torres",
				teacherEmail: "michael.torres@springfield.edu",
				role: TeacherRole.ASSISTANT,
				assignedAt: "2024-08-20T00:00:00Z",
				isActive: true
			}
		],
		schedule: {
			days: [DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY],
			startTime: "09:00",
			endTime: "10:30",
			timezone: "America/New_York",
			sessionType: SessionType.REGULAR
		},
		room: {
			id: "RM-301",
			name: "Room 301",
			building: "Mathematics Building",
			floor: 3,
			capacity: 35,
			type: RoomType.CLASSROOM,
			equipment: ["Smart Board", "Projector", "Whiteboard"]
		},
		status: ClassroomStatus.ACTIVE,
		createdAt: "2024-08-10T00:00:00Z",
		updatedAt: "2024-10-12T00:00:00Z",
		createdBy: "TCH-001",
		tenantId: "TENANT-001",
		themeColor: "#3B82F6",
		bannerImage: "/images/classrooms/math-banner.jpg",
		settings: {
			allowStudentEnrollment: true,
			requireApprovalForEnrollment: false,
			allowLateEnrollment: true,
			allowGuestAccess: false,
			enableDiscussions: true,
			enableAnnouncements: true,
			enableGradebook: true,
			enableAttendance: true,
			enableMessaging: true,
			enableFileSharing: true,
			enableVideoConferencing: true,
			enableParentAccess: true,
			notifications: {
				emailNotifications: true,
				pushNotifications: true,
				announcementAlerts: true,
				assignmentReminders: true,
				gradeUpdates: true,
				attendanceAlerts: true
			}
		}
	},
	{
		id: "CLS-2024-002",
		name: "English Literature B",
		code: "ENG-10B",
		description: "Comprehensive English literature course focusing on classic and contemporary works, critical analysis, and creative writing.",
		subject: "English",
		grade: "10th Grade",
		gradeLevel: 10,
		academicYear: "2024-2025",
		semester: "Fall",
		capacity: 25,
		enrolled: 25,
		waitlistCount: 0,
		primaryTeacher: {
			id: "TCH-003",
			teacherId: "TCH-003",
			teacherName: "Prof. Michael Torres",
			teacherEmail: "michael.torres@springfield.edu",
			role: TeacherRole.PRIMARY,
			assignedAt: "2024-08-15T00:00:00Z",
			isActive: true
		},
		schedule: {
			days: [DayOfWeek.TUESDAY, DayOfWeek.THURSDAY],
			startTime: "10:30",
			endTime: "12:00",
			timezone: "America/New_York",
			sessionType: SessionType.REGULAR
		},
		room: {
			id: "RM-205",
			name: "Room 205",
			building: "Humanities Building",
			floor: 2,
			capacity: 30,
			type: RoomType.CLASSROOM,
			equipment: ["Projector", "Audio System", "Bookshelf"]
		},
		status: ClassroomStatus.ACTIVE,
		createdAt: "2024-08-12T00:00:00Z",
		updatedAt: "2024-10-10T00:00:00Z",
		createdBy: "TCH-003",
		tenantId: "TENANT-001",
		themeColor: "#10B981",
		bannerImage: "/images/classrooms/english-banner.jpg",
		settings: {
			allowStudentEnrollment: true,
			requireApprovalForEnrollment: false,
			allowLateEnrollment: false,
			allowGuestAccess: false,
			enableDiscussions: true,
			enableAnnouncements: true,
			enableGradebook: true,
			enableAttendance: true,
			enableMessaging: true,
			enableFileSharing: true,
			enableVideoConferencing: false,
			enableParentAccess: true,
			notifications: {
				emailNotifications: true,
				pushNotifications: true,
				announcementAlerts: true,
				assignmentReminders: true,
				gradeUpdates: true,
				attendanceAlerts: false
			}
		}
	},
	{
		id: "CLS-2024-003",
		name: "Physics Honors",
		code: "PHY-11H",
		description: "Honors physics course covering mechanics, thermodynamics, waves, and modern physics with extensive laboratory work.",
		subject: "Science",
		grade: "11th Grade",
		gradeLevel: 11,
		academicYear: "2024-2025",
		semester: "Fall",
		capacity: 24,
		enrolled: 22,
		waitlistCount: 1,
		primaryTeacher: {
			id: "TCH-004",
			teacherId: "TCH-004",
			teacherName: "Dr. Emily Rodriguez",
			teacherEmail: "emily.rodriguez@springfield.edu",
			role: TeacherRole.PRIMARY,
			assignedAt: "2024-08-15T00:00:00Z",
			isActive: true
		},
		schedule: {
			days: [DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY],
			startTime: "13:00",
			endTime: "14:30",
			timezone: "America/New_York",
			sessionType: SessionType.LAB
		},
		room: {
			id: "LAB-102",
			name: "Physics Lab 102",
			building: "Science Building",
			floor: 1,
			capacity: 30,
			type: RoomType.LABORATORY,
			equipment: ["Physics Equipment", "Safety Equipment", "Computers", "Projector"]
		},
		status: ClassroomStatus.ACTIVE,
		createdAt: "2024-08-14T00:00:00Z",
		updatedAt: "2024-10-08T00:00:00Z",
		createdBy: "TCH-004",
		tenantId: "TENANT-001",
		themeColor: "#F59E0B",
		bannerImage: "/images/classrooms/physics-banner.jpg",
		settings: {
			allowStudentEnrollment: true,
			requireApprovalForEnrollment: true,
			allowLateEnrollment: false,
			allowGuestAccess: false,
			enableDiscussions: true,
			enableAnnouncements: true,
			enableGradebook: true,
			enableAttendance: true,
			enableMessaging: true,
			enableFileSharing: true,
			enableVideoConferencing: true,
			enableParentAccess: true,
			notifications: {
				emailNotifications: true,
				pushNotifications: true,
				announcementAlerts: true,
				assignmentReminders: true,
				gradeUpdates: true,
				attendanceAlerts: true
			}
		}
	},
	{
		id: "CLS-2024-004",
		name: "World History",
		code: "HIST-9A",
		description: "Comprehensive survey of world history from ancient civilizations to modern times, emphasizing critical thinking and historical analysis.",
		subject: "History",
		grade: "9th Grade",
		gradeLevel: 9,
		academicYear: "2024-2025",
		semester: "Fall",
		capacity: 28,
		enrolled: 26,
		waitlistCount: 2,
		primaryTeacher: {
			id: "TCH-005",
			teacherId: "TCH-005",
			teacherName: "Mr. James Wilson",
			teacherEmail: "james.wilson@springfield.edu",
			role: TeacherRole.PRIMARY,
			assignedAt: "2024-08-15T00:00:00Z",
			isActive: true
		},
		schedule: {
			days: [DayOfWeek.TUESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY],
			startTime: "11:00",
			endTime: "12:00",
			timezone: "America/New_York",
			sessionType: SessionType.REGULAR
		},
		room: {
			id: "RM-108",
			name: "Room 108",
			building: "Social Sciences Building",
			floor: 1,
			capacity: 30,
			type: RoomType.CLASSROOM,
			equipment: ["Projector", "Maps", "Document Camera"]
		},
		status: ClassroomStatus.ACTIVE,
		createdAt: "2024-08-11T00:00:00Z",
		updatedAt: "2024-10-05T00:00:00Z",
		createdBy: "TCH-005",
		tenantId: "TENANT-001",
		themeColor: "#8B5CF6",
		settings: {
			allowStudentEnrollment: true,
			requireApprovalForEnrollment: false,
			allowLateEnrollment: true,
			allowGuestAccess: false,
			enableDiscussions: true,
			enableAnnouncements: true,
			enableGradebook: true,
			enableAttendance: true,
			enableMessaging: true,
			enableFileSharing: true,
			enableVideoConferencing: false,
			enableParentAccess: true,
			notifications: {
				emailNotifications: true,
				pushNotifications: false,
				announcementAlerts: true,
				assignmentReminders: true,
				gradeUpdates: true,
				attendanceAlerts: false
			}
		}
	},
	{
		id: "CLS-2024-005",
		name: "Biology Advanced",
		code: "BIO-10A",
		description: "Advanced biology course covering cellular biology, genetics, evolution, and ecology with extensive laboratory investigations.",
		subject: "Science",
		grade: "10th Grade",
		gradeLevel: 10,
		academicYear: "2024-2025",
		semester: "Fall",
		capacity: 26,
		enrolled: 24,
		waitlistCount: 4,
		primaryTeacher: {
			id: "TCH-006",
			teacherId: "TCH-006",
			teacherName: "Dr. Lisa Anderson",
			teacherEmail: "lisa.anderson@springfield.edu",
			role: TeacherRole.PRIMARY,
			assignedAt: "2024-08-15T00:00:00Z",
			isActive: true
		},
		schedule: {
			days: [DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY],
			startTime: "14:00",
			endTime: "15:30",
			timezone: "America/New_York",
			sessionType: SessionType.LAB
		},
		room: {
			id: "LAB-201",
			name: "Biology Lab 201",
			building: "Science Building",
			floor: 2,
			capacity: 30,
			type: RoomType.LABORATORY,
			equipment: ["Microscopes", "Lab Equipment", "Safety Equipment", "Computers"]
		},
		status: ClassroomStatus.ACTIVE,
		createdAt: "2024-08-13T00:00:00Z",
		updatedAt: "2024-10-11T00:00:00Z",
		createdBy: "TCH-006",
		tenantId: "TENANT-001",
		themeColor: "#EF4444",
		bannerImage: "/images/classrooms/biology-banner.jpg",
		settings: {
			allowStudentEnrollment: true,
			requireApprovalForEnrollment: true,
			allowLateEnrollment: false,
			allowGuestAccess: false,
			enableDiscussions: true,
			enableAnnouncements: true,
			enableGradebook: true,
			enableAttendance: true,
			enableMessaging: true,
			enableFileSharing: true,
			enableVideoConferencing: true,
			enableParentAccess: true,
			notifications: {
				emailNotifications: true,
				pushNotifications: true,
				announcementAlerts: true,
				assignmentReminders: true,
				gradeUpdates: true,
				attendanceAlerts: true
			}
		}
	}
];

export const mockStudentEnrollments: StudentEnrollment[] = [
	{
		id: "ENR-001",
		studentId: "STU-2024-1847",
		studentName: "Alex Thompson",
		studentEmail: "alex.thompson@student.springfield.edu",
		classroomId: "CLS-2024-001",
		enrolledAt: "2024-08-20T00:00:00Z",
		status: EnrollmentStatus.ENROLLED,
		grade: "A-",
		attendanceRate: 94,
		lastActivity: "2024-10-12T14:30:00Z",
		parentGuardians: [
			{
				id: "PRT-001",
				name: "Jennifer Thompson",
				email: "jennifer.thompson@email.com",
				phone: "(555) 234-5678",
				relationship: "Mother",
				isPrimary: true
			},
			{
				id: "PRT-002",
				name: "Mark Thompson",
				email: "mark.thompson@email.com",
				phone: "(555) 234-5679",
				relationship: "Father",
				isPrimary: false
			}
		]
	},
	{
		id: "ENR-002",
		studentId: "STU-2024-1856",
		studentName: "Sarah Johnson",
		studentEmail: "sarah.johnson@student.springfield.edu",
		classroomId: "CLS-2024-001",
		enrolledAt: "2024-08-22T00:00:00Z",
		status: EnrollmentStatus.ENROLLED,
		grade: "A",
		attendanceRate: 98,
		lastActivity: "2024-10-12T15:45:00Z"
	}
];

export const mockClassroomAnalytics: ClassroomAnalytics[] = [
	{
		classroomId: "CLS-2024-001",
		totalStudents: 28,
		averageGrade: 87.5,
		attendanceRate: 94.2,
		assignmentCompletionRate: 92.8,
		engagementScore: 88.5,
		topPerformers: [
			{
				studentId: "STU-2024-1856",
				studentName: "Sarah Johnson",
				grade: 95.5,
				attendance: 98,
				engagement: 92,
				trend: PerformanceTrend.IMPROVING
			},
			{
				studentId: "STU-2024-1847",
				studentName: "Alex Thompson",
				grade: 89.2,
				attendance: 94,
				engagement: 88,
				trend: PerformanceTrend.STABLE
			}
		],
		needsAttention: [
			{
				studentId: "STU-2024-1923",
				studentName: "Michael Davis",
				grade: 72.3,
				attendance: 78,
				engagement: 65,
				trend: PerformanceTrend.DECLINING
			}
		],
		recentActivity: [
			{
				id: "ACT-001",
				type: ActivityType.ASSIGNMENT_SUBMITTED,
				description: "Calculus Problem Set 3 submitted",
				userId: "STU-2024-1847",
				userName: "Alex Thompson",
				timestamp: "2024-10-12T14:30:00Z"
			},
			{
				id: "ACT-002",
				type: ActivityType.GRADE_POSTED,
				description: "Quiz 2 grades posted",
				userId: "TCH-001",
				userName: "Dr. Sarah Chen",
				timestamp: "2024-10-12T13:15:00Z"
			},
			{
				id: "ACT-003",
				type: ActivityType.ANNOUNCEMENT_CREATED,
				description: "Midterm exam schedule announced",
				userId: "TCH-001",
				userName: "Dr. Sarah Chen",
				timestamp: "2024-10-12T10:00:00Z"
			}
		]
	}
];

/**
 * Get classroom by ID
 */
export function getClassroomById(id: string): Classroom | undefined {
	return mockClassrooms.find(classroom => classroom.id === id);
}

/**
 * Get classrooms by teacher ID
 */
export function getClassroomsByTeacher(teacherId: string): Classroom[] {
	return mockClassrooms.filter(classroom => 
		classroom.primaryTeacher.teacherId === teacherId ||
		classroom.assistantTeachers?.some(teacher => teacher.teacherId === teacherId)
	);
}

/**
 * Get student enrollments for a classroom
 */
export function getEnrollmentsByClassroom(classroomId: string): StudentEnrollment[] {
	return mockStudentEnrollments.filter(enrollment => enrollment.classroomId === classroomId);
}

/**
 * Get classroom analytics by ID
 */
export function getClassroomAnalytics(classroomId: string): ClassroomAnalytics | undefined {
	return mockClassroomAnalytics.find(analytics => analytics.classroomId === classroomId);
}

/**
 * Search classrooms by query
 */
export function searchClassrooms(query: string): Classroom[] {
	const lowercaseQuery = query.toLowerCase();
	return mockClassrooms.filter(classroom =>
		classroom.name.toLowerCase().includes(lowercaseQuery) ||
		classroom.code.toLowerCase().includes(lowercaseQuery) ||
		classroom.subject.toLowerCase().includes(lowercaseQuery) ||
		classroom.primaryTeacher.teacherName.toLowerCase().includes(lowercaseQuery)
	);
}

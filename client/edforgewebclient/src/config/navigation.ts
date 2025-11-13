/**
 * EdForge EMIS - Navigation Configuration
 * 
 * This file defines the navigation structure for the dashboard with role-based permissions.
 * Each navigation item specifies which permissions are required to view it.
 */

import { NavItem, Permission } from "@/types/rbac";

export const DASHBOARD_NAVIGATION: NavItem[] = [
	{
		title: "Dashboard",
		url: "/dashboard",
		icon: "LayoutDashboard",
		isActive: true,
		// No permissions = visible to everyone
	},
	{
		title: "Students",
		url: "/dashboard/students",
		icon: "Users",
		permissions: [Permission.VIEW_STUDENTS, Permission.MANAGE_STUDENTS],
		items: [
			{
				title: "Enrollment",
				url: "/dashboard/students/enrollment",
				permissions: [Permission.MANAGE_STUDENTS],
			},
			{
				title: "All Students",
				url: "/dashboard/students",
				permissions: [Permission.VIEW_STUDENTS],
			}
		],
	},
	{
		title: "People",
		url: "/dashboard/people",
		icon: "Users",
		// TODO: Add permissions for staff members
		permissions: [Permission.VIEW_TEACHERS, Permission.MANAGE_TEACHERS],
		items: [
			{
				title: "Onboarding",
				url: "/dashboard/people/onboard",
				permissions: [Permission.VIEW_TEACHERS, Permission.MANAGE_TEACHERS],
			},
			{
				title: "All People",
				url: "/dashboard/people",
				permissions: [Permission.VIEW_TEACHERS],
			}
		],
	},
	{
		title: "Curriculum",
		url: "/dashboard/school",
		icon: "BookOpen",
		permissions: [Permission.MANAGE_CURRICULUM, Permission.MANAGE_COURSES],
		items: [
			{
				title: "Year Grades",
				url: "/dashboard/school/year-grades",
				permissions: [Permission.MANAGE_GRADES],
			},
			{
				title: "Classrooms",
				url: "/dashboard/school/classrooms",
				permissions: [Permission.MANAGE_CLASSES],
			},
			{
				title: "Departments",
				url: "/dashboard/school/departments",
				permissions: [Permission.MANAGE_CURRICULUM]
			},
			{
				title: "School Calendar",
				url: "/dashboard/school/calendar",
				permissions: [Permission.MANAGE_CURRICULUM],
			}
		],
	},
	{
		title: "Finance",
		url: "/dashboard/finance",
		icon: "DollarSign",
		permissions: [Permission.MANAGE_CURRICULUM, Permission.MANAGE_COURSES],
		items: [
			{
				title: "Budget",
				url: "/dashboard/finance/budget",
				permissions: [Permission.MANAGE_CURRICULUM],
			},
			{
				title: "School Fees",
				url: "/dashboard/finance/fees",
				permissions: [Permission.MANAGE_CURRICULUM],
			},
			{
				title: "School Supply",
				url: "/dashboard/finance/supply",
				permissions: [Permission.MANAGE_CURRICULUM]
			},
		],
	},
	{
		title: "Administration",
		url: "/dashboard/admin",
		icon: "Shield",
		permissions: [
			Permission.MANAGE_USERS,
			Permission.MANAGE_ROLES,
			Permission.MANAGE_INSTITUTION,
		],
		items: [
			{
				title: "School Settings",
				url: "/dashboard/admin/settings",
				permissions: [Permission.MANAGE_INSTITUTION],
			},
			{
				title: "User Management",
				url: "/dashboard/admin/users",
				permissions: [Permission.MANAGE_USERS],
			},
			{
				title: "Roles & Permissions",
				url: "/dashboard/admin/roles",
				permissions: [Permission.MANAGE_ROLES],
			},
			{
				title: "System Settings",
				url: "/dashboard/admin/system",
				permissions: [Permission.MANAGE_SYSTEM_SETTINGS],
			},
		],
	},
	{
		title: "Auth Debug",
		url: "/auth/info",
		icon: "Shield",
	},
];

/**
 * Quick actions that appear based on role
 */
export const QUICK_ACTIONS = [
	{
		title: "New Student",
		url: "/dashboard/students/new",
		icon: "UserPlus",
		permissions: [Permission.MANAGE_STUDENTS],
	},
	{
		title: "Take Attendance",
		url: "/dashboard/attendance/take",
		icon: "CheckSquare",
		permissions: [Permission.MANAGE_ATTENDANCE],
	},
	{
		title: "Grade Entry",
		url: "/dashboard/grades/entry",
		icon: "Edit",
		permissions: [Permission.MANAGE_GRADES],
	},
	{
		title: "Send Announcement",
		url: "/dashboard/announcements/create",
		icon: "Megaphone",
		permissions: [Permission.SEND_ANNOUNCEMENTS],
	},
];


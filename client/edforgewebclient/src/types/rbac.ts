/**
 * EdForge EMIS - Role-Based Access Control (RBAC) Type Definitions
 * 
 * This module defines the core types for the RBAC system including:
 * - User roles and permissions
 * - Navigation items and access control
 * - User profile structure
 * 
 * NOTE: Current implementation is temporary and allows all authenticated users
 * full access to POC features. Future implementation will use AWS Verified Permissions.
 * 
 * TODO Phase 2: Integrate with AWS Verified Permissions
 * - Fetch policies from User microservice
 * - Evaluate permissions using Cedar policies
 * - Support tenant-defined custom roles
 * 
 * See: RBAC_ARCHITECTURE.md for detailed implementation plan
 */

// ============================================
// User Roles
// ============================================

export enum UserRole {
	SUPER_ADMIN = "SUPER_ADMIN",
	TENANT_ADMIN = "TENANT_ADMIN",
	PRINCIPAL = "PRINCIPAL",
	TEACHER = "TEACHER",
	STUDENT = "STUDENT",
	PARENT = "PARENT",
}

// ============================================
// Permissions
// ============================================

export enum Permission {
	// System Administration
	MANAGE_TENANTS = "MANAGE_TENANTS",
	MANAGE_SYSTEM_SETTINGS = "MANAGE_SYSTEM_SETTINGS",
	VIEW_SYSTEM_ANALYTICS = "VIEW_SYSTEM_ANALYTICS",

	// Institution Management
	MANAGE_INSTITUTION = "MANAGE_INSTITUTION",
	MANAGE_USERS = "MANAGE_USERS",
	MANAGE_ROLES = "MANAGE_ROLES",
	VIEW_INSTITUTION_ANALYTICS = "VIEW_INSTITUTION_ANALYTICS",
	VIEW_SETTINGS = "VIEW_SETTINGS",

	// Academic Management
	MANAGE_CURRICULUM = "MANAGE_CURRICULUM",
	MANAGE_COURSES = "MANAGE_COURSES",
	MANAGE_CLASSES = "MANAGE_CLASSES",
	MANAGE_GRADES = "MANAGE_GRADES",
	VIEW_GRADES = "VIEW_GRADES",

	// Student Management
	MANAGE_STUDENTS = "MANAGE_STUDENTS",
	VIEW_STUDENTS = "VIEW_STUDENTS",
	VIEW_OWN_PROFILE = "VIEW_OWN_PROFILE",

	// Teacher Management
	MANAGE_TEACHERS = "MANAGE_TEACHERS",
	VIEW_TEACHERS = "VIEW_TEACHERS",

	// Attendance
	MANAGE_ATTENDANCE = "MANAGE_ATTENDANCE",
	VIEW_ATTENDANCE = "VIEW_ATTENDANCE",

	// Communication
	SEND_ANNOUNCEMENTS = "SEND_ANNOUNCEMENTS",
	VIEW_ANNOUNCEMENTS = "VIEW_ANNOUNCEMENTS",
	SEND_MESSAGES = "SEND_MESSAGES",

	// Reports
	GENERATE_REPORTS = "GENERATE_REPORTS",
	VIEW_REPORTS = "VIEW_REPORTS",

	// Parent Portal
	VIEW_CHILD_PROGRESS = "VIEW_CHILD_PROGRESS",
	VIEW_CHILD_ATTENDANCE = "VIEW_CHILD_ATTENDANCE",
	COMMUNICATE_WITH_TEACHERS = "COMMUNICATE_WITH_TEACHERS",
}

// ============================================
// Role Permissions Mapping
// ============================================

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
	[UserRole.SUPER_ADMIN]: [
		Permission.MANAGE_TENANTS,
		Permission.MANAGE_SYSTEM_SETTINGS,
		Permission.VIEW_SYSTEM_ANALYTICS,
		Permission.MANAGE_INSTITUTION,
		Permission.MANAGE_USERS,
		Permission.MANAGE_ROLES,
		Permission.VIEW_INSTITUTION_ANALYTICS,
		Permission.MANAGE_CURRICULUM,
		Permission.MANAGE_COURSES,
		Permission.MANAGE_CLASSES,
		Permission.MANAGE_GRADES,
		Permission.VIEW_GRADES,
		Permission.MANAGE_STUDENTS,
		Permission.VIEW_STUDENTS,
		Permission.MANAGE_TEACHERS,
		Permission.VIEW_TEACHERS,
		Permission.MANAGE_ATTENDANCE,
		Permission.VIEW_ATTENDANCE,
		Permission.SEND_ANNOUNCEMENTS,
		Permission.VIEW_ANNOUNCEMENTS,
		Permission.GENERATE_REPORTS,
		Permission.VIEW_REPORTS,
	],

	[UserRole.TENANT_ADMIN]: [
		Permission.MANAGE_INSTITUTION,
		Permission.MANAGE_USERS,
		Permission.MANAGE_ROLES,
		Permission.VIEW_INSTITUTION_ANALYTICS,
		Permission.MANAGE_CURRICULUM,
		Permission.MANAGE_COURSES,
		Permission.MANAGE_CLASSES,
		Permission.MANAGE_GRADES,
		Permission.VIEW_GRADES,
		Permission.MANAGE_STUDENTS,
		Permission.VIEW_STUDENTS,
		Permission.MANAGE_TEACHERS,
		Permission.VIEW_TEACHERS,
		Permission.MANAGE_ATTENDANCE,
		Permission.VIEW_ATTENDANCE,
		Permission.SEND_ANNOUNCEMENTS,
		Permission.VIEW_ANNOUNCEMENTS,
		Permission.GENERATE_REPORTS,
		Permission.VIEW_REPORTS,
	],

	[UserRole.PRINCIPAL]: [
		Permission.VIEW_INSTITUTION_ANALYTICS,
		Permission.MANAGE_CURRICULUM,
		Permission.MANAGE_COURSES,
		Permission.MANAGE_CLASSES,
		Permission.MANAGE_GRADES,
		Permission.VIEW_GRADES,
		Permission.MANAGE_STUDENTS,
		Permission.VIEW_STUDENTS,
		Permission.MANAGE_TEACHERS,
		Permission.VIEW_TEACHERS,
		Permission.MANAGE_ATTENDANCE,
		Permission.VIEW_ATTENDANCE,
		Permission.SEND_ANNOUNCEMENTS,
		Permission.VIEW_ANNOUNCEMENTS,
		Permission.GENERATE_REPORTS,
		Permission.VIEW_REPORTS,
	],

	[UserRole.TEACHER]: [
		Permission.VIEW_STUDENTS,
		Permission.MANAGE_GRADES,
		Permission.VIEW_GRADES,
		Permission.MANAGE_ATTENDANCE,
		Permission.VIEW_ATTENDANCE,
		Permission.VIEW_ANNOUNCEMENTS,
		Permission.SEND_MESSAGES,
		Permission.VIEW_REPORTS,
	],

	[UserRole.STUDENT]: [
		Permission.VIEW_OWN_PROFILE,
		Permission.VIEW_GRADES,
		Permission.VIEW_ATTENDANCE,
		Permission.VIEW_ANNOUNCEMENTS,
		Permission.SEND_MESSAGES,
	],

	[UserRole.PARENT]: [
		Permission.VIEW_CHILD_PROGRESS,
		Permission.VIEW_CHILD_ATTENDANCE,
		Permission.VIEW_ANNOUNCEMENTS,
		Permission.COMMUNICATE_WITH_TEACHERS,
		Permission.SEND_MESSAGES,
	],
};

// ============================================
// User Profile
// ============================================

export interface User {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	avatar?: string;
	tenantId: string;
	tenantName: string;
	metadata?: {
		department?: string;
		grade?: string;
		subjects?: string[];
		children?: Array<{
			id: string;
			name: string;
			grade: string;
		}>;
	};
}

// ============================================
// Navigation Item
// ============================================

export interface NavItem {
	title: string;
	url: string;
	icon?: string;
	isActive?: boolean;
	badge?: string | number;
	permissions?: Permission[];
	items?: NavSubItem[];
}

export interface NavSubItem {
	title: string;
	url: string;
	isActive?: boolean;
	permissions?: Permission[];
}

// ============================================
// Navigation Group
// ============================================

export interface NavGroup {
	title: string;
	items: NavItem[];
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if a user has a specific permission
 * 
 * TODO: This function is temporarily disabled - all users have all permissions
 * This will be re-enabled in a future phase with proper Cognito role mapping
 */
export function hasPermission(user: User, permission: Permission): boolean {
	// TODO: Re-enable permission checking
	// const rolePermissions = ROLE_PERMISSIONS[user.role];
	// return rolePermissions.includes(permission);
	
	// Temporary: All authenticated users have all permissions
	console.log(`[RBAC] Permission check: ${permission} for user ${user.id} - GRANTED (temporary)`);
	return true;
}

/**
 * Check if a user has any of the specified permissions
 * 
 * TODO: This function is temporarily disabled - all users have all permissions
 */
export function hasAnyPermission(
	user: User,
	permissions: Permission[],
): boolean {
	// TODO: Re-enable permission checking
	// return permissions.some((permission) => hasPermission(user, permission));
	
	// Temporary: All authenticated users have all permissions
	return true;
}

/**
 * Check if a user has all of the specified permissions
 * 
 * TODO: This function is temporarily disabled - all users have all permissions
 */
export function hasAllPermissions(
	user: User,
	permissions: Permission[],
): boolean {
	// TODO: Re-enable permission checking
	// return permissions.every((permission) => hasPermission(user, permission));
	
	// Temporary: All authenticated users have all permissions
	return true;
}

/**
 * Filter navigation items based on user permissions
 * 
 * TODO: This function is temporarily disabled - all navigation items are shown
 * This will be re-enabled in a future phase with proper Cognito role mapping
 */
export function filterNavItemsByPermissions(
	items: NavItem[],
	user: User,
): NavItem[] {
	// TODO: Re-enable navigation filtering
	// return items
	// 	.filter((item) => {
	// 		// If no permissions specified, show to everyone
	// 		if (!item.permissions || item.permissions.length === 0) {
	// 			return true;
	// 		}
	// 		// Check if user has any of the required permissions
	// 		return hasAnyPermission(user, item.permissions);
	// 	})
	// 	.map((item) => {
	// 		// Filter sub-items if they exist
	// 		if (item.items) {
	// 			return {
	// 				...item,
	// 				items: item.items.filter((subItem) => {
	// 					if (!subItem.permissions || subItem.permissions.length === 0) {
	// 						return true;
	// 					}
	// 					return hasAnyPermission(user, subItem.permissions);
	// 				}),
	// 			};
	// 		}
	// 		return item;
	// 	})
	// 	.filter((item) => {
	// 		// Remove parent items that have no visible sub-items
	// 		if (item.items) {
	// 			return item.items.length > 0;
	// 		}
	// 		return true;
	// 	});
	
	// Temporary: Show all navigation items to all users
	console.log(`[RBAC] Navigation filtering disabled - showing all items for user ${user.id}`);
	return items;
}

/**
 * Get role display name
 */
export function getRoleDisplayName(role: UserRole): string {
	const displayNames: Record<UserRole, string> = {
		[UserRole.SUPER_ADMIN]: "Super Administrator",
		[UserRole.TENANT_ADMIN]: "Institution Administrator",
		[UserRole.PRINCIPAL]: "Principal",
		[UserRole.TEACHER]: "Teacher",
		[UserRole.STUDENT]: "Student",
		[UserRole.PARENT]: "Parent",
	};
	return displayNames[role];
}

/**
 * Get role color for UI display
 */
export function getRoleColor(role: UserRole): string {
	const colors: Record<UserRole, string> = {
		[UserRole.SUPER_ADMIN]: "text-destructive",
		[UserRole.TENANT_ADMIN]: "text-primary",
		[UserRole.PRINCIPAL]: "text-secondary",
		[UserRole.TEACHER]: "text-accent",
		[UserRole.STUDENT]: "text-info",
		[UserRole.PARENT]: "text-warning",
	};
	return colors[role];
}


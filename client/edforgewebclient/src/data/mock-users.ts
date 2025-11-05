/**
 * EdForge EMIS - Mock User Data for RBAC Testing
 * 
 * This file contains hardcoded user data for testing the Role-Based Access Control system.
 * In production, this would be replaced with actual authentication and database queries.
 */

import { User, UserRole } from "@/types/rbac";

export const MOCK_USERS: User[] = [
	{
		id: "user-1",
		name: "Sarah Johnson",
		email: "sarah.johnson@edforge.io",
		role: UserRole.TENANT_ADMIN,
		avatar: "SJ",
		tenantId: "tenant-001",
		tenantName: "Springfield High School",
		metadata: {
			department: "Administration",
		},
	},
	{
		id: "user-2",
		name: "Dr. Michael Chen",
		email: "michael.chen@edforge.io",
		role: UserRole.PRINCIPAL,
		avatar: "MC",
		tenantId: "tenant-001",
		tenantName: "Springfield High School",
		metadata: {
			department: "Administration",
		},
	},
	{
		id: "user-3",
		name: "Emma Rodriguez",
		email: "emma.rodriguez@edforge.io",
		role: UserRole.TEACHER,
		avatar: "ER",
		tenantId: "tenant-001",
		tenantName: "Springfield High School",
		metadata: {
			department: "Mathematics",
			subjects: ["Algebra", "Geometry", "Calculus"],
		},
	},
	{
		id: "user-4",
		name: "Alex Thompson",
		email: "alex.thompson@student.edforge.io",
		role: UserRole.STUDENT,
		avatar: "AT",
		tenantId: "tenant-001",
		tenantName: "Springfield High School",
		metadata: {
			grade: "Grade 11",
		},
	},
	{
		id: "user-5",
		name: "Jessica Williams",
		email: "jessica.williams@parent.edforge.io",
		role: UserRole.PARENT,
		avatar: "JW",
		tenantId: "tenant-001",
		tenantName: "Springfield High School",
		metadata: {
			children: [
				{
					id: "student-1",
					name: "Emily Williams",
					grade: "Grade 9",
				},
				{
					id: "student-2",
					name: "James Williams",
					grade: "Grade 7",
				},
			],
		},
	},
	{
		id: "user-6",
		name: "David Martinez",
		email: "david.martinez@edforge.io",
		role: UserRole.TEACHER,
		avatar: "DM",
		tenantId: "tenant-001",
		tenantName: "Springfield High School",
		metadata: {
			department: "Science",
			subjects: ["Physics", "Chemistry"],
		},
	},
];

/**
 * Get user by ID
 */
export function getUserById(userId: string): User | undefined {
	return MOCK_USERS.find((user) => user.id === userId);
}

/**
 * Get users by role
 */
export function getUsersByRole(role: UserRole): User[] {
	return MOCK_USERS.filter((user) => user.role === role);
}

/**
 * Get users by tenant
 */
export function getUsersByTenant(tenantId: string): User[] {
	return MOCK_USERS.filter((user) => user.tenantId === tenantId);
}

/**
 * Simulate user authentication
 * In production, this would validate credentials against a database
 */
export function authenticateUser(
	email: string,
	password: string,
): User | null {
	// For demo purposes, any password works
	const user = MOCK_USERS.find((u) => u.email === email);
	return user || null;
}

/**
 * Get default user (for initial load)
 */
export function getDefaultUser(): User {
	return MOCK_USERS[0]; // Default to Tenant Admin
}


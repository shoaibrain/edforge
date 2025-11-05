/**
 * EdForge EMIS - Student Data Types
 * 
 * Comprehensive type definitions for student profiles, academic records,
 * and performance tracking in the EMIS system.
 */

export interface StudentPerformanceData {
	category: string;
	score: number;
	maxScore: number;
	trend?: "up" | "down" | "stable";
	description?: string;
}

export interface StudentClass {
	id: string;
	name: string;
	teacher: string;
	room: string;
	schedule: string;
	credits: number;
	grade?: string;
	attendance: {
		present: number;
		absent: number;
		tardy: number;
		total: number;
	};
}

export interface StudentContact {
	type: "primary" | "emergency" | "guardian";
	name: string;
	relationship: string;
	phone: string;
	email?: string;
	address?: string;
}

export interface StudentMedical {
	bloodType?: string;
	allergies?: string[];
	medications?: string[];
	conditions?: string[];
	emergencyContact: string;
	insuranceProvider?: string;
}

export interface StudentProfile {
	// Basic Information
	studentId: string;
	firstName: string;
	lastName: string;
	dateOfBirth: string;
	gender: "male" | "female" | "other";
	grade: string;
	section?: string;
	
	// Academic Information
	academicYear: string;
	enrollmentDate: string;
	graduationDate?: string;
	status: "active" | "graduated" | "transferred" | "suspended";
	
	// Performance Data
	overallGPA: number;
	performanceData: StudentPerformanceData[];
	
	// Contact Information
	address: {
		street: string;
		city: string;
		state: string;
		zipCode: string;
		country: string;
	};
	contacts: StudentContact[];
	
	// Academic Details
	classes: StudentClass[];
	extracurriculars?: string[];
	awards?: string[];
	
	// Medical Information
	medical: StudentMedical;
	
	// System Information
	lastUpdated: string;
	createdAt: string;
	updatedBy: string;
}

export interface StudentFilters {
	grade?: string;
	status?: string;
	search?: string;
	sortBy?: "name" | "gpa" | "grade" | "enrollmentDate";
	sortOrder?: "asc" | "desc";
}

export interface StudentListResponse {
	students: StudentProfile[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

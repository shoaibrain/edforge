/**
 * EdForge EMIS - Academic Service Type Definitions
 * 
 * Type definitions for academic service API (classrooms, assignments, grades, attendance)
 * Re-exports core types from @edforge/shared-types and defines client-specific Request/Response types
 */

import type { 
  CreateClassroomDto, 
  UpdateClassroomDto, 
  CreateAssignmentDto, 
  UpdateAssignmentDto, 
  CreateGradeDto, 
  UpdateGradeDto,
  AttendanceRecord,
  Classroom,
  Assignment,
  Grade
} from '@edforge/shared-types';

// Re-export core entity types from shared-types
export type {
  Classroom,
  ClassSchedule,
  Assignment,
  AssignmentAttachment,
  Grade,
  AttendanceRecord,
  AttendanceSummary,
  StreamPost,
  PostAttachment,
  PostComment,
} from '@edforge/shared-types';

// Re-export DTO types from shared-types
export type {
  CreateClassroomDto,
  UpdateClassroomDto,
  CreateAssignmentDto,
  UpdateAssignmentDto,
  CreateGradeDto,
  UpdateGradeDto,
  CreateStreamPostDto,
  UpdateStreamPostDto,
  CreatePostCommentDto,
  UpdatePostCommentDto,
  EnrollStudentDto,
} from '@edforge/shared-types';

/**
 * Client-specific type aliases for backward compatibility
 * These map to the shared-types but may have slight differences in naming
 */
export type Attendance = AttendanceRecord;
export type StudentEnrollment = {
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  enrolledAt: string;
  status: 'enrolled' | 'pending' | 'waitlisted' | 'dropped' | 'transferred';
  createdAt: string;
  updatedAt: string;
};

/**
 * Client-specific Request types for API operations
 * These extend or alias the DTOs from shared-types
 */
// Re-export DTOs as Request types for backward compatibility
export type CreateClassroomRequest = CreateClassroomDto;
export type UpdateClassroomRequest = UpdateClassroomDto;
export type CreateAssignmentRequest = CreateAssignmentDto;
export type UpdateAssignmentRequest = UpdateAssignmentDto;
export type CreateGradeRequest = CreateGradeDto;
export type UpdateGradeRequest = UpdateGradeDto;

export interface MarkAttendanceRequest {
  studentId: string;
  date: string;
  status: Attendance['status'];
  notes?: string;
}

export interface EnrollStudentRequest {
  studentId: string;
}

/**
 * Response types for API operations
 */
export interface ClassroomListResponse {
  classrooms: Classroom[];
  total?: number;
}

export interface AssignmentListResponse {
  assignments: Assignment[];
  total?: number;
}

export interface GradeListResponse {
  grades: Grade[];
  total?: number;
}

export interface AttendanceListResponse {
  attendanceRecords: Attendance[];
  total?: number;
}

export interface EnrollmentListResponse {
  enrollments: StudentEnrollment[];
  total?: number;
}


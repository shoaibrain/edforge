/**
 * EdForge EMIS - Services Index
 * 
 * Central export point for all services and types
 */

// Services (Client-side only - no server-only imports)
export { UserService, userService } from './user-service';
export { SchoolService, schoolService } from './school-service';
export { AcademicService, academicService } from './academic-service';
export { BaseService } from './base-service';

// Server-side services - import these ONLY in server components
// Example: import { serverUserService } from '@/services/user-service-server'

// Re-export types
export type * from '@/types/user';
export type * from '@edforge/shared-types';
// Note: academic.ts re-exports from @edforge/shared-types, so we export it separately
// to include client-specific Request/Response types without duplication
export type {
  CreateClassroomRequest,
  UpdateClassroomRequest,
  CreateAssignmentRequest,
  UpdateAssignmentRequest,
  CreateGradeRequest,
  UpdateGradeRequest,
  MarkAttendanceRequest,
  EnrollStudentRequest,
  ClassroomListResponse,
  AssignmentListResponse,
  GradeListResponse,
  AttendanceListResponse,
  EnrollmentListResponse,
  StudentEnrollment,
} from '@/types/academic';
export type * from '@/types/api';


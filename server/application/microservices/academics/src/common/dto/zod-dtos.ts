/**
 * Zod-based DTOs for Academics Service
 * 
 * This file creates NestJS-compatible DTO classes from Zod schemas.
 * Use these DTOs in controllers for automatic validation.
 * 
 * The schemas are defined in @edforge/shared-types and are the
 * single source of truth for data validation.
 */

import { createZodDto } from 'nestjs-zod';
import {
  // Student schemas
  createStudentSchema,
  updateStudentSchema,
  studentFilterSchema,
  
  // Classroom schemas
  createClassroomSchema,
  updateClassroomSchema,
  enrollStudentInClassSchema,
  bulkEnrollStudentsSchema,
  classroomFilterSchema,
  
  // Attendance schemas
  createAttendanceSchema,
  updateAttendanceSchema,
  bulkAttendanceSchema,
  attendanceFilterSchema,
  
  // Grade schemas
  createGradeSchema,
  updateGradeSchema,
  bulkGradeSchema,
  gradeFilterSchema,
  createGradingScaleSchema,
  createGradeCategorySchema,
  updateGradeCategorySchema,
  
  // Assignment schemas
  createAssignmentSchema,
  updateAssignmentSchema,
  assignmentFilterSchema,
  studentSubmissionSchema,
  
  // Course schemas
  createCourseSchema,
  updateCourseSchema,
  courseFilterSchema,

  // Section schemas
  createSectionSchema,
  updateSectionSchema,
  sectionFilterSchema,
  enrollStudentInSectionSchema,

  // Enrollment schemas
  createEnrollmentSchema,
  updateEnrollmentSchema,
  updateEnrollmentStatusSchema,
  withdrawStudentSchema,
  transferStudentSchema,
  transferEnrollmentSchema,
  enrollmentFilterSchema,
  
  // Staff schemas
  createStaffSchema,
  updateStaffSchema,
  staffFilterSchema,
  
  // Parent schemas
  createParentSchema,
  updateParentSchema,
} from '@edforge/shared-types';

// ============================================
// Re-export response types from shared-types
// These are used for type annotations, not for validation
// ============================================
export type {
  // Student types
  CreateStudentDto,
  UpdateStudentDto,
  StudentResponseDto,
  StudentListResponseDto,
  StudentFilterDto,
  StudentProfileResponseDto,
  
  // Classroom types
  CreateClassroomDto,
  UpdateClassroomDto,
  ClassroomResponseDto,
  ClassroomListResponseDto,
  EnrollStudentInClassDto,
  BulkEnrollStudentsDto,
  ClassroomFilterDto,
  
  // Attendance types
  CreateAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  AttendanceListResponseDto,
  BulkAttendanceDto,
  BulkAttendanceResponseDto,
  AttendanceFilterDto,
  AttendanceSummaryDto,
  DailyAttendanceReportDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
  
  // Grade types
  CreateGradeDto,
  UpdateGradeDto,
  GradeResponseDto,
  GradeListResponseDto,
  BulkGradeDto,
  GradeFilterDto,
  CreateGradingScaleDto,
  CreateGradeCategoryDto,
  UpdateGradeCategoryDto,
  StudentGradeSummaryDto,
  
  // Assignment types
  CreateAssignmentDto,
  UpdateAssignmentDto,
  AssignmentResponseDto,
  AssignmentListResponseDto,
  AssignmentFilterDto,
  StudentSubmissionDto,
  
  // Enrollment types
  CreateEnrollmentDto,
  UpdateEnrollmentDto,
  UpdateEnrollmentStatusDto,
  WithdrawStudentDto,
  TransferStudentDto,
  TransferEnrollmentDto,
  EnrollmentResponseDto,
  EnrollmentListResponseDto,
  EnrollmentFilterDto,
  EnrollmentSummaryDto,
  
  // Staff types
  CreateStaffDto,
  UpdateStaffDto,
  StaffResponseDto,
  StaffListResponseDto,
  StaffFilterDto,
  
  // Course types
  CreateCourseDto,
  UpdateCourseDto,
  CourseResponseDto,
  CourseListResponseDto,
  CourseFilterDto,

  // Section types
  CreateSectionDto,
  UpdateSectionDto,
  SectionResponseDto,
  SectionListResponseDto,
  SectionFilterDto,

  // Parent types
  CreateParentDto,
  UpdateParentDto,
  ParentResponseDto,
  ParentListResponseDto,
} from '@edforge/shared-types';

// ============================================
// Backward Compatibility Type Aliases
// Map old DTO names to new Zod-based names
// ============================================

/** @deprecated Use CreateAttendanceDto instead */
export type RecordAttendanceDto = import('@edforge/shared-types').CreateAttendanceDto;

// ============================================
// Student DTOs
// ============================================

export class CreateStudentDtoZ extends createZodDto(createStudentSchema) {}
export class UpdateStudentDtoZ extends createZodDto(updateStudentSchema) {}
export class StudentFilterDtoZ extends createZodDto(studentFilterSchema) {}

// ============================================
// Classroom DTOs
// ============================================

export class CreateClassroomDtoZ extends createZodDto(createClassroomSchema) {}
export class UpdateClassroomDtoZ extends createZodDto(updateClassroomSchema) {}
export class EnrollStudentInClassDtoZ extends createZodDto(enrollStudentInClassSchema) {}
export class BulkEnrollStudentsDtoZ extends createZodDto(bulkEnrollStudentsSchema) {}
export class ClassroomFilterDtoZ extends createZodDto(classroomFilterSchema) {}

// ============================================
// Attendance DTOs
// ============================================

export class CreateAttendanceDtoZ extends createZodDto(createAttendanceSchema) {}
export class UpdateAttendanceDtoZ extends createZodDto(updateAttendanceSchema) {}
export class BulkAttendanceDtoZ extends createZodDto(bulkAttendanceSchema) {}
export class AttendanceFilterDtoZ extends createZodDto(attendanceFilterSchema) {}

// ============================================
// Grade DTOs
// ============================================

export class CreateGradeDtoZ extends createZodDto(createGradeSchema) {}
export class UpdateGradeDtoZ extends createZodDto(updateGradeSchema) {}
export class BulkGradeDtoZ extends createZodDto(bulkGradeSchema) {}
export class GradeFilterDtoZ extends createZodDto(gradeFilterSchema) {}
export class CreateGradingScaleDtoZ extends createZodDto(createGradingScaleSchema) {}
export class CreateGradeCategoryDtoZ extends createZodDto(createGradeCategorySchema) {}
export class UpdateGradeCategoryDtoZ extends createZodDto(updateGradeCategorySchema) {}

// ============================================
// Assignment DTOs
// ============================================

export class CreateAssignmentDtoZ extends createZodDto(createAssignmentSchema) {}
export class UpdateAssignmentDtoZ extends createZodDto(updateAssignmentSchema) {}
export class AssignmentFilterDtoZ extends createZodDto(assignmentFilterSchema) {}
export class StudentSubmissionDtoZ extends createZodDto(studentSubmissionSchema) {}

// ============================================
// Enrollment DTOs
// ============================================

export class CreateEnrollmentDtoZ extends createZodDto(createEnrollmentSchema) {}
export class UpdateEnrollmentDtoZ extends createZodDto(updateEnrollmentSchema) {}
export class UpdateEnrollmentStatusDtoZ extends createZodDto(updateEnrollmentStatusSchema) {}
export class WithdrawStudentDtoZ extends createZodDto(withdrawStudentSchema) {}
export class TransferStudentDtoZ extends createZodDto(transferStudentSchema) {}
export class TransferEnrollmentDtoZ extends createZodDto(transferEnrollmentSchema) {}
export class EnrollmentFilterDtoZ extends createZodDto(enrollmentFilterSchema) {}

// ============================================
// Staff DTOs
// ============================================

export class CreateStaffDtoZ extends createZodDto(createStaffSchema) {}
export class UpdateStaffDtoZ extends createZodDto(updateStaffSchema) {}
export class StaffFilterDtoZ extends createZodDto(staffFilterSchema) {}

// ============================================
// Parent DTOs
// ============================================

export class CreateParentDtoZ extends createZodDto(createParentSchema) {}
export class UpdateParentDtoZ extends createZodDto(updateParentSchema) {}

// ============================================
// Course DTOs
// ============================================

export class CreateCourseDtoZ extends createZodDto(createCourseSchema) {}
export class UpdateCourseDtoZ extends createZodDto(updateCourseSchema) {}
export class CourseFilterDtoZ extends createZodDto(courseFilterSchema) {}

// ============================================
// Section DTOs
// ============================================

export class CreateSectionDtoZ extends createZodDto(createSectionSchema) {}
export class UpdateSectionDtoZ extends createZodDto(updateSectionSchema) {}
export class SectionFilterDtoZ extends createZodDto(sectionFilterSchema) {}
export class EnrollStudentInSectionDtoZ extends createZodDto(enrollStudentInSectionSchema) {}

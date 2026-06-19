/**
 * Zod-based DTOs for Academics Service
 * 
 * This file creates NestJS-compatible DTO classes from Zod schemas.
 * Use these DTOs in controllers for automatic validation.
 * 
 * The schemas are defined in @aibrains/shared-types and are the
 * single source of truth for data validation.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  // Student schemas
  createStudentSchema,
  updateStudentSchema,
  studentFilterSchema,
  studentDescriptorPatchSchema,
  
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
  recordDailyAttendanceSchema,
  
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
  designateHomeroomSchema,

  // CourseOffering schemas
  createCourseOfferingSchema,
  updateCourseOfferingSchema,
  courseOfferingFilterSchema,

  // Exam schemas (Sprint A.3)
  createExamSchema,
  updateExamSchema,
  examFilterSchema,
  examStatusTransitionSchema,
  createExamCourseSchema,
  updateExamCourseSchema,
  examCourseFilterSchema,
  createExamScoreSchema,
  updateExamScoreSchema,
  bulkExamScoreSchema,
  examScoreFilterSchema,

  // ResultCard schemas (Sprint A.4)
  updateResultCardConductSchema,
  updateResultCardRemarkSchema,
  resultCardPublishSchema,
  resultCardFilterSchema,

  // Enrollment schemas
  createEnrollmentSchema,
  updateEnrollmentSchema,
  updateEnrollmentStatusSchema,
  withdrawStudentSchema,
  transferStudentSchema,
  transferEnrollmentSchema,
  enrollmentFilterSchema,
  closeYearSchema,

  // PromotionRule schemas (Sprint D.2)
  createPromotionRuleSchema,
  updatePromotionRuleSchema,
  promotionRuleFilterSchema,

  // Promotion evaluation + commit (Sprint D.2 Phase 3)
  promotionEvaluationRequestSchema,
  promotionCommitRequestSchema,
  
  // Staff schemas
  createStaffSchema,
  updateStaffSchema,
  staffFilterSchema,
  
  // Parent schemas
  createParentSchema,
  updateParentSchema,
} from '@aibrains/shared-types';

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
  CloseYearDto,

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

  // CourseOffering types
  CreateCourseOfferingDto,
  UpdateCourseOfferingDto,
  CourseOfferingResponseDto,
  CourseOfferingListResponseDto,
  CourseOfferingFilterDto,

  // Parent types
  CreateParentDto,
  UpdateParentDto,
  ParentResponseDto,
  ParentListResponseDto,
} from '@aibrains/shared-types';

// ============================================
// Backward Compatibility Type Aliases
// Map old DTO names to new Zod-based names
// ============================================

/** @deprecated Use CreateAttendanceDto instead */
export type RecordAttendanceDto = import('@aibrains/shared-types').CreateAttendanceDto;

// ============================================
// Student DTOs
// ============================================

export class CreateStudentDtoZ extends createZodDto(createStudentSchema) {}
export class UpdateStudentDtoZ extends createZodDto(updateStudentSchema) {}
export class StudentFilterDtoZ extends createZodDto(studentFilterSchema) {}
export class StudentDescriptorPatchDtoZ extends createZodDto(studentDescriptorPatchSchema) {}

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
export class RecordDailyAttendanceDtoZ extends createZodDto(recordDailyAttendanceSchema) {}

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
export class CloseYearDtoZ extends createZodDto(closeYearSchema) {}

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
export class DesignateHomeroomDtoZ extends createZodDto(designateHomeroomSchema) {}
export class EnrollStudentInSectionDtoZ extends createZodDto(enrollStudentInSectionSchema) {}

// Local (academics-only) schema for bulk homeroom assignment. Kept out of
// @aibrains/shared-types deliberately — no AdminWeb/cross-service consumer
// needs it, so it doesn't warrant a package publish. Cap mirrors the
// DynamoDB transactWrite 100-item ceiling that gates the per-student loop.
export const bulkAssignHomeroomSchema = z.object({
  schoolId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
});
export class BulkAssignHomeroomDtoZ extends createZodDto(bulkAssignHomeroomSchema) {}

// ============================================
// CourseOffering DTOs
// ============================================

export class CreateCourseOfferingDtoZ extends createZodDto(createCourseOfferingSchema) {}
export class UpdateCourseOfferingDtoZ extends createZodDto(updateCourseOfferingSchema) {}
export class CourseOfferingFilterDtoZ extends createZodDto(courseOfferingFilterSchema) {}

// ============================================
// Exam DTOs (Sprint A.3)
// ============================================

export class CreateExamDtoZ extends createZodDto(createExamSchema) {}
export class UpdateExamDtoZ extends createZodDto(updateExamSchema) {}
export class ExamFilterDtoZ extends createZodDto(examFilterSchema) {}
export class ExamStatusTransitionDtoZ extends createZodDto(examStatusTransitionSchema) {}

export class CreateExamCourseDtoZ extends createZodDto(createExamCourseSchema) {}
export class UpdateExamCourseDtoZ extends createZodDto(updateExamCourseSchema) {}
export class ExamCourseFilterDtoZ extends createZodDto(examCourseFilterSchema) {}

export class CreateExamScoreDtoZ extends createZodDto(createExamScoreSchema) {}
export class UpdateExamScoreDtoZ extends createZodDto(updateExamScoreSchema) {}
export class BulkExamScoreDtoZ extends createZodDto(bulkExamScoreSchema) {}
export class ExamScoreFilterDtoZ extends createZodDto(examScoreFilterSchema) {}

// ============================================
// ResultCard DTOs (Sprint A.4)
// ============================================

export class UpdateResultCardConductDtoZ extends createZodDto(updateResultCardConductSchema) {}
export class UpdateResultCardRemarkDtoZ extends createZodDto(updateResultCardRemarkSchema) {}
export class ResultCardPublishDtoZ extends createZodDto(resultCardPublishSchema) {}
export class ResultCardFilterDtoZ extends createZodDto(resultCardFilterSchema) {}

// ============================================
// PromotionRule DTOs (Sprint D.2)
// ============================================
// Used at the API boundary so the global ZodValidationPipe enforces
// createPromotionRuleSchema / updatePromotionRuleSchema before the
// controller method runs. Don't replace these with the TS-interface
// shapes from PromotionRulesService — that bypasses validation.

export class CreatePromotionRuleDtoZ extends createZodDto(createPromotionRuleSchema) {}
export class UpdatePromotionRuleDtoZ extends createZodDto(updatePromotionRuleSchema) {}
export class PromotionRuleFilterDtoZ extends createZodDto(promotionRuleFilterSchema) {}

// ============================================
// Promotion evaluation + commit DTOs (Sprint D.2 Phase 3)
// ============================================
// D.2.5 batch evaluation accepts optional enrollmentIds[] to restrict scope.
// D.2.6 commit accepts decisions[] with refined targetGradeLevel constraint
// + intra-request duplicate-enrollment guard (Z-schema enforces both).

export class PromotionEvaluationRequestDtoZ extends createZodDto(promotionEvaluationRequestSchema) {}
export class PromotionCommitRequestDtoZ extends createZodDto(promotionCommitRequestSchema) {}

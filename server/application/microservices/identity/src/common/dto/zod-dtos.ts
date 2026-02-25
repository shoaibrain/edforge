/**
 * Zod-based DTOs for Identity Service
 * 
 * This file creates NestJS-compatible DTO classes from Zod schemas.
 * Use these DTOs in controllers for automatic validation.
 * 
 * The schemas are defined in @aibrains/shared-types and are the
 * single source of truth for data validation.
 */

import { createZodDto } from 'nestjs-zod';
import {
  // User schemas
  createUserSchema,
  createParentAccountSchema,
  createStudentAccountSchema,
  updateUserSchema,
  updatePreferencesSchema,
  
  // Auth schemas
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  
  // Security schemas
  changePasswordSchema,
  mfaVerifySchema,
  mfaDisableSchema,
  
  // Tenant schemas
  updateTenantSchema,
  updateWorkspaceSettingsSchema,
  
  // School schemas
  createSchoolSchema,
  updateSchoolSchema,
  
  // Role schemas
  assignRoleSchema,
  updateRoleSchema,
  checkPermissionSchema,
  deactivateRoleSchema,
  changeGlobalRoleSchema,
  changeSchoolRoleSchema,
  
  // Session schemas
  revokeSessionSchema,
  revokeAllSessionsSchema,
  
  // Academic Year schemas
  createAcademicYearSchema,
  updateAcademicYearSchema,
  updateAcademicYearStatusSchema,
  createGradingPeriodSchema,
  updateGradingPeriodSchema,
  createHolidaySchema,
  bulkCreateHolidaysSchema,

  // Calendar schemas (Ed-Fi Calendar Domain)
  createCalendarSchema,
  updateCalendarSchema,
  createCalendarDateSchema,
  updateCalendarDateSchema,
  generateCalendarSchema,
  bulkUpdateCalendarDatesSchema,

  // Academic Session schemas (Ed-Fi Session)
  createAcademicSessionSchema,
  updateAcademicSessionSchema,

  // Department schemas
  createDepartmentSchema,
  updateDepartmentSchema,
  updateSchoolConfigSchema,

  // Staff schemas
  createStaffSchema,
  updateStaffSchema,
  assignStaffToSchoolSchema,
  updateEmploymentStatusSchema,
  staffFilterSchema,
  createStaffWithUserSchema,

  // Staff Assignment schemas
  createStaffAssignmentSchema,
  updateStaffAssignmentSchema,

  // Education Organization schemas
  createStateEducationAgencySchema,
  updateStateEducationAgencySchema,
  createLocalEducationAgencySchema,
  updateLocalEducationAgencySchema,
  leaFilterSchema,
  createEducationServiceCenterSchema,
  updateEducationServiceCenterSchema,
  escFilterSchema,

  // Network schemas
  createEducationOrgNetworkSchema,
  updateEducationOrgNetworkSchema,
  networkFilterSchema,
  createNetworkAssociationSchema,
  updateNetworkAssociationSchema,

  // Class Period schemas (Ed-Fi Master Schedule)
  createClassPeriodSchema,
  updateClassPeriodSchema,

  // Bell Schedule schemas (Ed-Fi Master Schedule)
  createBellScheduleSchema,
  updateBellScheduleSchema,

  // Location schemas (Ed-Fi Master Schedule)
  createLocationSchema,
  updateLocationSchema,
} from '@aibrains/shared-types';

// ============================================
// User DTOs
// ============================================

export class CreateUserDtoZ extends createZodDto(createUserSchema) {}
export class CreateParentAccountDtoZ extends createZodDto(createParentAccountSchema) {}
export class CreateStudentAccountDtoZ extends createZodDto(createStudentAccountSchema) {}
export class UpdateUserDtoZ extends createZodDto(updateUserSchema) {}
export class UpdatePreferencesDtoZ extends createZodDto(updatePreferencesSchema) {}

// ============================================
// Auth DTOs
// ============================================

export class LoginDtoZ extends createZodDto(loginSchema) {}
export class RefreshTokenDtoZ extends createZodDto(refreshTokenSchema) {}
export class LogoutDtoZ extends createZodDto(logoutSchema) {}
export class ForgotPasswordDtoZ extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDtoZ extends createZodDto(resetPasswordSchema) {}

// ============================================
// Security DTOs
// ============================================

export class ChangePasswordDtoZ extends createZodDto(changePasswordSchema) {}
export class MfaVerifyDtoZ extends createZodDto(mfaVerifySchema) {}
export class MfaDisableDtoZ extends createZodDto(mfaDisableSchema) {}

// ============================================
// Tenant DTOs
// ============================================

export class UpdateTenantDtoZ extends createZodDto(updateTenantSchema) {}
export class UpdateWorkspaceSettingsDtoZ extends createZodDto(updateWorkspaceSettingsSchema) {}

// ============================================
// School DTOs
// ============================================

export class CreateSchoolDtoZ extends createZodDto(createSchoolSchema) {}
export class UpdateSchoolDtoZ extends createZodDto(updateSchoolSchema) {}

// ============================================
// Role DTOs
// ============================================

export class AssignRoleDtoZ extends createZodDto(assignRoleSchema) {}
export class UpdateRoleDtoZ extends createZodDto(updateRoleSchema) {}
export class CheckPermissionDtoZ extends createZodDto(checkPermissionSchema) {}
export class DeactivateRoleDtoZ extends createZodDto(deactivateRoleSchema) {}
export class ChangeGlobalRoleDtoZ extends createZodDto(changeGlobalRoleSchema) {}
export class ChangeSchoolRoleDtoZ extends createZodDto(changeSchoolRoleSchema) {}

// ============================================
// Session DTOs
// ============================================

export class RevokeSessionDtoZ extends createZodDto(revokeSessionSchema) {}
export class RevokeAllSessionsDtoZ extends createZodDto(revokeAllSessionsSchema) {}

// ============================================
// Academic Year DTOs
// ============================================

export class CreateAcademicYearDtoZ extends createZodDto(createAcademicYearSchema) {}
export class UpdateAcademicYearDtoZ extends createZodDto(updateAcademicYearSchema) {}
export class UpdateAcademicYearStatusDtoZ extends createZodDto(updateAcademicYearStatusSchema) {}
export class CreateGradingPeriodDtoZ extends createZodDto(createGradingPeriodSchema) {}
export class UpdateGradingPeriodDtoZ extends createZodDto(updateGradingPeriodSchema) {}
export class CreateHolidayDtoZ extends createZodDto(createHolidaySchema) {}
export class BulkCreateHolidaysDtoZ extends createZodDto(bulkCreateHolidaysSchema) {}

// ============================================
// Calendar DTOs (Ed-Fi Calendar Domain)
// ============================================

export class CreateCalendarDtoZ extends createZodDto(createCalendarSchema) {}
export class UpdateCalendarDtoZ extends createZodDto(updateCalendarSchema) {}
export class CreateCalendarDateDtoZ extends createZodDto(createCalendarDateSchema) {}
export class UpdateCalendarDateDtoZ extends createZodDto(updateCalendarDateSchema) {}
export class GenerateCalendarDtoZ extends createZodDto(generateCalendarSchema) {}
export class BulkUpdateCalendarDatesDtoZ extends createZodDto(bulkUpdateCalendarDatesSchema) {}

// ============================================
// Academic Session DTOs (Ed-Fi Session)
// ============================================

export class CreateAcademicSessionDtoZ extends createZodDto(createAcademicSessionSchema) {}
export class UpdateAcademicSessionDtoZ extends createZodDto(updateAcademicSessionSchema) {}

// ============================================
// Class Period DTOs (Ed-Fi Master Schedule)
// ============================================

export class CreateClassPeriodDtoZ extends createZodDto(createClassPeriodSchema) {}
export class UpdateClassPeriodDtoZ extends createZodDto(updateClassPeriodSchema) {}

// ============================================
// Bell Schedule DTOs (Ed-Fi Master Schedule)
// ============================================

export class CreateBellScheduleDtoZ extends createZodDto(createBellScheduleSchema) {}
export class UpdateBellScheduleDtoZ extends createZodDto(updateBellScheduleSchema) {}

// ============================================
// Location DTOs (Ed-Fi Master Schedule)
// ============================================

export class CreateLocationDtoZ extends createZodDto(createLocationSchema) {}
export class UpdateLocationDtoZ extends createZodDto(updateLocationSchema) {}

// ============================================
// Department DTOs
// ============================================

export class CreateDepartmentDtoZ extends createZodDto(createDepartmentSchema) {}
export class UpdateDepartmentDtoZ extends createZodDto(updateDepartmentSchema) {}
export class UpdateSchoolConfigDtoZ extends createZodDto(updateSchoolConfigSchema) {}

// ============================================
// Staff DTOs
// ============================================

export class CreateStaffDtoZ extends createZodDto(createStaffSchema) {}
export class UpdateStaffDtoZ extends createZodDto(updateStaffSchema) {}
export class AssignStaffToSchoolDtoZ extends createZodDto(assignStaffToSchoolSchema) {}
export class UpdateEmploymentStatusDtoZ extends createZodDto(updateEmploymentStatusSchema) {}
export class StaffFilterDtoZ extends createZodDto(staffFilterSchema) {}
export class CreateStaffWithUserDtoZ extends createZodDto(createStaffWithUserSchema) {}

// ============================================
// Staff Assignment DTOs
// ============================================

export class CreateStaffAssignmentDtoZ extends createZodDto(createStaffAssignmentSchema) {}
export class UpdateStaffAssignmentDtoZ extends createZodDto(updateStaffAssignmentSchema) {}

// ============================================
// Education Organization DTOs
// ============================================

export class CreateSeaDtoZ extends createZodDto(createStateEducationAgencySchema) {}
export class UpdateSeaDtoZ extends createZodDto(updateStateEducationAgencySchema) {}
export class CreateLeaDtoZ extends createZodDto(createLocalEducationAgencySchema) {}
export class UpdateLeaDtoZ extends createZodDto(updateLocalEducationAgencySchema) {}
export class LeaFilterDtoZ extends createZodDto(leaFilterSchema) {}
export class CreateEscDtoZ extends createZodDto(createEducationServiceCenterSchema) {}
export class UpdateEscDtoZ extends createZodDto(updateEducationServiceCenterSchema) {}
export class EscFilterDtoZ extends createZodDto(escFilterSchema) {}

// ============================================
// Network DTOs
// ============================================

export class CreateNetworkDtoZ extends createZodDto(createEducationOrgNetworkSchema) {}
export class UpdateNetworkDtoZ extends createZodDto(updateEducationOrgNetworkSchema) {}
export class NetworkFilterDtoZ extends createZodDto(networkFilterSchema) {}
export class CreateNetworkAssociationDtoZ extends createZodDto(createNetworkAssociationSchema) {}
export class UpdateNetworkAssociationDtoZ extends createZodDto(updateNetworkAssociationSchema) {}


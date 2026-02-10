/**
 * Zod-based DTOs for Identity Service
 * 
 * This file creates NestJS-compatible DTO classes from Zod schemas.
 * Use these DTOs in controllers for automatic validation.
 * 
 * The schemas are defined in @edforge/shared-types and are the
 * single source of truth for data validation.
 */

import { createZodDto } from 'nestjs-zod';
import {
  // User schemas
  createUserSchema,
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
} from '@edforge/shared-types';

// ============================================
// User DTOs
// ============================================

export class CreateUserDtoZ extends createZodDto(createUserSchema) {}
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


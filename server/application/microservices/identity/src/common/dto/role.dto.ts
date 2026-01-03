/**
 * Role Assignment DTOs for Identity Service (ABAC)
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchoolRole, PermissionAction } from '../entities';

/**
 * Permission Override DTO - MUST be defined before classes that reference it
 */
export class PermissionOverrideDto {
  @IsString()
  @IsNotEmpty()
  resource: string;

  @IsEnum(['view', 'create', 'edit', 'delete', 'manage', 'approve', 'send', 'export'])
  @IsNotEmpty()
  action: PermissionAction;

  @IsEnum(['allow', 'deny'])
  @IsNotEmpty()
  effect: 'allow' | 'deny';
}

/**
 * Assign Role DTO
 */
export class AssignRoleDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsEnum(['Principal', 'VicePrincipal', 'Teacher', 'Accountant', 'Staff', 'Counselor', 'Nurse', 'Student', 'Parent'])
  @IsNotEmpty()
  role: SchoolRole;

  @IsString()
  @IsOptional()
  departmentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideDto)
  @IsOptional()
  permissionOverrides?: PermissionOverrideDto[];

  @IsString()
  @IsOptional()
  expiresAt?: string;
}

/**
 * Update Role DTO
 */
export class UpdateRoleDto {
  @IsEnum(['Principal', 'VicePrincipal', 'Teacher', 'Accountant', 'Staff', 'Counselor', 'Nurse', 'Student', 'Parent'])
  @IsOptional()
  role?: SchoolRole;

  @IsString()
  @IsOptional()
  departmentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideDto)
  @IsOptional()
  permissionOverrides?: PermissionOverrideDto[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  expiresAt?: string;
}

/**
 * Role Assignment Response DTO
 */
export class RoleAssignmentResponseDto {
  userId: string;
  schoolId: string;
  schoolName?: string;
  role: SchoolRole;
  departmentId?: string;
  permissionOverrides?: PermissionOverrideDto[];
  isActive: boolean;
  assignedAt: string;
  assignedBy: string;
  expiresAt?: string;
}

/**
 * User Roles Response DTO
 */
export class UserRolesResponseDto {
  userId: string;
  globalRole: string;
  schoolRoles: RoleAssignmentResponseDto[];
}

/**
 * Check Permission Request DTO
 */
export class CheckPermissionDto {
  @IsString()
  @IsNotEmpty()
  resource: string;

  @IsEnum(['view', 'create', 'edit', 'delete', 'manage', 'approve', 'send', 'export'])
  @IsNotEmpty()
  action: PermissionAction;

  @IsString()
  @IsOptional()
  schoolId?: string;
}

/**
 * Check Permission Response DTO
 */
export class CheckPermissionResponseDto {
  allowed: boolean;
  reason?: string;
}

/**
 * Deactivate Role DTO
 */
export class DeactivateRoleDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

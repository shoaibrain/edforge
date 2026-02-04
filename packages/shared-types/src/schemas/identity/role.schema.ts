/**
 * Role Assignment Schemas - Identity Service (ABAC)
 * 
 * Zod schemas for role-based access control DTOs.
 */

import { z } from 'zod';
import { isoDateSchema } from '../common';
import { globalRoleSchema } from './user.schema';

// ============================================
// Enums
// ============================================

export const permissionActionSchema = z.enum([
  'view',
  'create',
  'edit',
  'delete',
  'manage',
  'approve',
  'send',
  'export',
]);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const permissionEffectSchema = z.enum(['allow', 'deny']);
export type PermissionEffect = z.infer<typeof permissionEffectSchema>;

export const abacSchoolRoleSchema = z.enum([
  'Principal',
  'VicePrincipal',
  'Teacher',
  'Accountant',
  'Staff',
  'Counselor',
  'Nurse',
  'Student',
  'Parent',
]);
export type AbacSchoolRole = z.infer<typeof abacSchoolRoleSchema>;

// ============================================
// Permission Override Schema
// ============================================

export const permissionOverrideSchema = z.object({
  resource: z.string().min(1),
  action: permissionActionSchema,
  effect: permissionEffectSchema,
});

export type PermissionOverrideDto = z.infer<typeof permissionOverrideSchema>;

// ============================================
// Assign Role Schema
// ============================================

export const assignRoleSchema = z.object({
  schoolId: z.string().min(1),
  role: abacSchoolRoleSchema,
  departmentId: z.string().optional(),
  permissionOverrides: z.array(permissionOverrideSchema).optional(),
  expiresAt: isoDateSchema.optional(),
});

export type AssignRoleDto = z.infer<typeof assignRoleSchema>;

// ============================================
// Update Role Schema
// ============================================

export const updateRoleSchema = z.object({
  role: abacSchoolRoleSchema.optional(),
  departmentId: z.string().optional(),
  permissionOverrides: z.array(permissionOverrideSchema).optional(),
  isActive: z.boolean().optional(),
  expiresAt: isoDateSchema.optional(),
});

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

// ============================================
// Role Assignment Response Schema
// ============================================

export const roleAssignmentResponseSchema = z.object({
  userId: z.string(),
  schoolId: z.string(),
  schoolName: z.string().optional(),
  role: abacSchoolRoleSchema,
  departmentId: z.string().optional(),
  permissionOverrides: z.array(permissionOverrideSchema).optional(),
  isActive: z.boolean(),
  assignedAt: isoDateSchema,
  assignedBy: z.string(),
  expiresAt: isoDateSchema.optional(),
});

export type RoleAssignmentResponseDto = z.infer<typeof roleAssignmentResponseSchema>;

// ============================================
// User Roles Response Schema
// ============================================

export const userRolesResponseSchema = z.object({
  userId: z.string(),
  globalRole: z.string(),
  schoolRoles: z.array(roleAssignmentResponseSchema),
});

export type UserRolesResponseDto = z.infer<typeof userRolesResponseSchema>;

// ============================================
// Permission Check Schemas
// ============================================

export const checkPermissionSchema = z.object({
  resource: z.string().min(1),
  action: permissionActionSchema,
  schoolId: z.string().optional(),
});

export type CheckPermissionDto = z.infer<typeof checkPermissionSchema>;

export const checkPermissionResponseSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});

export type CheckPermissionResponseDto = z.infer<typeof checkPermissionResponseSchema>;

// ============================================
// Change Global Role Schema
// ============================================

export type GlobalRoleDto = z.infer<typeof globalRoleSchema>;

export const changeGlobalRoleSchema = z.object({
  globalRole: globalRoleSchema,
});

export type ChangeGlobalRoleDto = z.infer<typeof changeGlobalRoleSchema>;

export const changeGlobalRoleResponseSchema = z.object({
  userId: z.string(),
  previousRole: globalRoleSchema,
  newRole: globalRoleSchema,
  sessionsRevoked: z.number(),
});

export type ChangeGlobalRoleResponseDto = z.infer<typeof changeGlobalRoleResponseSchema>;

// ============================================
// Change School Role Schema
// ============================================

export const changeSchoolRoleSchema = z.object({
  newRole: abacSchoolRoleSchema,
  departmentId: z.string().optional(),
  permissionOverrides: z.array(permissionOverrideSchema).optional(),
  expiresAt: isoDateSchema.optional(),
});

export type ChangeSchoolRoleDto = z.infer<typeof changeSchoolRoleSchema>;

// ============================================
// Deactivate Role Schema
// ============================================

export const deactivateRoleSchema = z.object({
  reason: z.string().min(1),
});

export type DeactivateRoleDto = z.infer<typeof deactivateRoleSchema>;


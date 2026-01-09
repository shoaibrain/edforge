/**
 * User Schemas - Identity Service
 * 
 * Zod schemas for user management DTOs.
 * Single source of truth for user data shapes used by both frontend and backend.
 */

import { z } from 'zod';
import { 
  emailSchema, 
  phoneSchema, 
  urlSchema, 
  isoDateSchema,
  createPaginatedResponseSchema 
} from '../common';

// ============================================
// Enums
// ============================================

export const globalRoleSchema = z.enum(['TenantAdmin', 'StandardUser']);
export type GlobalRole = z.infer<typeof globalRoleSchema>;

export const userStatusSchema = z.enum(['active', 'inactive', 'pending', 'suspended', 'locked']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userStatusUpdateSchema = z.enum(['active', 'inactive', 'suspended']);
export type UserStatusUpdate = z.infer<typeof userStatusUpdateSchema>;

// ============================================
// Address Schema
// ============================================

export const userAddressSchema = z.object({
  street: z.string().max(100).optional(),
  street2: z.string().max(100).optional(),
  city: z.string().max(50).optional(),
  state: z.string().max(50).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(50).optional(),
});

export type UserAddressDto = z.infer<typeof userAddressSchema>;

// ============================================
// Create User Schema
// ============================================

export const createUserSchema = z.object({
  email: emailSchema,
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  middleName: z.string().max(50).optional(),
  phone: z.string().max(30).optional(),
  globalRole: globalRoleSchema.default('StandardUser').optional(),
  temporaryPassword: z.string().min(8).optional(),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;

// ============================================
// Update User Schema
// ============================================

export const updateUserSchema = z.object({
  firstName: z.string().min(2).max(50).optional(),
  lastName: z.string().min(2).max(50).optional(),
  middleName: z.string().max(50).optional(),
  displayName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  avatarUrl: urlSchema.optional(),
  address: userAddressSchema.optional(),
  status: userStatusUpdateSchema.optional(),
});

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

// ============================================
// User Response Schema
// ============================================

export const userResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  address: userAddressSchema.optional(),
  globalRole: globalRoleSchema,
  status: userStatusSchema,
  lastLoginAt: isoDateSchema.optional(),
  mfaEnabled: z.boolean().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type UserResponseDto = z.infer<typeof userResponseSchema>;

// ============================================
// User List Response Schema
// ============================================

export const userListResponseSchema = createPaginatedResponseSchema(userResponseSchema);
export type UserListResponseDto = z.infer<typeof userListResponseSchema>;

// ============================================
// Notification Schemas
// ============================================

export const digestFrequencySchema = z.enum(['immediate', 'daily', 'weekly', 'never']);
export type DigestFrequency = z.infer<typeof digestFrequencySchema>;

export const emailChannelSchema = z.object({
  enabled: z.boolean().default(true).optional(),
  digest: digestFrequencySchema.default('immediate').optional(),
});

export type EmailChannelDto = z.infer<typeof emailChannelSchema>;

export const pushChannelSchema = z.object({
  enabled: z.boolean().default(true).optional(),
});

export type PushChannelDto = z.infer<typeof pushChannelSchema>;

export const smsChannelSchema = z.object({
  enabled: z.boolean().default(false).optional(),
  phone: z.string().optional(),
});

export type SmsChannelDto = z.infer<typeof smsChannelSchema>;

export const notificationChannelsSchema = z.object({
  email: emailChannelSchema.optional(),
  push: pushChannelSchema.optional(),
  sms: smsChannelSchema.optional(),
});

export type NotificationChannelsDto = z.infer<typeof notificationChannelsSchema>;

export const notificationCategoriesSchema = z.object({
  announcements: z.boolean().default(true).optional(),
  attendance: z.boolean().default(true).optional(),
  grades: z.boolean().default(true).optional(),
  messages: z.boolean().default(true).optional(),
  calendar: z.boolean().default(true).optional(),
  billing: z.boolean().default(true).optional(),
  security: z.boolean().default(true).optional(), // Cannot be disabled
});

export type NotificationCategoriesDto = z.infer<typeof notificationCategoriesSchema>;

export const notificationPreferencesSchema = z.object({
  channels: notificationChannelsSchema.optional(),
  categories: notificationCategoriesSchema.optional(),
});

export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesSchema>;

// Flat notification structure for updates (frontend-aligned)
export const flatNotificationsSchema = z.object({
  email: z.boolean().optional(),
  push: z.boolean().optional(),
  sms: z.boolean().optional(),
  digest: digestFrequencySchema.optional(),
});

export type FlatNotificationsDto = z.infer<typeof flatNotificationsSchema>;

// ============================================
// User Preferences Schemas
// ============================================

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const timeFormatSchema = z.enum(['12h', '24h']);
export type TimeFormat = z.infer<typeof timeFormatSchema>;

export const weekStartSchema = z.enum(['sunday', 'monday']);
export type WeekStart = z.infer<typeof weekStartSchema>;

export const updatePreferencesSchema = z.object({
  theme: themeSchema.default('system').optional(),
  language: z.string().default('en-US').optional(),
  timezone: z.string().default('America/New_York').optional(),
  dateFormat: z.string().default('MM/DD/YYYY').optional(),
  timeFormat: timeFormatSchema.default('12h').optional(),
  weekStartsOn: weekStartSchema.default('sunday').optional(),
  notifications: flatNotificationsSchema.optional(),
  defaultSchoolId: z.string().optional(),
});

export type UpdatePreferencesDto = z.infer<typeof updatePreferencesSchema>;

export const userPreferencesResponseSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  theme: themeSchema,
  language: z.string(),
  timezone: z.string(),
  dateFormat: z.string(),
  timeFormat: timeFormatSchema,
  weekStartsOn: weekStartSchema,
  notifications: flatNotificationsSchema,
  defaultSchoolId: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  version: z.number().int().min(0),
});

export type UserPreferencesResponseDto = z.infer<typeof userPreferencesResponseSchema>;

// ============================================
// School Assignment Schemas
// ============================================

export const schoolRoleSchema = z.enum([
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

export type SchoolRole = z.infer<typeof schoolRoleSchema>;

export const schoolAssignmentSchema = z.object({
  schoolId: z.string(),
  schoolName: z.string(),
  role: z.string(), // Allow any string to support custom roles
});

export type SchoolAssignmentDto = z.infer<typeof schoolAssignmentSchema>;

export const userAssignmentsResponseSchema = z.object({
  userId: z.string(),
  assignments: z.array(schoolAssignmentSchema),
});

export type UserAssignmentsResponseDto = z.infer<typeof userAssignmentsResponseSchema>;

// ============================================
// Current User Profile Schema (GET /users/me)
// ============================================

export const currentUserProfileSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  address: userAddressSchema.optional(),
  globalRole: globalRoleSchema,
  status: userStatusSchema,
  tenantId: z.string(),
  tenantName: z.string().optional(),
  assignments: z.array(schoolAssignmentSchema),
  lastLoginAt: isoDateSchema.optional(),
  mfaEnabled: z.boolean().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type CurrentUserProfileDto = z.infer<typeof currentUserProfileSchema>;


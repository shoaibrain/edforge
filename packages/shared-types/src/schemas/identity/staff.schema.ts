/**
 * Staff Schemas - Identity Service
 * 
 * Zod schemas for staff management DTOs with Ed-Fi core fields alignment.
 * Ed-Fi Data Standard: https://docs.ed-fi.org/reference/data-exchange/data-standard/
 */

import { z } from 'zod';
import {
  emailSchema,
  phoneSchema,
  dateSchema,
  isoDateSchema,
  addressSchema,
  createPaginatedResponseSchema
} from '../common';
import { iemisStaffIdSchema } from '../../identity/iemis-codes';

// ============================================
// Enums (Ed-Fi aligned where applicable)
// ============================================

/**
 * Staff role within the organization
 */
export const staffRoleSchema = z.enum([
  'teacher',
  'principal',
  'vice_principal',
  'counselor',
  'librarian',
  'nurse',
  'admin_staff',
  'support_staff',
  'it_staff',
  'substitute',
  'contractor',
]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * Employment status (Ed-Fi: employmentStatusDescriptor)
 */
export const employmentStatusSchema = z.enum([
  'active',
  'on_leave',
  'suspended',
  'terminated',
  'retired',
  'resigned',
]);
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;

/**
 * Employment type
 */
export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'volunteer',
]);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

/**
 * Staff status in the system
 */
export const staffStatusSchema = z.enum([
  'active',
  'inactive',
  'pending',
]);
export type StaffStatus = z.infer<typeof staffStatusSchema>;

/**
 * Staff gender identity (Ed-Fi aligned)
 */
export const staffGenderSchema = z.enum([
  'male',
  'female',
  'non_binary',
  'prefer_not_to_say',
]);
export type StaffGender = z.infer<typeof staffGenderSchema>;

/**
 * Marital status — IEMIS Flash-II Staff register (Sprint 4 S4.1).
 *
 * Values mirror Nepal's CEHRD Staff module categories as of the 2082 xlsx.
 * `prefer_not_to_say` is an EdForge addition so UI can offer an opt-out
 * without forcing a category — CEHRD export path drops this to `null`.
 */
export const maritalStatusSchema = z.enum([
  'single',
  'married',
  'divorced',
  'widowed',
  'other',
  'prefer_not_to_say',
]);
export type MaritalStatus = z.infer<typeof maritalStatusSchema>;

/**
 * Staff appointment type — IEMIS Flash-II Staff register (Sprint 4 S4.1).
 *
 * Distinct from `employmentTypeSchema` (full_time / part_time / etc.) in
 * that this captures the CEHRD-specific appointment category used on the
 * Staff export (`permanent` vs `temporary` is what CEHRD reports on).
 */
export const appointmentTypeSchema = z.enum([
  'permanent',
  'temporary',
  'contract',
  'honorary',
  'volunteer',
]);
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

// ============================================
// Staff Address Schema (Ed-Fi aligned + Nepal extension)
// ============================================

/**
 * Ed-Fi-aligned staff address. Field names follow the Ed-Fi Data Standard
 * (`streetNumberName`, `stateAbbreviationDescriptor`, etc.). The four
 * Nepal-aware extension fields (Sprint A.2) are populated by PABSON-archetype
 * tenants via `<AddressFieldsNepal>` (Sprint A.8); GENERIC-archetype tenants
 * leave them undefined and use the Ed-Fi US-shaped fields.
 *
 * No NPL-conditional refinement is added — see addressSchema rationale in
 * `packages/shared-types/src/schemas/common.ts` and the divergence ADR
 * `docs/decisions/region-aware-forms-divergence.md`.
 */
export const staffAddressSchema = z.object({
  addressTypeDescriptor: z.enum(['home', 'mailing', 'work', 'temporary']).optional(),
  streetNumberName: z.string().max(150).optional(),  // Ed-Fi: streetNumberName
  apartmentRoomSuiteNumber: z.string().max(50).optional(),
  city: z.string().max(30).optional(),
  stateAbbreviationDescriptor: z.string().max(50).optional(),
  postalCode: z.string().max(17).optional(),
  country: z.string().max(50).optional(),

  // Nepal-aware extension fields (Sprint A.2) — optional for all archetypes.
  wardNumber: z.string().max(10).optional(),
  municipality: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
});
export type StaffAddress = z.infer<typeof staffAddressSchema>;

// ============================================
// Staff Electronic Mail (Ed-Fi aligned)
// ============================================

export const staffElectronicMailSchema = z.object({
  electronicMailAddress: emailSchema,
  electronicMailTypeDescriptor: z.enum(['work', 'personal', 'other']).optional(),
  primaryEmailAddressIndicator: z.boolean().optional(),
});
export type StaffElectronicMail = z.infer<typeof staffElectronicMailSchema>;

// ============================================
// Staff Telephone (Ed-Fi aligned)
// ============================================

export const staffTelephoneSchema = z.object({
  telephoneNumber: z.string().max(24),
  telephoneNumberTypeDescriptor: z.enum(['home', 'mobile', 'work', 'fax', 'emergency']).optional(),
  orderOfPriority: z.number().int().min(1).optional(),
});
export type StaffTelephone = z.infer<typeof staffTelephoneSchema>;

// ============================================
// Staff School Assignment
// ============================================

export const staffSchoolAssignmentSchema = z.object({
  schoolId: z.string().uuid(),
  schoolName: z.string().optional(),
  role: staffRoleSchema,
  departmentId: z.string().uuid().optional(),
  departmentName: z.string().max(100).optional(),  // Denormalized for display
  isPrimary: z.boolean().default(false),
  beginDate: dateSchema,
  endDate: dateSchema.optional(),
  positionTitle: z.string().max(100).optional(),
  fullTimeEquivalency: z.number().min(0).max(1).optional(), // Ed-Fi: FTE
});
export type StaffSchoolAssignment = z.infer<typeof staffSchoolAssignmentSchema>;

// ============================================
// Staff Emergency Contact
// ============================================

export const staffEmergencyContactSchema = z.object({
  name: z.string().min(1).max(100),
  relationship: z.string().max(50),
  phone: z.string().max(24),
  alternatePhone: z.string().max(24).optional(),
  email: emailSchema.optional(),
});
export type StaffEmergencyContact = z.infer<typeof staffEmergencyContactSchema>;

// ============================================
// Create Staff Schema
// ============================================

export const createStaffSchema = z.object({
  // User-Staff Bridge
  userId: z.string().uuid().optional(),                 // Linked Cognito user ID

  // Ed-Fi Core Fields
  staffUniqueId: z.string().min(1).max(50),           // Ed-Fi: staffUniqueId (employee number, state ID)
  firstName: z.string().min(1).max(75),                // Ed-Fi: firstName
  lastSurname: z.string().min(1).max(75),              // Ed-Fi: lastSurname
  middleName: z.string().max(75).optional(),           // Ed-Fi: middleName
  generationCodeSuffix: z.string().max(10).optional(), // Ed-Fi: generationCodeSuffix (Jr., Sr., III)
  maidenName: z.string().max(75).optional(),           // Ed-Fi: maidenName
  birthDate: dateSchema.optional(),                    // Ed-Fi: birthDate
  
  // Demographics (Ed-Fi aligned)
  gender: staffGenderSchema.optional(),
  hispanicLatinoEthnicity: z.boolean().optional(),     // Ed-Fi compliance
  
  // EdForge Extensions
  primarySchoolId: z.string().uuid(),                  // Primary school assignment
  role: staffRoleSchema,
  employmentType: employmentTypeSchema.default('full_time'),
  hireDate: dateSchema,
  
  // Contact Information
  email: emailSchema,
  phone: z.string().max(24).optional(),
  addresses: z.array(staffAddressSchema).optional(),
  telephones: z.array(staffTelephoneSchema).optional(),
  
  // Employment Details
  departmentId: z.string().uuid().optional(),   // FK to school's Department entity
  title: z.string().max(100).optional(),
  
  // Professional
  highlyQualifiedTeacher: z.boolean().optional(),      // Ed-Fi compliance
  yearsOfPriorTeachingExperience: z.number().int().min(0).optional(),
  yearsOfPriorProfessionalExperience: z.number().int().min(0).optional(),

  // Emergency
  emergencyContacts: z.array(staffEmergencyContactSchema).optional(),

  // ── IEMIS / CEHRD Flash-II Staff register (Sprint 4 S4.1) ──
  // All optional; required subset enforced at the export layer (Sprint 11).
  /** CEHRD-issued persistent staff identifier. Format placeholder per S4.6
   *  (see `iemisStaffIdSchema` — 16 digits today, spec TBC). */
  emisStaffId: iemisStaffIdSchema.optional(),
  /** ISO-3166 alpha-3 nationality code (e.g. `NPL`). Defaults to the
   *  tenant's country at the UI layer but the value itself is independent
   *  — a Nepali school may employ foreign teachers. */
  nationality: z.string().length(3).regex(/^[A-Z]{3}$/, {
    message: 'nationality must be an ISO-3166 alpha-3 country code (e.g. NPL)',
  }).optional(),
  maritalStatus: maritalStatusSchema.optional(),
  appointmentType: appointmentTypeSchema.optional(),
  /** Gregorian ISO date (`YYYY-MM-DD`). BS→AD conversion happens at the UI
   *  layer; the canonical storage form is Gregorian for Ed-Fi compatibility. */
  appointmentDate: dateSchema.optional(),
});

export type CreateStaffDto = z.infer<typeof createStaffSchema>;

// ============================================
// Update Staff Schema
// ============================================

export const updateStaffSchema = createStaffSchema.partial().omit({
  staffUniqueId: true,  // Cannot change unique ID
  primarySchoolId: true, // Use assignment endpoints
}).extend({
  employmentStatus: employmentStatusSchema.optional(),
  terminationDate: dateSchema.optional(),
  terminationReason: z.string().max(255).optional(),
  status: staffStatusSchema.optional(),
});

export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;

// ============================================
// Staff Response Schema
// ============================================

export const staffResponseSchema = z.object({
  // Identifiers
  staffId: z.string().uuid(),
  staffUniqueId: z.string(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid().optional(),                 // Linked Cognito user ID
  
  // Ed-Fi Core Demographics
  firstName: z.string(),
  lastSurname: z.string(),
  middleName: z.string().optional(),
  generationCodeSuffix: z.string().optional(),
  birthDate: z.string().optional(),
  gender: staffGenderSchema.optional(),
  
  // Contact
  email: z.string(),
  phone: z.string().optional(),
  addresses: z.array(staffAddressSchema).optional(),
  
  // Employment
  primarySchoolId: z.string().uuid(),
  primarySchoolName: z.string().optional(),
  schoolAssignments: z.array(staffSchoolAssignmentSchema).optional(),
  role: staffRoleSchema,
  employmentType: employmentTypeSchema,
  employmentStatus: employmentStatusSchema,
  hireDate: z.string(),
  terminationDate: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  departmentName: z.string().optional(),         // Denormalized for display
  title: z.string().optional(),

  // Professional
  highlyQualifiedTeacher: z.boolean().optional(),
  yearsOfPriorTeachingExperience: z.number().optional(),
  
  // System
  status: staffStatusSchema,
  credentialsCount: z.number().optional(),
  
  // Ed-Fi Compliance
  hispanicLatinoEthnicity: z.boolean().optional(),

  // ── IEMIS / CEHRD Flash-II Staff register (Sprint 4 S4.1) ──
  emisStaffId: z.string().optional(),
  nationality: z.string().optional(),
  maritalStatus: maritalStatusSchema.optional(),
  appointmentType: appointmentTypeSchema.optional(),
  appointmentDate: z.string().optional(),

  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StaffResponseDto = z.infer<typeof staffResponseSchema>;

// ============================================
// Staff List Response
// ============================================

export const staffListResponseSchema = createPaginatedResponseSchema(staffResponseSchema);
export type StaffListResponseDto = z.infer<typeof staffListResponseSchema>;

// ============================================
// Staff Filter Schema
// ============================================

export const staffFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  role: staffRoleSchema.optional(),
  employmentStatus: employmentStatusSchema.optional(),
  departmentId: z.string().uuid().optional(),
  search: z.string().optional(),  // Search by name, email
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type StaffFilterDto = z.infer<typeof staffFilterSchema>;

// ============================================
// Staff Assignment Schema (for multi-school)
// ============================================

export const assignStaffToSchoolSchema = z.object({
  schoolId: z.string().uuid(),
  role: staffRoleSchema,
  departmentId: z.string().uuid().optional(),    // FK to school's Department entity
  isPrimary: z.boolean().default(false),
  beginDate: dateSchema,
  endDate: dateSchema.optional(),
  positionTitle: z.string().max(100).optional(),
  fullTimeEquivalency: z.number().min(0).max(1).optional(),
});

export type AssignStaffToSchoolDto = z.infer<typeof assignStaffToSchoolSchema>;

// ============================================
// Employment Status Update
// ============================================

export const updateEmploymentStatusSchema = z.object({
  employmentStatus: employmentStatusSchema,
  effectiveDate: dateSchema,
  reason: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

export type UpdateEmploymentStatusDto = z.infer<typeof updateEmploymentStatusSchema>;

// ============================================
// Atomic Staff + User Creation
// ============================================

export const createStaffWithUserSchema = createStaffSchema.extend({
  // Cognito user fields
  temporaryPassword: z.string().min(8).max(256).optional(),
  globalRole: z.enum(['TenantAdmin', 'TenantUser']).default('TenantUser'),
  createUserAccount: z.boolean().default(true),
});

export type CreateStaffWithUserDto = z.infer<typeof createStaffWithUserSchema>;

export const staffWithUserResponseSchema = z.object({
  staff: staffResponseSchema,
  userId: z.string().uuid().optional(),
  userCreated: z.boolean(),
});

export type StaffWithUserResponseDto = z.infer<typeof staffWithUserResponseSchema>;

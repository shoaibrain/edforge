/**
 * Staff Entity - Identity Service
 *
 * DynamoDB Entity for Staff management with Ed-Fi alignment.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: STAFF#{staffId}
 *
 * GSI1 (School Staff Lookup — tenant-scoped):
 * - GSI1PK: TENANT#{tenantId}#SCHOOL#{schoolId}
 * - GSI1SK: STAFF#{staffId}
 *
 * GSI2 (Email Lookup):
 * - GSI2PK: EMAIL#{email}
 * - GSI2SK: STAFF#{staffId}
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

// ============================================
// Staff Types
// ============================================

export type StaffRole = 
  | 'teacher'
  | 'principal'
  | 'vice_principal'
  | 'counselor'
  | 'librarian'
  | 'nurse'
  | 'admin_staff'
  | 'support_staff'
  | 'it_staff'
  | 'substitute'
  | 'contractor';

export type EmploymentStatus = 
  | 'active'
  | 'on_leave'
  | 'suspended'
  | 'terminated'
  | 'retired'
  | 'resigned';

export type EmploymentType = 
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'temporary'
  | 'volunteer';

export type StaffStatus = 'active' | 'inactive' | 'pending';

export type StaffGender = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';

// ============================================
// Staff Address Type
// ============================================

export interface StaffAddress {
  addressTypeDescriptor?: 'home' | 'mailing' | 'work' | 'temporary';
  streetNumberName?: string;
  apartmentRoomSuiteNumber?: string;
  city?: string;
  stateAbbreviationDescriptor?: string;
  postalCode?: string;
  country?: string;
}

// ============================================
// Staff Telephone Type
// ============================================

export interface StaffTelephone {
  telephoneNumber: string;
  telephoneNumberTypeDescriptor?: 'home' | 'mobile' | 'work' | 'fax' | 'emergency';
  orderOfPriority?: number;
}

// ============================================
// Staff School Assignment
// ============================================

export interface StaffSchoolAssignment {
  schoolId: string;
  schoolName?: string;
  role: StaffRole;
  departmentId?: string;
  departmentName?: string;  // Denormalized for display
  isPrimary: boolean;
  beginDate: string;
  endDate?: string;
  positionTitle?: string;
  fullTimeEquivalency?: number;  // Ed-Fi: FTE (0-1)
}

// ============================================
// Staff Emergency Contact
// ============================================

export interface StaffEmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
}

// ============================================
// Staff Entity Interface
// ============================================

export interface Staff extends BaseEntity {
  entityType: 'STAFF';
  
  // Identifiers
  staffId: string;
  staffUniqueId: string;  // Ed-Fi unique ID (employee number, state ID)
  userId?: string;  // Linked Cognito user ID (User-to-Staff bridge)
  
  // Ed-Fi Core Demographics
  firstName: string;
  lastSurname: string;
  middleName?: string;
  generationCodeSuffix?: string;
  maidenName?: string;
  birthDate?: string;
  gender?: StaffGender;
  
  // Ed-Fi Compliance Fields
  hispanicLatinoEthnicity?: boolean;
  highlyQualifiedTeacher?: boolean;
  yearsOfPriorTeachingExperience?: number;
  yearsOfPriorProfessionalExperience?: number;
  
  // Contact Information
  email: string;
  phone?: string;
  addresses?: StaffAddress[];
  telephones?: StaffTelephone[];
  
  // Employment
  primarySchoolId: string;
  schoolAssignments: StaffSchoolAssignment[];
  role: StaffRole;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  hireDate: string;
  terminationDate?: string;
  terminationReason?: string;
  departmentId?: string;
  departmentName?: string;  // Denormalized for display
  title?: string;
  
  // Emergency Contacts
  emergencyContacts?: StaffEmergencyContact[];
  
  // System
  status: StaffStatus;
  
  // GSI Keys (lowercase to match DynamoDB conventions)
  gsi1pk?: string;  // TENANT#{tenantId}#SCHOOL#{primarySchoolId}
  gsi1sk?: string;  // STAFF#{staffId}
  gsi2pk?: string;  // EMAIL#{email}
  gsi2sk?: string;  // STAFF#{staffId}

  // ── IEMIS / CEHRD Flash-II Staff register (Sprint 4 S4.1) ──
  // All optional; required subset enforced at the export layer (Sprint 11).
  /** CEHRD-issued persistent staff identifier. Format placeholder per S4.6
   *  (16 digits today — spec TBC against the real CEHRD Staff module). */
  emisStaffId?: string;
  /** ISO-3166 alpha-3 nationality code (e.g. `NPL`). Independent of the
   *  tenant's `country` — Nepali schools can employ foreign teachers. */
  nationality?: string;
  /** Marital status per Nepal's CEHRD Staff register categories. */
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed' | 'other' | 'prefer_not_to_say';
  /** CEHRD appointment category — distinct from `employmentType` which is
   *  full_time/part_time/contract; `appointmentType` captures the CEHRD
   *  Staff-export categorical value. */
  appointmentType?: 'permanent' | 'temporary' | 'contract' | 'honorary' | 'volunteer';
  /** Gregorian ISO date (`YYYY-MM-DD`). BS→AD happens at the UI layer. */
  appointmentDate?: string;
}

// ============================================
// Entity Key Builders
// ============================================

export const StaffKeyBuilder = {
  /**
   * Staff: STAFF#{staffId}
   */
  staff: (staffId: string): string => `STAFF#${staffId}`,

  /**
   * GSI1PK (School lookup, tenant-scoped): TENANT#{tenantId}#SCHOOL#{schoolId}
   */
  schoolLookup: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * GSI2PK (Email lookup): EMAIL#{email}
   */
  emailLookup: (email: string): string => `EMAIL#${email.toLowerCase()}`,
};

// ============================================
// Factory Function
// ============================================

export function createStaffEntity(
  tenantId: string,
  staffId: string,
  data: Omit<Staff, 'tenantId' | 'entityKey' | 'entityType' | 'staffId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'>
): Staff {
  return {
    tenantId,
    entityKey: StaffKeyBuilder.staff(staffId),
    entityType: 'STAFF',
    staffId,
    ...data,
    // GSI Keys (lowercase)
    gsi1pk: StaffKeyBuilder.schoolLookup(tenantId, data.primarySchoolId),
    gsi1sk: StaffKeyBuilder.staff(staffId),
    gsi2pk: StaffKeyBuilder.emailLookup(data.email),
    gsi2sk: StaffKeyBuilder.staff(staffId),
  };
}


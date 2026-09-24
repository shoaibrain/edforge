/**
 * Student Entity for Academics Service
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: STUDENT#{studentId}
 *
 * GSI1 (School scope):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: STUDENT#{lastName}#{firstName}
 *
 * GSI7 (EMIS / government-ID lookup — populated only when `emisStudentId` is set):
 * - GSI7PK: TENANT#{tid}#EMIS#{emisStudentId}
 * - GSI7SK: STUDENT#{studentId}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
  Gender,
  StudentStatus,
} from './base.entity';

/**
 * Student entity stored in DynamoDB
 */
export interface Student extends BaseEntity {
  entityType: 'STUDENT';

  // Identity
  studentId: string;
  studentNumber: string;  // School-assigned ID (internal, format SEBS-2026-00001)

  /**
   * External government/EMIS student ID (e.g. Nepal IEMIS Student ID
   * `1708400128000841`). Required for PABSON tenants, optional elsewhere.
   * Unique per tenant — enforced at service layer via the GSI7 lookup
   * pre-check. Write-once: once a student has an `emisStudentId`, it should
   * not be changed (it's government-issued and follows the student across
   * schools).
   */
  emisStudentId?: string;

  /** Provincial / state-issued student identifier, distinct from the federal
   *  `emisStudentId`. Free-form; no uniqueness index. */
  stateStudentId?: string;

  // Personal info
  firstName: string;
  lastName: string;
  middleName?: string;
  preferredName?: string;
  suffix?: string;
  dateOfBirth: string;  // ISO date
  gender: Gender;

  // Contact
  email?: string;
  phone?: string;
  phoneType?: 'mobile' | 'home' | 'work';

  // Address
  address?: Address;
  /** Postal address when it differs from the residential `address`. */
  mailingAddress?: Address;
  /** True when correspondence should go to `mailingAddress` rather than `address`. */
  useMailingAddress?: boolean;

  // Guardian/Parent info
  guardians: Guardian[];

  // Emergency contacts
  /**
   * @deprecated Superseded by `emergencyContacts`. Still read by
   * `studentEntityToDto` for rows written before the array landed; no code
   * writes it any more. A DDB SET-only update cannot remove it, so it lingers
   * on pre-existing items — harmless, because the array wins when both exist.
   */
  emergencyContact?: EmergencyContact;
  emergencyContacts?: EmergencyContact[];

  // Medical
  medicalInfo?: MedicalInfo;

  // Academic
  primarySchoolId: string;
  currentGradeLevel: string;
  status: StudentStatus;
  enrollmentDate?: string;
  withdrawalDate?: string;
  previousSchool?: string;

  // Special programs
  specialPrograms?: string[];
  accommodations?: string[];

  // Demographics (legacy free-form — predates the Ed-Fi descriptors below and
  // is still what the registration wizard collects)
  ethnicity?: string;
  primaryLanguage?: string;
  homeLanguage?: string;
  countryOfBirth?: string;

  // Free-text operator notes
  notes?: string;

  // Portal access
  portalUserId?: string;  // Link to student portal user in Identity service

  // Photo
  photoUrl?: string;

  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // STUDENT#{lastName}#{firstName}

  // GSI7 keys — only populated when emisStudentId is set
  gsi7pk?: string;  // TENANT#{tid}#EMIS#{emisStudentId}
  gsi7sk?: string;  // STUDENT#{studentId}

  // ── Sprint 3 Ed-Fi descriptor fields (IEMIS-aligned, Flash I/II reporting) ──
  // All optional; set via PATCH /academics/students/:id/descriptors (S3.7) and
  // audited via the `student.descriptor.edited` IEMIS event.
  /** Ed-Fi SexDescriptor URI, e.g. `uri://ed-fi.org/SexDescriptor#Male`. */
  sexDescriptor?: string;
  /** Ed-Fi LanguageDescriptor URI for primary language. */
  languageDescriptor?: string;
  /** Ed-Fi LanguageDescriptor URI for mother tongue (CEHRD Flash I field). */
  motherTongueDescriptor?: string;
  /** Array of disability associations. `notes` is stripped from audit payloads
   *  for privacy — see `sanitizeForAudit` in students.service. */
  disabilities?: Array<{ descriptor: string; notes?: string }>;
  /** Ed-Fi descriptor URI for ethnicity (URI-shape only in V1 — Sprint 6
   *  adds the Nepal ethnicity/caste catalog). */
  ethnicityDescriptor?: string;
  /** True when student was transferred in from another school. */
  isTransferred?: boolean;
  /** True when student is flagged below the poverty line. */
  belowPovertyLine?: boolean;
  /** Free-text scholarship category (only meaningful when
   *  `belowPovertyLine === true` — enforced by the Zod schema's refine). */
  scholarshipCategory?: string;
  /** CEHRD Flash II — scholarship amount in NPR (Sprint E.0.3). Optional;
   *  if IEMIS export schema accepts only the category, this field is
   *  excluded from CSV emit at the template-config layer. Research
   *  E.1.0 §15 flagged this as "inferred — needs IEMIS portal
   *  verification"; safe to ship optional. */
  scholarshipAmountNpr?: number;
  /** CEHRD Flash I — Grade 1 entrants only. True if student attended
   *  ECED (Early Childhood Education and Development) prior to Grade 1.
   *  Sprint E.0.1. IEMIS transformer maps from XLSX column
   *  `eced_completed` / `has_eced_exp`. Optional; legacy rows leave
   *  undefined; backfill via IEMIS re-upload at next opportunity. */
  hasEcedExperience?: boolean;
}

/**
 * Address structure
 * Note: country is optional to match DTO flexibility
 *
 * Nepal-aware extension fields (Sprint A.1) mirror the shape of `addressSchema`
 * in @aibrains/shared-types. PABSON tenants populate these via
 * <AddressFieldsNepal>; GENERIC tenants leave them undefined. Round-trip
 * preservation through the student response mapper is locked by
 * student.mapper.spec.ts.
 */
export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;

  // Nepal-aware extension fields (Sprint A.1)
  wardNumber?: string;
  municipality?: string;
  district?: string;
  province?: string;
}

/**
 * Guardian/Parent information
 */
export interface Guardian {
  guardianId: string;
  relationship: 'mother' | 'father' | 'guardian' | 'grandparent' | 'other';
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  phoneType?: 'mobile' | 'home' | 'work';
  alternatePhone?: string;
  isPrimary: boolean;
  hasPortalAccess: boolean;
  canPickup: boolean;
  userId?: string;  // Link to parent portal user
  employer?: string;
  occupation?: string;
  address?: Address;
}

/**
 * Emergency contact
 */
export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  alternatePhone?: string;
  /** Call order, 1 = first. Absent on rows written before the array landed. */
  priority?: number;
}

/**
 * Medical information
 */
export interface MedicalInfo {
  allergies?: string[];
  medications?: string[];
  conditions?: string[];
  dietaryRestrictions?: string[];
  notes?: string;
  physicianName?: string;
  physicianPhone?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
}

/**
 * Create a new Student entity with proper keys
 */
export function createStudentEntity(
  tenantId: string,
  studentId: string,
  schoolId: string,
  data: Omit<Student, 'tenantId' | 'entityKey' | 'entityType' | 'studentId' | 'gsi1pk' | 'gsi1sk' | 'gsi7pk' | 'gsi7sk'>
): Student {
  const entity: Student = {
    tenantId,
    entityKey: EntityKeyBuilder.student(studentId),
    entityType: 'STUDENT',
    studentId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('STUDENT', `${data.lastName.toUpperCase()}#${data.firstName.toUpperCase()}`),
    ...data,
  };
  // Only populate GSI7 keys when emisStudentId is set — sparse index.
  if (data.emisStudentId) {
    entity.gsi7pk = GSIKeyBuilder.emisStudent(tenantId, data.emisStudentId);
    entity.gsi7sk = `STUDENT#${studentId}`;
  }
  return entity;
}

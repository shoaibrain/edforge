/**
 * Student Mappers
 * 
 * Translates between DynamoDB entity fields and DTO fields.
 * Key mappings:
 * - Entity: email, phone, address are direct fields
 * - DTO: expects contactInfo object with nested fields
 * - Entity: emergencyContact (singular object)
 * - DTO: emergencyContacts (array)
 * - Entity: primarySchoolId
 * - DTO: schoolId
 */

import { Student, Guardian as EntityGuardian, EmergencyContact as EntityEmergencyContact, MedicalInfo as EntityMedicalInfo, Address as EntityAddress } from '../entities/student.entity';
import {
  CreateStudentDto,
  UpdateStudentDto,
  StudentResponseDto,
  StudentProfileResponseDto,
  GuardianDto,
  EmergencyContactDto,
  MedicalInfoDto,
  StudentContactInfoDto,
} from '@edforge/shared-types';

// ============================================
// Entity to DTO Mappers
// ============================================

/**
 * Convert Student entity to StudentResponseDto
 */
export function studentEntityToDto(entity: Student): StudentResponseDto {
  return {
    studentId: entity.studentId,
    schoolId: entity.primarySchoolId,  // primarySchoolId -> schoolId
    tenantId: entity.tenantId,
    firstName: entity.firstName,
    lastName: entity.lastName,
    middleName: entity.middleName,
    preferredName: entity.preferredName,
    suffix: undefined,
    fullName: buildFullName(entity),
    dateOfBirth: entity.dateOfBirth,
    gender: entity.gender,
    studentNumber: entity.studentNumber,
    stateStudentId: undefined,
    currentGradeLevel: entity.currentGradeLevel,
    status: entity.status,
    // Map direct fields to contactInfo object
    contactInfo: {
      email: entity.email,
      phone: entity.phone,
      address: entity.address,
    },
    // Map entity guardians to DTO format
    guardians: entity.guardians?.map(mapGuardianEntityToDto),
    // Map singular emergencyContact to array
    emergencyContacts: entity.emergencyContact ? [mapEmergencyContactEntityToDto(entity.emergencyContact)] : undefined,
    medicalInfo: entity.medicalInfo ? mapMedicalInfoEntityToDto(entity.medicalInfo) : undefined,
    specialPrograms: entity.specialPrograms,
    accommodations: entity.accommodations,
    ethnicity: undefined,
    primaryLanguage: undefined,
    homeLanguage: undefined,
    countryOfBirth: undefined,
    enrollmentDate: entity.enrollmentDate,
    previousSchool: undefined,
    notes: undefined,
    createdAt: entity.createdAt!,
    updatedAt: entity.updatedAt!,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}

/**
 * Convert Student entity to StudentProfileResponseDto (extended)
 */
export function studentEntityToProfileDto(
  entity: Student,
  currentEnrollment?: {
    enrollmentId: string;
    academicYearId: string;
    academicYearName?: string;
    gradeLevel: string;
    enrollmentDate: string;
    status: string;
    homeroomId?: string;
    homeroomName?: string;
  },
  enrollmentHistory?: Array<{
    enrollmentId: string;
    academicYearId: string;
    academicYearName?: string;
    gradeLevel: string;
    schoolId: string;
    schoolName?: string;
    enrollmentDate: string;
    withdrawalDate?: string;
    status: string;
  }>,
  attendanceSummary?: {
    totalDays: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    attendanceRate: number;
  },
  classrooms?: Array<{
    classroomId: string;
    name: string;
    subject?: string;
    teacherName?: string;
  }>
): StudentProfileResponseDto {
  const baseDto = studentEntityToDto(entity);
  
  return {
    ...baseDto,
    currentEnrollment,
    enrollmentHistory,
    attendanceSummary,
    classrooms,
  };
}

// ============================================
// DTO to Entity Mappers
// ============================================

/**
 * Convert CreateStudentDto to entity fields
 */
export function createStudentDtoToEntity(dto: CreateStudentDto): Partial<Student> {
  return {
    firstName: dto.firstName,
    lastName: dto.lastName,
    middleName: dto.middleName,
    preferredName: dto.preferredName,
    dateOfBirth: dto.dateOfBirth,
    gender: dto.gender,
    studentNumber: dto.studentNumber || '',
    primarySchoolId: dto.schoolId,  // schoolId -> primarySchoolId
    currentGradeLevel: dto.currentGradeLevel,
    status: 'active',
    enrollmentDate: dto.enrollmentDate || new Date().toISOString().split('T')[0],
    // Extract from contactInfo object
    email: dto.contactInfo?.email,
    phone: dto.contactInfo?.phone,
    address: dto.contactInfo?.address ? mapAddressDtoToEntity(dto.contactInfo.address) : undefined,
    // Map DTO guardians to entity format
    guardians: dto.guardians?.map(mapGuardianDtoToEntity) || [],
    // Map emergencyContacts array to singular emergencyContact
    emergencyContact: dto.emergencyContacts?.[0] ? mapEmergencyContactDtoToEntity(dto.emergencyContacts[0]) : undefined,
    medicalInfo: dto.medicalInfo ? mapMedicalInfoDtoToEntity(dto.medicalInfo) : undefined,
    specialPrograms: dto.specialPrograms,
    accommodations: dto.accommodations,
  };
}

/**
 * Convert UpdateStudentDto to entity fields
 */
export function updateStudentDtoToEntity(dto: UpdateStudentDto): Partial<Student> {
  const updates: Partial<Student> = {};
  
  if (dto.firstName !== undefined) updates.firstName = dto.firstName;
  if (dto.lastName !== undefined) updates.lastName = dto.lastName;
  if (dto.middleName !== undefined) updates.middleName = dto.middleName;
  if (dto.preferredName !== undefined) updates.preferredName = dto.preferredName;
  if (dto.dateOfBirth !== undefined) updates.dateOfBirth = dto.dateOfBirth;
  if (dto.gender !== undefined) updates.gender = dto.gender;
  if (dto.studentNumber !== undefined) updates.studentNumber = dto.studentNumber;
  if (dto.currentGradeLevel !== undefined) updates.currentGradeLevel = dto.currentGradeLevel;
  
  // Extract from contactInfo object
  if (dto.contactInfo) {
    if (dto.contactInfo.email !== undefined) updates.email = dto.contactInfo.email;
    if (dto.contactInfo.phone !== undefined) updates.phone = dto.contactInfo.phone;
    if (dto.contactInfo.address !== undefined) {
      updates.address = mapAddressDtoToEntity(dto.contactInfo.address);
    }
  }
  
  if (dto.guardians !== undefined) {
    updates.guardians = dto.guardians.map(mapGuardianDtoToEntity);
  }
  
  if (dto.emergencyContacts !== undefined && dto.emergencyContacts[0]) {
    updates.emergencyContact = mapEmergencyContactDtoToEntity(dto.emergencyContacts[0]);
  }
  
  if (dto.medicalInfo !== undefined) {
    updates.medicalInfo = mapMedicalInfoDtoToEntity(dto.medicalInfo);
  }
  
  if (dto.specialPrograms !== undefined) updates.specialPrograms = dto.specialPrograms;
  if (dto.accommodations !== undefined) updates.accommodations = dto.accommodations;
  
  return updates;
}

// ============================================
// Sub-entity Mappers
// ============================================

function mapGuardianEntityToDto(entity: EntityGuardian): GuardianDto {
  return {
    guardianId: entity.guardianId,
    relationship: entity.relationship as any, // Compatible enum
    firstName: entity.firstName,
    lastName: entity.lastName,
    email: entity.email,
    phone: entity.phone,
    phoneType: entity.phoneType,
    alternatePhone: undefined,
    isPrimary: entity.isPrimary,
    hasPortalAccess: entity.hasPortalAccess,
    canPickup: true, // Default, not in entity
    address: entity.address,
    employer: undefined,
    occupation: undefined,
  };
}

function mapGuardianDtoToEntity(dto: GuardianDto): EntityGuardian {
  return {
    guardianId: dto.guardianId || `guardian-${Date.now()}`,
    relationship: dto.relationship as any, // Compatible enum
    firstName: dto.firstName,
    lastName: dto.lastName,
    email: dto.email,
    phone: dto.phone,
    phoneType: dto.phoneType,
    isPrimary: dto.isPrimary ?? false,
    hasPortalAccess: dto.hasPortalAccess ?? false,
    address: dto.address ? mapAddressDtoToEntity(dto.address) : undefined,
  };
}

function mapEmergencyContactEntityToDto(entity: EntityEmergencyContact): EmergencyContactDto {
  return {
    name: entity.name,
    relationship: entity.relationship,
    phone: entity.phone,
    alternatePhone: entity.alternatePhone,
    priority: 1, // Default
  };
}

function mapEmergencyContactDtoToEntity(dto: EmergencyContactDto): EntityEmergencyContact {
  return {
    name: dto.name,
    relationship: dto.relationship,
    phone: dto.phone,
    alternatePhone: dto.alternatePhone,
  };
}

function mapMedicalInfoEntityToDto(entity: EntityMedicalInfo): MedicalInfoDto {
  return {
    allergies: entity.allergies,
    medications: entity.medications,
    conditions: entity.conditions,
    dietaryRestrictions: undefined,
    bloodType: undefined,
    notes: entity.notes,
    physicianName: entity.physicianName,
    physicianPhone: entity.physicianPhone,
    insuranceProvider: entity.insuranceProvider,
    insurancePolicyNumber: entity.insurancePolicyNumber,
    hasIEP: undefined,
    has504Plan: undefined,
  };
}

function mapMedicalInfoDtoToEntity(dto: MedicalInfoDto): EntityMedicalInfo {
  return {
    allergies: dto.allergies,
    medications: dto.medications,
    conditions: dto.conditions,
    notes: dto.notes,
    physicianName: dto.physicianName,
    physicianPhone: dto.physicianPhone,
    insuranceProvider: dto.insuranceProvider,
    insurancePolicyNumber: dto.insurancePolicyNumber,
  };
}

function mapAddressDtoToEntity(dto: any): EntityAddress {
  return {
    street1: dto.street1,
    street2: dto.street2,
    city: dto.city,
    state: dto.state,
    zipCode: dto.zipCode,
    country: dto.country,
  };
}

// ============================================
// Helpers
// ============================================

function buildFullName(entity: Student): string {
  const parts = [entity.firstName];
  if (entity.middleName) parts.push(entity.middleName);
  parts.push(entity.lastName);
  return parts.join(' ');
}

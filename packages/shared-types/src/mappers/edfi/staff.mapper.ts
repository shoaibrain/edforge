/**
 * Staff Ed-Fi Mapper
 * 
 * Converts EdForge Staff data to Ed-Fi Data Standard format for compliance export.
 * Ed-Fi Data Standard v6.0: https://docs.ed-fi.org/reference/data-exchange/data-standard/
 */

import type { StaffResponseDto, StaffSchoolAssignment } from '../../schemas/identity/staff.schema';
import type { CredentialResponseDto } from '../../schemas/identity/credential.schema';
import { toEdFiCredential, type EdFiCredential } from './credential.mapper';

/**
 * Ed-Fi Staff Resource
 * Based on Ed-Fi Data Standard v6.0 Staff resource
 */
export interface EdFiStaff {
  staffUniqueId: string;
  firstName: string;
  lastSurname: string;
  middleName?: string;
  generationCodeSuffix?: string;
  maidenName?: string;
  birthDate?: string;
  hispanicLatinoEthnicity?: boolean;
  highlyQualifiedTeacher?: boolean;
  yearsOfPriorTeachingExperience?: number;
  yearsOfPriorProfessionalExperience?: number;
  sexDescriptor?: string;
  identificationDocuments?: EdFiIdentificationDocument[];
  addresses?: EdFiStaffAddress[];
  electronicMails?: EdFiElectronicMail[];
  telephones?: EdFiTelephone[];
  _ext?: EdForgeExtension;
}

export interface EdFiIdentificationDocument {
  identificationDocumentUseDescriptor: string;
  personalInformationVerificationDescriptor: string;
  issuerDocumentIdentificationCode?: string;
  issuerName?: string;
}

export interface EdFiStaffAddress {
  addressTypeDescriptor: string;
  streetNumberName?: string;
  apartmentRoomSuiteNumber?: string;
  city: string;
  stateAbbreviationDescriptor: string;
  postalCode: string;
  nameOfCounty?: string;
}

export interface EdFiElectronicMail {
  electronicMailAddress: string;
  electronicMailTypeDescriptor: string;
  primaryEmailAddressIndicator?: boolean;
}

export interface EdFiTelephone {
  telephoneNumber: string;
  telephoneNumberTypeDescriptor: string;
  orderOfPriority?: number;
}

export interface EdForgeExtension {
  edforge_staffId: string;
  edforge_tenantId: string;
  edforge_role: string;
  edforge_employmentType: string;
  edforge_employmentStatus: string;
  edforge_hireDate: string;
  edforge_primarySchoolId: string;
}

/**
 * Ed-Fi StaffEducationOrganizationAssignmentAssociation
 * Represents assignment of staff to schools
 */
export interface EdFiStaffEducationOrganizationAssignmentAssociation {
  staffReference: {
    staffUniqueId: string;
  };
  educationOrganizationReference: {
    educationOrganizationId: number;
  };
  beginDate: string;
  endDate?: string;
  positionTitle?: string;
  staffClassificationDescriptor: string;
  orderOfAssignment?: number;
  employmentStatusDescriptor?: string;
  fullTimeEquivalency?: number;
}

/**
 * Ed-Fi StaffSchoolAssociation
 * Links a staff member to a school with program assignment and academic details.
 */
export interface EdFiStaffSchoolAssociation {
  staffReference: {
    staffUniqueId: string;
  };
  schoolReference: {
    schoolId: number;
  };
  programAssignmentDescriptor: string;
  academicSubjects?: { academicSubjectDescriptor: string }[];
  gradeLevels?: { gradeLevelDescriptor: string }[];
  schoolYear?: number;
  calendarReference?: {
    calendarCode: string;
    schoolId: number;
    schoolYear: number;
  };
}

/**
 * Full Ed-Fi staff export bundle — staff record + associations + credentials
 */
export interface EdFiStaffExportBundle {
  staff: EdFiStaff;
  assignments: EdFiStaffEducationOrganizationAssignmentAssociation[];
  schoolAssociations: EdFiStaffSchoolAssociation[];
  credentials: EdFiCredential[];
}

/**
 * Map gender to Ed-Fi sexDescriptor
 */
function mapGenderToEdFi(gender?: string): string | undefined {
  const genderMap: Record<string, string> = {
    'male': 'uri://ed-fi.org/SexDescriptor#Male',
    'female': 'uri://ed-fi.org/SexDescriptor#Female',
    'non_binary': 'uri://ed-fi.org/SexDescriptor#Not Selected',
    'prefer_not_to_say': 'uri://ed-fi.org/SexDescriptor#Not Selected',
  };
  return gender ? genderMap[gender] : undefined;
}

/**
 * Map EdForge staff role to Ed-Fi staffClassificationDescriptor
 */
function mapRoleToEdFi(role: string): string {
  const roleMap: Record<string, string> = {
    'teacher': 'uri://ed-fi.org/StaffClassificationDescriptor#Teacher',
    'principal': 'uri://ed-fi.org/StaffClassificationDescriptor#Principal',
    'vice_principal': 'uri://ed-fi.org/StaffClassificationDescriptor#Assistant Principal',
    'counselor': 'uri://ed-fi.org/StaffClassificationDescriptor#Counselor',
    'librarian': 'uri://ed-fi.org/StaffClassificationDescriptor#Librarians/Media Specialist',
    'nurse': 'uri://ed-fi.org/StaffClassificationDescriptor#School Nurse',
    'admin_staff': 'uri://ed-fi.org/StaffClassificationDescriptor#School Administrative Support Staff',
    'support_staff': 'uri://ed-fi.org/StaffClassificationDescriptor#Support Services Staff',
    'it_staff': 'uri://ed-fi.org/StaffClassificationDescriptor#Support Services Staff',
    'substitute': 'uri://ed-fi.org/StaffClassificationDescriptor#Substitute Teacher',
    'contractor': 'uri://ed-fi.org/StaffClassificationDescriptor#Other',
  };
  return roleMap[role] || 'uri://ed-fi.org/StaffClassificationDescriptor#Other';
}

/**
 * Map EdForge employment status to Ed-Fi employmentStatusDescriptor
 */
function mapEmploymentStatusToEdFi(status: string): string {
  const statusMap: Record<string, string> = {
    'active': 'uri://ed-fi.org/EmploymentStatusDescriptor#Employed or affiliated with organization',
    'on_leave': 'uri://ed-fi.org/EmploymentStatusDescriptor#On leave',
    'suspended': 'uri://ed-fi.org/EmploymentStatusDescriptor#On leave',
    'terminated': 'uri://ed-fi.org/EmploymentStatusDescriptor#Separated',
    'retired': 'uri://ed-fi.org/EmploymentStatusDescriptor#Separated',
    'resigned': 'uri://ed-fi.org/EmploymentStatusDescriptor#Separated',
  };
  return statusMap[status] || 'uri://ed-fi.org/EmploymentStatusDescriptor#Other';
}

/**
 * Convert EdForge Staff to Ed-Fi Staff format
 */
export function toEdFiStaff(staff: StaffResponseDto): EdFiStaff {
  const edfiStaff: EdFiStaff = {
    staffUniqueId: staff.staffUniqueId,
    firstName: staff.firstName,
    lastSurname: staff.lastSurname,
    middleName: staff.middleName,
    generationCodeSuffix: staff.generationCodeSuffix,
    birthDate: staff.birthDate,
    hispanicLatinoEthnicity: staff.hispanicLatinoEthnicity,
    highlyQualifiedTeacher: staff.highlyQualifiedTeacher,
    yearsOfPriorTeachingExperience: staff.yearsOfPriorTeachingExperience,
    sexDescriptor: mapGenderToEdFi(staff.gender),
  };

  // Map addresses
  if (staff.addresses && staff.addresses.length > 0) {
    edfiStaff.addresses = staff.addresses.map(addr => ({
      addressTypeDescriptor: `uri://ed-fi.org/AddressTypeDescriptor#${addr.addressTypeDescriptor || 'Home'}`,
      streetNumberName: addr.streetNumberName,
      apartmentRoomSuiteNumber: addr.apartmentRoomSuiteNumber,
      city: addr.city || '',
      stateAbbreviationDescriptor: `uri://ed-fi.org/StateAbbreviationDescriptor#${addr.stateAbbreviationDescriptor || 'XX'}`,
      postalCode: addr.postalCode || '',
    }));
  }

  // Map email
  if (staff.email) {
    edfiStaff.electronicMails = [{
      electronicMailAddress: staff.email,
      electronicMailTypeDescriptor: 'uri://ed-fi.org/ElectronicMailTypeDescriptor#Work',
      primaryEmailAddressIndicator: true,
    }];
  }

  // Map phone
  if (staff.phone) {
    edfiStaff.telephones = [{
      telephoneNumber: staff.phone,
      telephoneNumberTypeDescriptor: 'uri://ed-fi.org/TelephoneNumberTypeDescriptor#Work',
      orderOfPriority: 1,
    }];
  }

  // EdForge extension data (for round-trip preservation)
  edfiStaff._ext = {
    edforge_staffId: staff.staffId,
    edforge_tenantId: staff.tenantId,
    edforge_role: staff.role,
    edforge_employmentType: staff.employmentType,
    edforge_employmentStatus: staff.employmentStatus,
    edforge_hireDate: staff.hireDate,
    edforge_primarySchoolId: staff.primarySchoolId,
  };

  return edfiStaff;
}

/**
 * Convert EdForge Staff School Assignment to Ed-Fi StaffEducationOrganizationAssignmentAssociation
 */
export function toEdFiStaffAssignment(
  staff: StaffResponseDto,
  assignment: StaffSchoolAssignment,
  schoolEdFiId: number
): EdFiStaffEducationOrganizationAssignmentAssociation {
  return {
    staffReference: {
      staffUniqueId: staff.staffUniqueId,
    },
    educationOrganizationReference: {
      educationOrganizationId: schoolEdFiId,
    },
    beginDate: assignment.beginDate,
    endDate: assignment.endDate,
    positionTitle: assignment.positionTitle,
    staffClassificationDescriptor: mapRoleToEdFi(assignment.role),
    orderOfAssignment: assignment.isPrimary ? 1 : 2,
    employmentStatusDescriptor: mapEmploymentStatusToEdFi(staff.employmentStatus),
    fullTimeEquivalency: assignment.fullTimeEquivalency,
  };
}

/**
 * Map EdForge staff role to Ed-Fi programAssignmentDescriptor
 */
function mapRoleToProgramAssignment(role: string): string {
  const programMap: Record<string, string> = {
    'teacher': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Regular Education',
    'principal': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Regular Education',
    'vice_principal': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Regular Education',
    'counselor': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
    'librarian': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
    'nurse': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
    'admin_staff': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
    'support_staff': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
    'it_staff': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
    'substitute': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Regular Education',
    'contractor': 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other',
  };
  return programMap[role] || 'uri://ed-fi.org/ProgramAssignmentDescriptor#Other';
}

/**
 * Convert EdForge Staff School Assignment to Ed-Fi StaffSchoolAssociation
 */
export function toEdFiStaffSchoolAssociation(
  staff: StaffResponseDto,
  assignment: StaffSchoolAssignment,
  schoolEdFiId: number,
  academicSubjects?: string[],
  gradeLevels?: string[],
): EdFiStaffSchoolAssociation {
  const result: EdFiStaffSchoolAssociation = {
    staffReference: {
      staffUniqueId: staff.staffUniqueId,
    },
    schoolReference: {
      schoolId: schoolEdFiId,
    },
    programAssignmentDescriptor: mapRoleToProgramAssignment(assignment.role),
  };

  if (academicSubjects && academicSubjects.length > 0) {
    result.academicSubjects = academicSubjects.map(s => ({
      academicSubjectDescriptor: `uri://ed-fi.org/AcademicSubjectDescriptor#${s}`,
    }));
  }

  if (gradeLevels && gradeLevels.length > 0) {
    result.gradeLevels = gradeLevels.map(gl => ({
      gradeLevelDescriptor: `uri://ed-fi.org/GradeLevelDescriptor#${gl}`,
    }));
  }

  return result;
}

/**
 * Batch convert EdForge Staff list to Ed-Fi format
 */
export function toEdFiStaffBatch(staffList: StaffResponseDto[]): EdFiStaff[] {
  return staffList.map(toEdFiStaff);
}

/**
 * Build a full Ed-Fi export bundle for a staff member including
 * assignments, school associations, and credentials.
 */
export function toEdFiStaffExportBundle(
  staff: StaffResponseDto,
  credentials: CredentialResponseDto[],
  schoolIdMap: Record<string, number>,
): EdFiStaffExportBundle {
  const edfiStaff = toEdFiStaff(staff);
  const assignments: EdFiStaffEducationOrganizationAssignmentAssociation[] = [];
  const schoolAssociations: EdFiStaffSchoolAssociation[] = [];

  if (staff.schoolAssignments) {
    for (const assignment of staff.schoolAssignments) {
      const edfiSchoolId = schoolIdMap[assignment.schoolId];
      if (edfiSchoolId) {
        assignments.push(toEdFiStaffAssignment(staff, assignment, edfiSchoolId));
        schoolAssociations.push(toEdFiStaffSchoolAssociation(staff, assignment, edfiSchoolId));
      }
    }
  }

  return {
    staff: edfiStaff,
    assignments,
    schoolAssociations,
    credentials: credentials.map(toEdFiCredential),
  };
}

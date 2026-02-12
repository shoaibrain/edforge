/**
 * Education Organization Descriptor Constants - Identity Service
 *
 * Ed-Fi descriptor constants for the Education Organization domain.
 * All URIs follow the Ed-Fi pattern: uri://ed-fi.org/{Namespace}#{Value}
 *
 * Ed-Fi Data Standard v5:
 * https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/
 */

import { z } from 'zod';

// ============================================
// Descriptor Shape
// ============================================

export const descriptorEntrySchema = z.object({
  value: z.string(),
  label: z.string(),
  uri: z.string(),
});

export type DescriptorEntry = z.infer<typeof descriptorEntrySchema>;

// ============================================
// School Category Descriptors
// Ed-Fi: SchoolCategoryDescriptor
// ============================================

export const SCHOOL_CATEGORY_DESCRIPTORS = [
  { value: 'AllLevels', label: 'All Levels', uri: 'uri://ed-fi.org/SchoolCategoryDescriptor#All Levels' },
  { value: 'Elementary', label: 'Elementary School', uri: 'uri://ed-fi.org/SchoolCategoryDescriptor#Elementary School' },
  { value: 'HighSchool', label: 'High School', uri: 'uri://ed-fi.org/SchoolCategoryDescriptor#High School' },
  { value: 'MiddleSchool', label: 'Middle School', uri: 'uri://ed-fi.org/SchoolCategoryDescriptor#Middle School' },
  { value: 'SecondarySchool', label: 'Secondary School', uri: 'uri://ed-fi.org/SchoolCategoryDescriptor#Secondary School' },
  { value: 'Ungraded', label: 'Ungraded', uri: 'uri://ed-fi.org/SchoolCategoryDescriptor#Ungraded' },
] as const satisfies readonly DescriptorEntry[];

export const schoolCategoryDescriptorSchema = z.enum([
  'AllLevels',
  'Elementary',
  'HighSchool',
  'MiddleSchool',
  'SecondarySchool',
  'Ungraded',
]);
export type SchoolCategoryDescriptor = z.infer<typeof schoolCategoryDescriptorSchema>;

// ============================================
// School Type Descriptors
// Ed-Fi: SchoolTypeDescriptor
// ============================================

export const SCHOOL_TYPE_DESCRIPTORS = [
  { value: 'Regular', label: 'Regular', uri: 'uri://ed-fi.org/SchoolTypeDescriptor#Regular' },
  { value: 'SpecialEducation', label: 'Special Education', uri: 'uri://ed-fi.org/SchoolTypeDescriptor#Special Education' },
  { value: 'CareerAndTechnical', label: 'Career and Technical Education', uri: 'uri://ed-fi.org/SchoolTypeDescriptor#Career and Technical Education' },
  { value: 'Alternative', label: 'Alternative', uri: 'uri://ed-fi.org/SchoolTypeDescriptor#Alternative' },
] as const satisfies readonly DescriptorEntry[];

export const schoolTypeDescriptorSchema = z.enum([
  'Regular',
  'SpecialEducation',
  'CareerAndTechnical',
  'Alternative',
]);
export type SchoolTypeDescriptor = z.infer<typeof schoolTypeDescriptorSchema>;

// ============================================
// LEA Category Descriptors
// Ed-Fi: LocalEducationAgencyCategoryDescriptor
// ============================================

export const LEA_CATEGORY_DESCRIPTORS = [
  { value: 'Independent', label: 'Independent', uri: 'uri://ed-fi.org/LocalEducationAgencyCategoryDescriptor#Independent' },
  { value: 'CharterLEA', label: 'Charter LEA', uri: 'uri://ed-fi.org/LocalEducationAgencyCategoryDescriptor#Charter LEA' },
  { value: 'Intermediate', label: 'Intermediate', uri: 'uri://ed-fi.org/LocalEducationAgencyCategoryDescriptor#Intermediate' },
  { value: 'SupervisoryUnion', label: 'Supervisory Union', uri: 'uri://ed-fi.org/LocalEducationAgencyCategoryDescriptor#Supervisory Union' },
  { value: 'Other', label: 'Other', uri: 'uri://ed-fi.org/LocalEducationAgencyCategoryDescriptor#Other' },
] as const satisfies readonly DescriptorEntry[];

export const leaCategoryDescriptorSchema = z.enum([
  'Independent',
  'CharterLEA',
  'Intermediate',
  'SupervisoryUnion',
  'Other',
]);
export type LeaCategoryDescriptor = z.infer<typeof leaCategoryDescriptorSchema>;

// ============================================
// Operational Status Descriptors
// Ed-Fi: OperationalStatusDescriptor
// ============================================

export const OPERATIONAL_STATUS_DESCRIPTORS = [
  { value: 'Active', label: 'Active', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Active' },
  { value: 'Added', label: 'Added', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Added' },
  { value: 'ChangedAgency', label: 'Changed Agency', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Changed Agency' },
  { value: 'Closed', label: 'Closed', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Closed' },
  { value: 'Inactive', label: 'Inactive', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Inactive' },
  { value: 'New', label: 'New', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#New' },
  { value: 'Reopened', label: 'Reopened', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Reopened' },
  { value: 'Future', label: 'Future', uri: 'uri://ed-fi.org/OperationalStatusDescriptor#Future' },
] as const satisfies readonly DescriptorEntry[];

export const operationalStatusDescriptorSchema = z.enum([
  'Active',
  'Added',
  'ChangedAgency',
  'Closed',
  'Inactive',
  'New',
  'Reopened',
  'Future',
]);
export type OperationalStatusDescriptor = z.infer<typeof operationalStatusDescriptorSchema>;

// ============================================
// Institution Telephone Number Type Descriptors
// Ed-Fi: InstitutionTelephoneNumberTypeDescriptor
// ============================================

export const INSTITUTION_TELEPHONE_NUMBER_TYPE_DESCRIPTORS = [
  { value: 'Main', label: 'Main', uri: 'uri://ed-fi.org/InstitutionTelephoneNumberTypeDescriptor#Main' },
  { value: 'Administrative', label: 'Administrative', uri: 'uri://ed-fi.org/InstitutionTelephoneNumberTypeDescriptor#Administrative' },
  { value: 'Fax', label: 'Fax', uri: 'uri://ed-fi.org/InstitutionTelephoneNumberTypeDescriptor#Fax' },
  { value: 'Attendance', label: 'Attendance', uri: 'uri://ed-fi.org/InstitutionTelephoneNumberTypeDescriptor#Attendance' },
] as const satisfies readonly DescriptorEntry[];

export const institutionTelephoneNumberTypeDescriptorSchema = z.enum([
  'Main',
  'Administrative',
  'Fax',
  'Attendance',
]);
export type InstitutionTelephoneNumberTypeDescriptor = z.infer<typeof institutionTelephoneNumberTypeDescriptorSchema>;

// ============================================
// Education Organization Identification System Descriptors
// Ed-Fi: EducationOrganizationIdentificationSystemDescriptor
// ============================================

export const EDUCATION_ORGANIZATION_IDENTIFICATION_SYSTEM_DESCRIPTORS = [
  { value: 'NCES', label: 'NCES Identification Number', uri: 'uri://ed-fi.org/EducationOrganizationIdentificationSystemDescriptor#NCES Identification Number' },
  { value: 'SEA', label: 'SEA Identification Number', uri: 'uri://ed-fi.org/EducationOrganizationIdentificationSystemDescriptor#SEA' },
  { value: 'DUNS', label: 'DUNS Number', uri: 'uri://ed-fi.org/EducationOrganizationIdentificationSystemDescriptor#DUNS' },
  { value: 'Federal', label: 'Federal Identification Number', uri: 'uri://ed-fi.org/EducationOrganizationIdentificationSystemDescriptor#Federal' },
  { value: 'Other', label: 'Other', uri: 'uri://ed-fi.org/EducationOrganizationIdentificationSystemDescriptor#Other' },
] as const satisfies readonly DescriptorEntry[];

export const educationOrganizationIdentificationSystemDescriptorSchema = z.enum([
  'NCES',
  'SEA',
  'DUNS',
  'Federal',
  'Other',
]);
export type EducationOrganizationIdentificationSystemDescriptor = z.infer<typeof educationOrganizationIdentificationSystemDescriptorSchema>;

// ============================================
// Address Type Descriptors
// Ed-Fi: AddressTypeDescriptor
// ============================================

export const ADDRESS_TYPE_DESCRIPTORS = [
  { value: 'Physical', label: 'Physical', uri: 'uri://ed-fi.org/AddressTypeDescriptor#Physical' },
  { value: 'Mailing', label: 'Mailing', uri: 'uri://ed-fi.org/AddressTypeDescriptor#Mailing' },
  { value: 'Shipping', label: 'Shipping', uri: 'uri://ed-fi.org/AddressTypeDescriptor#Shipping' },
] as const satisfies readonly DescriptorEntry[];

export const addressTypeDescriptorSchema = z.enum([
  'Physical',
  'Mailing',
  'Shipping',
]);
export type AddressTypeDescriptor = z.infer<typeof addressTypeDescriptorSchema>;

// ============================================
// Grade Level Descriptors
// Ed-Fi: GradeLevelDescriptor
// ============================================

export const SCHOOL_GRADE_LEVEL_DESCRIPTORS = [
  { value: 'InfantToddler', label: 'Infant/Toddler', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Infant/toddler' },
  { value: 'Prenursery', label: 'Prenursery', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Prenursery' },
  { value: 'Nursery', label: 'Nursery', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Nursery' },
  { value: 'Prekindergarten', label: 'Pre-Kindergarten', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Pre-Kindergarten' },
  { value: 'TransitionalKindergarten', label: 'Transitional Kindergarten', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Transitional Kindergarten' },
  { value: 'Kindergarten', label: 'Kindergarten', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Kindergarten' },
  { value: 'FirstGrade', label: 'First grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#First grade' },
  { value: 'SecondGrade', label: 'Second grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Second grade' },
  { value: 'ThirdGrade', label: 'Third grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Third grade' },
  { value: 'FourthGrade', label: 'Fourth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Fourth grade' },
  { value: 'FifthGrade', label: 'Fifth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Fifth grade' },
  { value: 'SixthGrade', label: 'Sixth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Sixth grade' },
  { value: 'SeventhGrade', label: 'Seventh grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Seventh grade' },
  { value: 'EighthGrade', label: 'Eighth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Eighth grade' },
  { value: 'NinthGrade', label: 'Ninth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Ninth grade' },
  { value: 'TenthGrade', label: 'Tenth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Tenth grade' },
  { value: 'EleventhGrade', label: 'Eleventh grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Eleventh grade' },
  { value: 'TwelfthGrade', label: 'Twelfth grade', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Twelfth grade' },
  { value: 'Postsecondary', label: 'Postsecondary', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Postsecondary' },
  { value: 'Ungraded', label: 'Ungraded', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Ungraded' },
  { value: 'Other', label: 'Other', uri: 'uri://ed-fi.org/GradeLevelDescriptor#Other' },
] as const satisfies readonly DescriptorEntry[];

/**
 * Ed-Fi grade levels for school grade spans (e.g., which grades a school serves).
 * Distinct from credential.schema's gradeLevelDescriptorSchema which uses simplified values.
 */
export const schoolGradeLevelDescriptorSchema = z.enum([
  'InfantToddler',
  'Prenursery',
  'Nursery',
  'Prekindergarten',
  'TransitionalKindergarten',
  'Kindergarten',
  'FirstGrade',
  'SecondGrade',
  'ThirdGrade',
  'FourthGrade',
  'FifthGrade',
  'SixthGrade',
  'SeventhGrade',
  'EighthGrade',
  'NinthGrade',
  'TenthGrade',
  'EleventhGrade',
  'TwelfthGrade',
  'Postsecondary',
  'Ungraded',
  'Other',
]);
export type SchoolGradeLevelDescriptor = z.infer<typeof schoolGradeLevelDescriptorSchema>;

// ============================================
// Charter Status Descriptors
// Ed-Fi: CharterStatusDescriptor
// ============================================

export const CHARTER_STATUS_DESCRIPTORS = [
  { value: 'NotACharter', label: 'Not a Charter School', uri: 'uri://ed-fi.org/CharterStatusDescriptor#Not a Charter School' },
  { value: 'SchoolCharter', label: 'School Charter', uri: 'uri://ed-fi.org/CharterStatusDescriptor#School Charter' },
  { value: 'CollegeUniversityCharter', label: 'College/University Charter', uri: 'uri://ed-fi.org/CharterStatusDescriptor#College/University Charter' },
  { value: 'OpenEnrollment', label: 'Open Enrollment', uri: 'uri://ed-fi.org/CharterStatusDescriptor#Open Enrollment' },
] as const satisfies readonly DescriptorEntry[];

export const charterStatusDescriptorSchema = z.enum([
  'NotACharter',
  'SchoolCharter',
  'CollegeUniversityCharter',
  'OpenEnrollment',
]);
export type CharterStatusDescriptor = z.infer<typeof charterStatusDescriptorSchema>;

// ============================================
// Administrative Funding Control Descriptors
// Ed-Fi: AdministrativeFundingControlDescriptor
// ============================================

export const ADMINISTRATIVE_FUNDING_CONTROL_DESCRIPTORS = [
  { value: 'Public', label: 'Public School', uri: 'uri://ed-fi.org/AdministrativeFundingControlDescriptor#Public School' },
  { value: 'Private', label: 'Private School', uri: 'uri://ed-fi.org/AdministrativeFundingControlDescriptor#Private School' },
  { value: 'Other', label: 'Other', uri: 'uri://ed-fi.org/AdministrativeFundingControlDescriptor#Other' },
] as const satisfies readonly DescriptorEntry[];

export const administrativeFundingControlDescriptorSchema = z.enum([
  'Public',
  'Private',
  'Other',
]);
export type AdministrativeFundingControlDescriptor = z.infer<typeof administrativeFundingControlDescriptorSchema>;

// ============================================
// State Abbreviation Descriptors
// Ed-Fi: StateAbbreviationDescriptor
// ============================================

export const STATE_ABBREVIATION_DESCRIPTORS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
] as const;

export const stateAbbreviationDescriptorSchema = z.enum(STATE_ABBREVIATION_DESCRIPTORS);
export type StateAbbreviationDescriptor = z.infer<typeof stateAbbreviationDescriptorSchema>;

// ============================================
// Education Organization Category Descriptors
// Ed-Fi: EducationOrganizationCategoryDescriptor
// ============================================

export const EDUCATION_ORGANIZATION_CATEGORY_DESCRIPTORS = [
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Educator Preparation Provider', label: 'Educator Preparation Provider', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Educator Preparation Provider' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Education Organization Network', label: 'Education Organization Network', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Education Organization Network' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Education Service Center', label: 'Education Service Center', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Education Service Center' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Local Education Agency', label: 'Local Education Agency', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Local Education Agency' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Post Secondary Institution', label: 'Post Secondary Institution', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Post Secondary Institution' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#School', label: 'School', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#School' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#State Education Agency', label: 'State Education Agency', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#State Education Agency' },
  { value: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Other', label: 'Other', uri: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Other' },
] as const satisfies readonly DescriptorEntry[];

/**
 * Maps org type shorthand to the correct default category URI.
 * Used by forms to auto-populate the categories field.
 */
export const ORG_TYPE_DEFAULT_CATEGORY: Record<string, string> = {
  sea: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#State Education Agency',
  lea: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Local Education Agency',
  esc: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Education Service Center',
  school: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#School',
  network: 'uri://ed-fi.org/EducationOrganizationCategoryDescriptor#Education Organization Network',
};

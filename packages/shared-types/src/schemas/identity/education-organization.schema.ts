/**
 * Education Organization Base Schemas - Identity Service
 *
 * Zod schemas for the EducationOrganization abstract base type and shared
 * sub-types used by all concrete education organization entities (SEA, LEA, School, ESC).
 *
 * Ed-Fi Data Standard v5:
 * https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/
 */

import { z } from 'zod';
import { dateSchema } from '../common';
import {
  operationalStatusDescriptorSchema,
  addressTypeDescriptorSchema,
  stateAbbreviationDescriptorSchema,
  educationOrganizationIdentificationSystemDescriptorSchema,
  institutionTelephoneNumberTypeDescriptorSchema,
} from './education-org-descriptors';

// ============================================
// Education Organization Type
// ============================================

/**
 * All Ed-Fi education organization entity types.
 * Includes future types for forward compatibility.
 */
export const educationOrgTypeSchema = z.enum([
  'stateEducationAgency',
  'localEducationAgency',
  'school',
  'educationServiceCenter',
  'educationOrganizationNetwork',
  'organizationDepartment',
  'communityOrganization',
  'communityProvider',
  'postSecondaryInstitution',
]);
export type EducationOrgType = z.infer<typeof educationOrgTypeSchema>;

// ============================================
// Operational Status
// ============================================

/**
 * Re-export for convenience (Ed-Fi: OperationalStatusDescriptor)
 */
export const operationalStatusSchema = operationalStatusDescriptorSchema;
export type OperationalStatus = z.infer<typeof operationalStatusSchema>;

// ============================================
// Education Organization Address
// Ed-Fi: EducationOrganizationAddress
// ============================================

export const educationOrgAddressSchema = z.object({
  addressTypeDescriptor: addressTypeDescriptorSchema,            // Ed-Fi: addressTypeDescriptor
  streetNumberName: z.string().max(150),                         // Ed-Fi: streetNumberName
  apartmentRoomSuiteNumber: z.string().max(50).optional(),       // Ed-Fi: apartmentRoomSuiteNumber
  city: z.string().max(30),                                      // Ed-Fi: city
  stateAbbreviationDescriptor: stateAbbreviationDescriptorSchema, // Ed-Fi: stateAbbreviationDescriptor
  postalCode: z.string().max(17),                                // Ed-Fi: postalCode
  nameOfCounty: z.string().max(30).optional(),                   // Ed-Fi: nameOfCounty
  countyFIPSCode: z.string().max(5).optional(),                  // Ed-Fi: countyFIPSCode
  latitude: z.string().max(20).optional(),                       // Ed-Fi: latitude
  longitude: z.string().max(20).optional(),                      // Ed-Fi: longitude
});
export type EducationOrgAddress = z.infer<typeof educationOrgAddressSchema>;

// ============================================
// Education Organization Identification Code
// Ed-Fi: EducationOrganizationIdentificationCode
// ============================================

export const educationOrgIdentificationCodeSchema = z.object({
  identificationCode: z.string().min(1).max(60),                                             // Ed-Fi: identificationCode
  educationOrganizationIdentificationSystemDescriptor: educationOrganizationIdentificationSystemDescriptorSchema, // Ed-Fi: descriptor
});
export type EducationOrgIdentificationCode = z.infer<typeof educationOrgIdentificationCodeSchema>;

// ============================================
// Education Organization Indicator
// Ed-Fi: EducationOrganizationIndicator
// ============================================

export const educationOrgIndicatorSchema = z.object({
  indicatorDescriptor: z.string().max(200),                      // Ed-Fi: indicatorDescriptor
  designatedBy: z.string().max(60).optional(),                   // Ed-Fi: designatedBy
  indicatorValue: z.string().max(60).optional(),                 // Ed-Fi: indicatorValue
  indicatorLevelDescriptor: z.string().max(200).optional(),      // Ed-Fi: indicatorLevelDescriptor
  indicatorGroupDescriptor: z.string().max(200).optional(),      // Ed-Fi: indicatorGroupDescriptor
});
export type EducationOrgIndicator = z.infer<typeof educationOrgIndicatorSchema>;

// ============================================
// Institution Telephone
// Ed-Fi: InstitutionTelephone
// ============================================

export const institutionTelephoneSchema = z.object({
  telephoneNumber: z.string().min(1).max(24),                    // Ed-Fi: telephoneNumber
  institutionTelephoneNumberTypeDescriptor: institutionTelephoneNumberTypeDescriptorSchema, // Ed-Fi: descriptor
});
export type InstitutionTelephone = z.infer<typeof institutionTelephoneSchema>;

// ============================================
// Education Organization Category
// Ed-Fi: EducationOrganizationCategory (required on all entities)
// ============================================

export const educationOrgCategorySchema = z.object({
  educationOrganizationCategoryDescriptor: z.string().max(200),  // Ed-Fi: descriptor URI
});
export type EducationOrgCategory = z.infer<typeof educationOrgCategorySchema>;

// ============================================
// Accountability Rating
// Ed-Fi: AccountabilityRating
// ============================================

export const accountabilityRatingSchema = z.object({
  schoolYear: z.number().int().min(1900).max(2100),              // Ed-Fi: schoolYear
  title: z.string().min(1).max(100),                             // Ed-Fi: title
  rating: z.string().min(1).max(35),                             // Ed-Fi: rating
  ratingOrganization: z.string().max(35).optional(),             // Ed-Fi: ratingOrganization
  ratingDate: dateSchema.optional(),                             // Ed-Fi: ratingDate
});
export type AccountabilityRating = z.infer<typeof accountabilityRatingSchema>;

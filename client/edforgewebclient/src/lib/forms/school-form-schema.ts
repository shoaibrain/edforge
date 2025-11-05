/**
 * EdForge EMIS - School Form Schema
 * 
 * Zod schema for creating schools.
 * Matches CreateSchoolDto structure from backend exactly.
 * 
 * Based on:
 * - server/application/microservices/school/src/schools/dto/school.dto.ts
 * - server/application/microservices/school/src/schools/entities/school.entity.enhanced.ts
 */

import { z } from "zod";

/**
 * School Type Options
 */
export const SCHOOL_TYPES = [
  { value: 'elementary', label: 'Elementary' },
  { value: 'middle', label: 'Middle School' },
  { value: 'high', label: 'High School' },
  { value: 'k12', label: 'K-12' },
  { value: 'alternative', label: 'Alternative' },
  { value: 'special', label: 'Special Education' },
] as const;

/**
 * Grade Level Options
 */
export const GRADE_LEVELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

/**
 * Common Timezone Options (IANA format)
 */
export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona Time (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'America/Toronto', label: 'Eastern Time - Canada (ET)' },
  { value: 'America/Vancouver', label: 'Pacific Time - Canada (PT)' },
  { value: 'Europe/London', label: 'GMT/BST - United Kingdom' },
  { value: 'Europe/Paris', label: 'CET/CEST - Central Europe' },
  { value: 'Asia/Tokyo', label: 'JST - Japan' },
  { value: 'Asia/Dubai', label: 'GST - United Arab Emirates' },
  { value: 'Asia/Singapore', label: 'SGT - Singapore' },
  { value: 'Australia/Sydney', label: 'AEST/AEDT - Australia (Sydney)' },
] as const;

/**
 * E.164 Phone Format Regex
 * Matches: +[country code][number] (e.g., +1-555-0123, +44-20-7946-0958)
 */
const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * IANA Timezone Regex
 * Matches: Continent/City format (e.g., America/New_York)
 */
const IANA_TIMEZONE_REGEX = /^[A-Z][a-z]+\/[A-Z][a-z_]+$/;

/**
 * Contact Info Schema
 * Matches ContactInfoDto from backend
 */
const contactInfoSchema = z.object({
  primaryEmail: z
    .string()
    .min(1, 'Primary email is required')
    .email('Please enter a valid email address'),
  primaryPhone: z
    .string()
    .min(1, 'Primary phone is required')
    .refine((val) => {
      const cleaned = val.replace(/[\s\-]/g, '');
      return E164_PHONE_REGEX.test(cleaned);
    }, 'Phone must be in E.164 format (e.g., +1-555-0123)'),
  secondaryPhone: z
    .string()
    .optional()
    .refine((val) => {
      if (!val || val.trim().length === 0) return true;
      const cleaned = val.replace(/[\s\-]/g, '');
      return E164_PHONE_REGEX.test(cleaned);
    }, 'Phone must be in E.164 format (e.g., +1-555-0124)'),
  website: z
    .string()
    .optional()
    .refine((val) => {
      if (!val || val.trim().length === 0) return true;
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, 'Please enter a valid URL (e.g., https://example.com)'),
  fax: z.string().optional(),
});

/**
 * Address Schema
 * Matches AddressDto from backend
 */
const addressSchema = z.object({
  street: z.string().min(1, 'Street address is required').max(200, 'Street address must be no more than 200 characters'),
  city: z.string().min(1, 'City is required').max(100, 'City must be no more than 100 characters'),
  state: z.string().min(1, 'State/Province is required').max(100, 'State/Province must be no more than 100 characters'),
  country: z
    .string()
    .length(2, 'Country code must be 2 letters (e.g., US, CA, GB)')
    .regex(/^[A-Z]{2}$/, 'Country code must be uppercase letters'),
  postalCode: z.string().min(1, 'Postal code is required').max(20, 'Postal code must be no more than 20 characters'),
  timezone: z
    .string()
    .min(1, 'Timezone is required')
    .regex(IANA_TIMEZONE_REGEX, 'Please enter a valid IANA timezone (e.g., America/New_York)'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

/**
 * Grade Range Schema
 * Matches GradeRangeDto from backend
 */
const gradeRangeSchema = z.object({
  lowestGrade: z.enum(['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']),
  highestGrade: z.enum(['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']),
}).refine((data) => {
  const gradeOrder = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const lowestIndex = gradeOrder.indexOf(data.lowestGrade);
  const highestIndex = gradeOrder.indexOf(data.highestGrade);
  return lowestIndex <= highestIndex;
}, {
  message: 'Lowest grade must be less than or equal to highest grade',
  path: ['highestGrade'],
});

/**
 * Create School Form Schema
 * Matches CreateSchoolDto from backend exactly
 */
export const createSchoolSchema = z.object({
  schoolName: z.string().min(3, 'School name must be at least 3 characters').max(255, 'School name must be no more than 255 characters'),
  schoolCode: z.string().min(3, 'School code must be at least 3 characters').max(50, 'School code must be no more than 50 characters'),
  schoolType: z.enum(['elementary', 'middle', 'high', 'k12', 'alternative', 'special']),
  contactInfo: contactInfoSchema,
  address: addressSchema,
  gradeRange: gradeRangeSchema,
  maxStudentCapacity: z.number().min(1, 'Maximum student capacity must be at least 1').max(50000, 'Maximum student capacity must be no more than 50000'),
  // Optional fields
  description: z.string().max(1000, 'Description must be no more than 1000 characters').optional().or(z.literal('')),
  motto: z.string().max(255, 'Motto must be no more than 255 characters').optional().or(z.literal('')),
  logoUrl: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((val) => {
      if (!val || val.trim().length === 0) return true;
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, 'Please enter a valid URL (e.g., https://example.com)'),
  foundedDate: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((val) => {
      if (!val || val.trim().length === 0) return true;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(val)) return false;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Date must be in YYYY-MM-DD format'),
  principalUserId: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((val) => {
      if (!val || val.trim().length === 0) return true;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(val);
    }, 'User ID must be a valid UUID'),
  vicePrincipalUserIds: z.array(z.string().uuid('All user IDs must be valid UUIDs')).optional(),
});

/**
 * TypeScript type inferred from schema
 */
export type CreateSchoolFormData = z.infer<typeof createSchoolSchema>;

/**
 * Default form values
 */
export const defaultSchoolFormValues: CreateSchoolFormData = {
  schoolName: '',
  schoolCode: '',
  schoolType: 'elementary',
  contactInfo: {
    primaryEmail: '',
    primaryPhone: '',
    secondaryPhone: '',
    website: '',
    fax: '',
  },
  address: {
    street: '',
    city: '',
    state: '',
    country: 'US',
    postalCode: '',
    timezone: 'America/New_York',
  },
  gradeRange: {
    lowestGrade: 'K',
    highestGrade: '5',
  },
  maxStudentCapacity: 500,
  description: '',
  motto: '',
  logoUrl: '',
  foundedDate: '',
  principalUserId: '',
  vicePrincipalUserIds: [],
};

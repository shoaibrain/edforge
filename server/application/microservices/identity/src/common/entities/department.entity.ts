/**
 * Department Entity for Identity Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#DEPT#{deptId}
 */

import {
  BaseEntity,
} from './base.entity';
import type { AttendancePolicy } from '@aibrains/shared-types';

/**
 * Department entity stored in DynamoDB
 */
export interface Department extends BaseEntity {
  entityType: 'DEPARTMENT';
  
  // Identity
  departmentId: string;
  schoolId: string;
  code: string;         // e.g., "MATH", "ENG", "SCI"
  name: string;         // e.g., "Mathematics", "English"
  
  // Details
  description?: string;
  
  // Head
  headUserId?: string;
  headName?: string;
  
  // Status
  isActive: boolean;
  
  // Statistics
  teacherCount?: number;
  courseCount?: number;
}

/**
 * School Configuration entity
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#CONFIG
 */
export interface SchoolConfiguration extends BaseEntity {
  entityType: 'CONFIG';
  
  // Identity
  schoolId: string;
  
  // General Settings
  timezone: string;
  locale: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  
  // Academic Settings
  academicCalendarType: 'semester' | 'quarter' | 'trimester' | 'annual';
  gradingScale: GradingScale;
  attendanceRequired: boolean;
  // Attendance Domain epic (S2.T1): per-school attendance mode, inherited from
  // the tenant default at create time. Optional for legacy rows.
  attendancePolicy?: AttendancePolicy;

  // Schedule Settings
  schoolDays: number[];    // 0=Sun, 1=Mon, ... 6=Sat
  startTime: string;       // e.g., "08:00"
  endTime: string;         // e.g., "15:30"
  periodDuration: number;  // minutes
  
  // Notifications
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;

  // Features
  features: SchoolFeatures;

  /**
   * Sprint E.0.2 — Per-school municipality binding.
   *
   * Carries the local-government (Municipality / Metropolitan City)
   * identification + branding overlay used by:
   *   - Sprint D.3.1 ExternalExamRegistration.municipalityId (FK)
   *   - Sprint D.4.5 BLE admit-card PDF render (logo overlay)
   *   - Sprint E.1.3 Flash I/II export per-municipality header overrides
   *
   * Optional: GENERIC tenants leave this undefined; PABSON tenants
   * populate it once per school during setup. The decision to scope at
   * SchoolConfiguration (not Tenant) is anchored in the v3.4 audit —
   * a tenant can hold multi-school chains across municipalities.
   */
  municipalityConfig?: MunicipalityConfig;
}

/**
 * Per-school municipality configuration (Sprint E.0.2).
 */
export interface MunicipalityConfig {
  /** Stable ID — typically the IEMIS-published municipality code or
   *  a UUID minted at first setup. Used as FK from
   *  ExternalExamRegistration.municipalityId. */
  municipalityId: string;
  /** Human-readable name shown on admit-card PDFs and operator UIs. */
  municipalityName: string;
  /** Optional S3 URL for the municipal logo (overlays alongside the
   *  school logo on admit cards per v3.4 D.4.0 §3.2). */
  municipalityLogoS3Url?: string;
  /** Per-municipality CSV/Excel column-header overrides for the IEMIS
   *  export, layered on top of the canonical Flash I/II template at
   *  emit time. Free-form Record<canonicalKey, overrideKey> so we
   *  can ship hot-fixes without backend redeploy (mirror of the
   *  S3-versioned template config in Sprint E.1.2). */
  iemsExportHeaderOverrides?: Record<string, string>;
}

/**
 * Grading scale configuration
 */
export interface GradingScale {
  type: 'letter' | 'percentage' | 'points' | 'custom';
  passingGrade: number;
  scale: GradeLevel[];
}

/**
 * Grade level in scale
 */
export interface GradeLevel {
  letter: string;      // e.g., "A", "B+", "C"
  minScore: number;    // e.g., 90, 85, 70
  maxScore: number;
  gpa?: number;        // e.g., 4.0, 3.5, 2.0
}

/**
 * School feature flags
 */
export interface SchoolFeatures {
  attendance: boolean;
  grades: boolean;
  enrollment: boolean;
  curriculum: boolean;
  scheduling: boolean;
  specialPrograms: boolean;
  parentPortal: boolean;
  studentPortal: boolean;
}

/**
 * Create a new Department entity with proper keys
 */
export function createDepartmentEntity(
  tenantId: string,
  schoolId: string,
  departmentId: string,
  data: Omit<Department, 'tenantId' | 'entityKey' | 'entityType' | 'departmentId' | 'schoolId'>
): Department {
  return {
    tenantId,
    entityKey: `SCHOOL#${schoolId}#DEPT#${departmentId}`,
    entityType: 'DEPARTMENT',
    departmentId,
    schoolId,
    ...data,
  };
}

/**
 * Create school configuration entity
 */
export function createSchoolConfigEntity(
  tenantId: string,
  schoolId: string,
  data: Omit<SchoolConfiguration, 'tenantId' | 'entityKey' | 'entityType' | 'schoolId'>
): SchoolConfiguration {
  return {
    tenantId,
    entityKey: `SCHOOL#${schoolId}#CONFIG`,
    entityType: 'CONFIG',
    schoolId,
    ...data,
  };
}

type SchoolConfigDefaults = Omit<SchoolConfiguration, 'tenantId' | 'entityKey' | 'entityType' | 'schoolId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'version'>;

/**
 * Default school configuration (US defaults — generic fallback)
 */
export const DEFAULT_SCHOOL_CONFIG: SchoolConfigDefaults = {
  timezone: 'America/New_York',
  locale: 'en-US',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  academicCalendarType: 'semester',
  gradingScale: {
    type: 'letter',
    passingGrade: 60,
    scale: [
      { letter: 'A', minScore: 90, maxScore: 100, gpa: 4.0 },
      { letter: 'B', minScore: 80, maxScore: 89, gpa: 3.0 },
      { letter: 'C', minScore: 70, maxScore: 79, gpa: 2.0 },
      { letter: 'D', minScore: 60, maxScore: 69, gpa: 1.0 },
      { letter: 'F', minScore: 0, maxScore: 59, gpa: 0.0 },
    ],
  },
  attendanceRequired: true,
  schoolDays: [1, 2, 3, 4, 5], // Mon-Fri
  startTime: '08:00',
  endTime: '15:30',
  periodDuration: 50,
  notificationsEnabled: true,
  emailNotifications: true,
  smsNotifications: false,
  features: {
    attendance: true,
    grades: true,
    enrollment: true,
    curriculum: true,
    scheduling: true,
    specialPrograms: false,
    parentPortal: false,
    studentPortal: false,
  },
};

/**
 * Country-specific school configuration overrides
 */
const COUNTRY_CONFIG_OVERRIDES: Record<string, Partial<SchoolConfigDefaults>> = {
  NPL: {
    timezone: 'Asia/Kathmandu',
    locale: 'ne-NP',
    dateFormat: 'YYYY/MM/DD',
    timeFormat: '24h',
    academicCalendarType: 'annual',
    schoolDays: [0, 1, 2, 3, 4, 5], // Sun-Fri (Saturday off)
    startTime: '10:00',
    endTime: '16:00',
    periodDuration: 45,
    gradingScale: {
      type: 'percentage',
      passingGrade: 32,
      scale: [
        { letter: 'A+', minScore: 90, maxScore: 100, gpa: 4.0 },
        { letter: 'A', minScore: 80, maxScore: 89, gpa: 3.6 },
        { letter: 'B+', minScore: 70, maxScore: 79, gpa: 3.2 },
        { letter: 'B', minScore: 60, maxScore: 69, gpa: 2.8 },
        { letter: 'C+', minScore: 50, maxScore: 59, gpa: 2.4 },
        { letter: 'C', minScore: 40, maxScore: 49, gpa: 2.0 },
        { letter: 'D', minScore: 32, maxScore: 39, gpa: 1.6 },
        { letter: 'F', minScore: 0, maxScore: 31, gpa: 0.0 },
      ],
    },
  },
  IND: {
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    schoolDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
    startTime: '08:00',
    endTime: '14:00',
    periodDuration: 40,
  },
  GBR: {
    timezone: 'Europe/London',
    locale: 'en-GB',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
  },
};

/**
 * Get default school configuration for a specific country.
 * Merges country overrides onto the base US defaults.
 */
export function getDefaultConfigForCountry(countryCode: string): SchoolConfigDefaults {
  const overrides = COUNTRY_CONFIG_OVERRIDES[countryCode];
  if (!overrides) return { ...DEFAULT_SCHOOL_CONFIG };
  return { ...DEFAULT_SCHOOL_CONFIG, ...overrides };
}

/**
 * Archetype-specific school-config overrides (GB1.2a). PABSON is the Nepal
 * governance body, so its operating profile *is* Nepal's — Sun–Fri week, 24h
 * clock, CEHRD percentage grading. Defined by reference to the NPL country
 * override so the Nepal operating profile has a single definition in this file;
 * a future Nepal archetype (CBS) that diverges gets its own entry.
 */
const ARCHETYPE_CONFIG_OVERRIDES: Record<string, Partial<SchoolConfigDefaults>> = {
  PABSON: COUNTRY_CONFIG_OVERRIDES.NPL,
};

/**
 * Get default school configuration honoring archetype precedence over country
 * (GB1.2a) — the school-config sibling of `resolveArchetypeDefaults`. The
 * governance body wins when it carries an operating profile; otherwise the
 * country map is the fallback layer. Pure function; no call-site yet (a later
 * ticket wires it into school-config seeding).
 */
export function getDefaultConfigForArchetype(
  archetype: string | undefined | null,
  country: string | undefined | null,
): SchoolConfigDefaults {
  const overrides = archetype ? ARCHETYPE_CONFIG_OVERRIDES[archetype.toUpperCase()] : undefined;
  return { ...getDefaultConfigForCountry(country ?? 'USA'), ...(overrides ?? {}) };
}


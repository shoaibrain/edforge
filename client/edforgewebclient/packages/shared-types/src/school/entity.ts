/**
 * School Service Entity Types
 * 
 * These interfaces represent the entities returned by API responses.
 * Extracted from:
 * server/application/microservices/school/src/schools/entities/school.entity.enhanced.ts
 * 
 * Note: Only entities that are exposed via API responses are included here.
 * Internal-only types (e.g., SchoolConfiguration, DepartmentBudget) are excluded.
 */

import type { BaseEntity } from '../common';

// Re-export BaseEntity for convenience
export type { BaseEntity } from '../common';

/**
 * School - Core school entity
 */
export interface School extends BaseEntity {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  schoolType: 'elementary' | 'middle' | 'high' | 'k12' | 'alternative' | 'special';
  
  contactInfo: {
    primaryEmail: string;
    primaryPhone: string;
    secondaryPhone?: string;
    website?: string;
    fax?: string;
  };
  
  address: {
    street: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    latitude?: number;
    longitude?: number;
    timezone: string;
  };
  
  principalUserId?: string;
  vicePrincipalUserIds?: string[];
  administrativeStaffCount?: number;
  
  maxStudentCapacity: number;
  currentEnrollment?: number;
  gradeRange: {
    lowestGrade: string;
    highestGrade: string;
  };
  
  status: 'active' | 'inactive' | 'suspended' | 'closed' | 'planned';
  statusReason?: string;
  
  accreditationInfo?: {
    accreditedBy: string[];
    accreditationExpiry?: string;
  };
  
  foundedDate?: string;
  description?: string;
  motto?: string;
  logoUrl?: string;
}

/**
 * Academic Year - Temporal boundary entity
 */
export interface AcademicYear extends BaseEntity {
  schoolId: string;
  academicYearId: string;
  yearName: string; // Display name: "2024-2025"
  yearCode: string; // Short code: "AY24"
  
  startDate: string; // ISO 8601 date
  endDate: string;
  
  status: 'planned' | 'active' | 'completed' | 'archived';
  isCurrent: boolean;
  
  structure: {
    semesterCount: number;
    gradingPeriodCount: number;
    instructionalDays: number;
    schoolDays: number;
  };
  
  tuitionRates?: {
    [gradeLevel: string]: {
      amount: number;
      currency: string;
      frequency: 'annual' | 'semester' | 'monthly';
    };
  };
  
  enrollmentTargets?: {
    total: number;
    byGrade: { [grade: string]: number };
  };
}

/**
 * Grading Period - Sub-divisions of academic year
 */
export interface GradingPeriod extends BaseEntity {
  schoolId: string;
  academicYearId: string;
  gradingPeriodId: string;
  periodName: string;
  periodCode: string;
  periodNumber: number;
  
  startDate: string;
  endDate: string;
  
  status: 'planned' | 'active' | 'completed';
  isCurrent: boolean;
  
  gradeEntryDeadline?: string; // Note: This is gradesDueDate in DTO, but gradeEntryDeadline in entity
  reportCardDate?: string;
  
  instructionalDays?: number;
}

/**
 * Holiday - Academic calendar holidays
 */
export interface Holiday extends BaseEntity {
  schoolId: string;
  academicYearId: string;
  holidayId: string;
  holidayName: string;
  holidayType: 'national' | 'regional' | 'school' | 'religious' | 'cultural';
  
  startDate: string;
  endDate: string;
  
  isRecurring: boolean;
  recurrencePattern?: string;
  appliesToGradeLevels?: string[]; // If null, applies to all grades
}

/**
 * Department - Organizational unit within school
 */
export interface Department extends BaseEntity {
  schoolId: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  category: 'academic' | 'administrative' | 'support' | 'athletic';
  
  headOfDepartmentUserId?: string;
  assistantHeadUserId?: string;
  
  academicScope: {
    gradeLevels: string[];
    subjects: string[];
    curriculumStandards: string[];
  };
  
  staffing: {
    allocatedPositions: number;
    filledPositions: number;
    vacantPositions: number;
  };
  
  resources?: {
    facilities: Array<{
      type: 'lab' | 'office' | 'classroom' | 'storage';
      roomId: string;
    }>;
    equipment: Array<{
      category: string;
      quantity: number;
      description: string;
    }>;
  };
  
  status: 'active' | 'inactive' | 'dissolved';
}

/**
 * Response Types for List Operations
 */
export interface SchoolListResponse {
  schools: School[];
  total?: number;
}

export interface DepartmentListResponse {
  departments: Department[];
  total?: number;
}

export interface AcademicYearListResponse {
  academicYears: AcademicYear[];
  total?: number;
}

export interface GradingPeriodListResponse {
  gradingPeriods: GradingPeriod[];
  total?: number;
}

export interface HolidayListResponse {
  holidays: Holiday[];
  total?: number;
}


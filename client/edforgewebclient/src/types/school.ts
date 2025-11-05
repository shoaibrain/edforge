/**
 * EdForge EMIS - School Service Type Definitions
 * 
 * Type definitions for school, department, academic year, and related entities
 */

export interface BaseEntity {
  tenantId: string;
  entityType: string;
  entityKey: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

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
 * Grading period is added in a academic year by the admin.
 * grading period start and date should be 
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
  
  gradeEntryDeadline?: string;
  reportCardDate?: string;
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
 * Request/Response types for API operations
 */
export interface CreateSchoolRequest {
  schoolName: string;
  schoolCode: string;
  schoolType: School['schoolType'];
  contactInfo: {
    primaryEmail: string;
    primaryPhone: string;
    secondaryPhone?: string;
    website?: string;
    fax?: string;
  };
  address: School['address'];
  gradeRange: School['gradeRange'];
  maxStudentCapacity: number;
  /**
   * Optional fields - will be converted to undefined if empty strings
   */
  description?: string;
  motto?: string;
  logoUrl?: string;
  foundedDate?: string;
  principalUserId?: string;
  vicePrincipalUserIds?: string[];
}

export interface CreateAcademicYearRequest {
  yearName: string;
  yearCode: string;
  startDate: string;
  endDate: string;
  structure: AcademicYear['structure'];
  enrollmentTargets?: AcademicYear['enrollmentTargets'];
  isCurrent?: boolean;
}

export interface UpdateAcademicYearRequest {
  yearName?: string;
  yearCode?: string;
  startDate?: string;
  endDate?: string;
  structure?: AcademicYear['structure'];
  enrollmentTargets?: AcademicYear['enrollmentTargets'];
  isCurrent?: boolean;
  status?: AcademicYear['status'];
}

export interface CreateDepartmentRequest {
  departmentName: string;
  departmentCode: string;
  category: Department['category'];
  academicScope: Department['academicScope'];
  staffing: Department['staffing'];
}

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

/**
 * Request types for API operations
 * These match the backend DTOs exactly
 */

/**
 * Create Grading Period Request - matches CreateGradingPeriodDto
 */
export interface CreateGradingPeriodRequest {
  periodName: string;
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  periodNumber: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isCurrent?: boolean;
  instructionalDays?: number;
  gradesDueDate?: string; // YYYY-MM-DD
  reportCardDate?: string; // YYYY-MM-DD
}

/**
 * Create Holiday Request - matches CreateHolidayDto
 */
export interface CreateHolidayRequest {
  name: string; // Maps to holidayName in frontend
  type: 'holiday' | 'professional_day' | 'weather_closure' | 'emergency'; // Maps to holidayType in frontend
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  allDay?: boolean;
  description?: string;
  isRecurring?: boolean;
  affectsAttendance?: boolean;
  affectsPayroll?: boolean;
}


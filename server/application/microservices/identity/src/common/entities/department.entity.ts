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
  academicCalendarType: 'semester' | 'quarter' | 'trimester';
  gradingScale: GradingScale;
  attendanceRequired: boolean;
  
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

/**
 * Default school configuration
 */
export const DEFAULT_SCHOOL_CONFIG: Omit<SchoolConfiguration, 'tenantId' | 'entityKey' | 'entityType' | 'schoolId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'version'> = {
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


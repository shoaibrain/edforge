/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 */

export interface Department {
  departmentId: string;
  tenantId: string;
  schoolId: string;
  departmentName: string;
  departmentCode: string;
  headOfDepartment: string;
  description?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface AcademicYear {
  academicYearId: string;
  tenantId: string;
  schoolId: string;
  yearName: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  semesters: Semester[];
  status: 'ACTIVE' | 'INACTIVE' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
}

export interface Semester {
  semesterId: string;
  academicYearId: string;
  semesterName: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'COMPLETED';
}

export interface SchoolConfiguration {
  schoolId: string;
  tenantId: string;
  academicSettings: {
    defaultAcademicYear: string;
    defaultSemester: string;
    gradingSystem: 'LETTER' | 'NUMERIC' | 'PERCENTAGE';
    passingGrade: number;
    maxAbsences: number;
  };
  attendanceSettings: {
    requiredAttendancePercentage: number;
    lateArrivalThreshold: number;
    earlyDepartureThreshold: number;
  };
  notificationSettings: {
    emailNotifications: boolean;
    smsNotifications: boolean;
    pushNotifications: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SchoolReport {
  schoolId: string;
  tenantId: string;
  reportType: 'ACADEMIC' | 'ATTENDANCE' | 'FINANCIAL' | 'STAFF' | 'COMPREHENSIVE';
  reportPeriod: {
    startDate: string;
    endDate: string;
  };
  generatedBy: string;
  generatedAt: string;
  data: any;
  status: 'GENERATED' | 'PENDING' | 'FAILED';
}

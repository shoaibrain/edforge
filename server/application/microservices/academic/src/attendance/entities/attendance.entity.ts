/*
 * Attendance Entity - Represents student attendance records
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}#DATE#{date}#STUDENT#{studentId}
 * 
 * GSI1: classroomId#academicYearId#date -> List all attendance for a classroom on a date
 * GSI2: teacherId#academicYearId#date -> List attendance recorded by a teacher on a date
 * GSI3: studentId#academicYearId -> List all attendance for a student
 */

export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: string;      // Discriminator for entity type
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

// Attendance System Configuration
export interface AttendanceSystem extends BaseEntity {
  entityType: 'ATTENDANCE_SYSTEM';
  systemId: string;
  schoolId: string;
  name: string; // "Daily", "Period-based", "Block Schedule"
  type: 'daily' | 'period' | 'block' | 'custom';
  periods: AttendancePeriod[];
  isDefault: boolean;
  isActive: boolean;
  
  // GSI Keys
  gsi1pk: string; // schoolId#academicYearId
  gsi1sk: string; // ATTENDANCE_SYSTEM#{systemId}
}

export interface AttendancePeriod {
  id: string;
  name: string; // "Period 1", "Morning Block"
  startTime: string; // "08:00"
  endTime: string; // "09:30"
  isActive: boolean;
  sortOrder: number;
}

export interface AttendanceRecord extends BaseEntity {
  entityType: 'ATTENDANCE';  // Literal type for type safety
  attendanceId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  studentId: string;
  
  // Attendance details
  date: string;                       // YYYY-MM-DD format
  status: 'present' | 'absent' | 'tardy' | 'excused' | 'late' | 'early_departure';
  
  // Time tracking
  checkInTime?: string;               // HH:MM format
  checkOutTime?: string;              // HH:MM format
  minutesLate?: number;
  duration: number;                   // Minutes present
  expectedDuration: number;           // Expected minutes for the period
  
  // Period-specific (if applicable)
  periodId?: string;
  periodNumber?: number;
  
  // Recording info
  recordedByTeacherId: string;
  recordedAt: string;
  
  // Additional info
  notes?: string;
  excuseReason?: string;              // For excused absences
  parentNotified?: boolean;
  documentationRequired?: boolean;
  excuseDocumentation?: string;       // URL to uploaded document
  
  // Analytics
  attendanceTrend: 'improving' | 'declining' | 'stable';
  isChronicAbsentee: boolean;        // >10% absence rate
  riskLevel: 'low' | 'medium' | 'high';
  
  // GSI keys for efficient queries
  gsi1pk: string;                     // classroomId#academicYearId
  gsi1sk: string;                     // ATTENDANCE#{date}#{attendanceId}
  gsi2pk: string;                     // studentId#academicYearId
  gsi2sk: string;                     // ATTENDANCE#{date}#{attendanceId}
  gsi3pk: string;                     // date#academicYearId
  gsi3sk: string;                     // ATTENDANCE#{classroomId}#{attendanceId}
  gsi4pk: string;                     // status#academicYearId
  gsi4sk: string;                     // ATTENDANCE#{date}#{attendanceId}
  gsi5pk: string;                     // schoolId#academicYearId
  gsi5sk: string;                     // ATTENDANCE#{date}#{attendanceId}
}

// Attendance summary for reporting
export interface AttendanceSummary {
  studentId: string;
  academicYearId: string;
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  unexcusedAbsentDays: number;
  attendanceRate: number;             // Percentage
  latenessRate: number;               // Percentage
  trend: 'improving' | 'declining' | 'stable';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isChronicAbsentee: boolean;
  daysAbsentThisMonth: number;
  daysAbsentThisYear: number;
  recommendations: string[];
  interventionRequired: boolean;
  parentNotificationRequired: boolean;
  patternDescription: string;
}

export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
}

// Attendance Analytics for Data-Driven Decisions
export interface AttendanceAnalytics extends BaseEntity {
  entityType: 'ATTENDANCE_ANALYTICS';
  analyticsId: string;
  studentId?: string; // Optional - can be classroom/school level
  classroomId?: string;
  schoolId: string;
  academicYearId: string;
  termId?: string;
  
  // Attendance Metrics
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  excusedAbsences: number;
  unexcusedAbsences: number;
  
  // Percentages
  attendanceRate: number;
  punctualityRate: number;
  
  // Patterns
  attendanceTrend: 'improving' | 'declining' | 'stable';
  frequentAbsenceDays: string[]; // Days of week
  frequentAbsenceReasons: string[];
  
  // Risk Assessment
  riskLevel: 'low' | 'medium' | 'high';
  interventionNeeded: boolean;
  chronicAbsenteeism: boolean; // >10% absence rate
  
  // Historical Data
  monthlyAttendance: {
    month: string;
    attendanceRate: number;
    absentDays: number;
    lateDays: number;
  }[];
  
  attendanceHistory: {
    date: string;
    status: string;
    reason?: string;
    markedBy: string;
  }[];
  
  // Insights
  improvementAreas: string[];
  strengths: string[];
  recommendations: string[];
  
  // GSI Keys
  gsi1pk: string; // studentId#academicYearId (if student level)
  gsi1sk: string; // ATTENDANCE_ANALYTICS#{analyticsId}
  gsi2pk: string; // classroomId#academicYearId (if classroom level)
  gsi2sk: string; // ATTENDANCE_ANALYTICS#{analyticsId}
  gsi3pk: string; // schoolId#academicYearId
  gsi3sk: string; // ATTENDANCE_ANALYTICS#{analyticsId}
}

// Teacher Attendance Analytics
export interface TeacherAttendanceAnalytics extends BaseEntity {
  entityType: 'TEACHER_ATTENDANCE_ANALYTICS';
  analyticsId: string;
  teacherId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  
  // Classroom Metrics
  totalStudents: number;
  averageAttendanceRate: number;
  
  // Student Performance
  excellentAttendance: {
    studentId: string;
    studentName: string;
    attendanceRate: number;
    lastAbsence: string;
  }[]; // >95%
  
  goodAttendance: {
    studentId: string;
    studentName: string;
    attendanceRate: number;
    lastAbsence: string;
  }[]; // 90-95%
  
  concerningAttendance: {
    studentId: string;
    studentName: string;
    attendanceRate: number;
    lastAbsence: string;
    riskFactors: string[];
  }[]; // 80-90%
  
  criticalAttendance: {
    studentId: string;
    studentName: string;
    attendanceRate: number;
    lastAbsence: string;
    riskFactors: string[];
    recommendedActions: string[];
  }[]; // <80%
  
  // Patterns
  dailyAttendanceTrends: {
    date: string;
    attendanceRate: number;
    absentStudents: number;
    lateStudents: number;
  }[];
  
  monthlyAttendanceTrends: {
    month: string;
    averageAttendanceRate: number;
    totalAbsences: number;
    totalLates: number;
  }[];
  
  seasonalPatterns: {
    season: string;
    attendanceRate: number;
    commonReasons: string[];
  }[];
  
  // Alerts
  studentsNeedingAttention: {
    studentId: string;
    studentName: string;
    attendanceRate: number;
    lastIntervention: string;
    nextAction: string;
  }[];
  
  chronicAbsenteeism: {
    studentId: string;
    studentName: string;
    attendanceRate: number;
    consecutiveAbsences: number;
    lastPresent: string;
  }[];
  
  unexplainedAbsences: {
    studentId: string;
    studentName: string;
    date: string;
    status: string;
    markedBy: string;
  }[];
  
  // GSI Keys
  gsi1pk: string; // teacherId#academicYearId
  gsi1sk: string; // TEACHER_ATTENDANCE_ANALYTICS#{analyticsId}
  gsi2pk: string; // classroomId#academicYearId
  gsi2sk: string; // TEACHER_ATTENDANCE_ANALYTICS#{analyticsId}
  gsi3pk: string; // schoolId#academicYearId
  gsi3sk: string; // TEACHER_ATTENDANCE_ANALYTICS#{analyticsId}
}

export class EntityKeyBuilder {
  static attendance(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    date: string
  ): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}#DATE#${date}#ATTENDANCE`;
  }

  static attendanceSystem(schoolId: string, academicYearId: string, systemId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#ATTENDANCE_SYSTEM#${systemId}`;
  }

  static attendanceAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#ATTENDANCE_ANALYTICS#${analyticsId}`;
  }

  static teacherAttendanceAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#TEACHER_ATTENDANCE_ANALYTICS#${analyticsId}`;
  }
}


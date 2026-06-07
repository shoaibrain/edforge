/**
 * Report-aggregator types — Sprint E.1.3
 *
 * Internal shape of the merged "row" the Lambda assembles per student per
 * snapshot. Source paths in template descriptors
 * (packages/shared-types/src/external-reporting/templates/) reference these
 * field names via dot-paths (e.g. `student.firstName`, `enrollment.gradeLevel`).
 *
 * Flash I needs: student + enrollment + session + school
 * Flash II adds: attendance summary + (post-C5+) result cards
 */

export interface ReportRowStudent {
  studentId: string;
  emisStudentId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;            // Gregorian ISO date; transform applies BS conversion
  sexDescriptor?: string;
  ethnicityDescriptor?: string;
  motherTongueDescriptor?: string;
  disabilities?: string[];          // array of descriptor URIs
  hasEcedExperience?: boolean;      // E.0.1
  scholarshipCategory?: string;     // descriptor or short code
  scholarshipAmountNpr?: number;    // E.0.3
}

export interface ReportRowEnrollment {
  enrollmentId: string;
  gradeLevel: string;
  type: string;                     // enrollmentType (new/returning/transfer/re_enrollment)
  track?: string;                   // grade 11-12 stream
  endStatus?: string;               // for Flash II academic_status mapping
  exitWithdrawDate?: string;
}

export interface ReportRowSession {
  sessionId?: string;
  yearBs: string;                   // academicYearBs (e.g. "2083")
}

export interface ReportRowSchool {
  schoolId: string;
  emisCode?: string;
}

export interface ReportRowAttendance {
  presentDays: number;
  absentDays: number;
  totalInstructionalDays: number;
}

import type { ReportRowResultCard } from './result-card-select';

export interface ReportRow {
  student: ReportRowStudent;
  enrollment: ReportRowEnrollment;
  session: ReportRowSession;
  school: ReportRowSchool;
  attendance?: ReportRowAttendance; // Flash II only
  resultCards?: ReportRowResultCard[]; // Flash II — the enrollment's result cards
}

export interface ReportAggregatorEventDetail {
  snapshotId: string;
  tenantId: string;
  schoolId: string;
  templateId: string;
  academicYearBs: string;
  schemaVersion: string;
  dryRun: boolean;
}

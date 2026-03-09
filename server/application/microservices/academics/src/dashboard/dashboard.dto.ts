/**
 * Dashboard DTOs
 *
 * Response types for the aggregated dashboard overview endpoint.
 */

export interface DashboardEnrollmentSummary {
  totalEnrolled: number;
  byGradeLevel: Record<string, number>;
  byStatus: Record<string, number>;
  recentEnrollments: number;
  recentWithdrawals: number;
}

export interface DashboardAttendanceSummary {
  date: string;
  totalStudents: number;
  totalRecorded: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  halfDay: number;
  remote: number;
  attendanceRate: number;
}

export interface DashboardOverviewDto {
  schoolId: string;
  academicYearId: string;
  date: string;

  /** Enrollment summary for the academic year */
  enrollment: DashboardEnrollmentSummary;

  /** Number of active sections for the school */
  activeSectionsCount: number;

  /** Today's attendance summary */
  attendance: DashboardAttendanceSummary | null;

  /** Internal: whether this response was served from cache */
  _cached: boolean;
}

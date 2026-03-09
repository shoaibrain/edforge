/**
 * Ed-Fi Attendance Descriptor Mapping
 *
 * Maps internal attendance statuses to Ed-Fi AttendanceEventCategoryDescriptor values.
 * Reference: https://api.ed-fi.org/v5.3/docs/index.html
 *
 * Ed-Fi AttendanceEventCategoryDescriptor values:
 * - In Attendance
 * - Excused Absence
 * - Unexcused Absence
 * - Tardy
 * - Early departure
 * - Partial
 *
 * Ed-Fi EducationalEnvironmentDescriptor values:
 * - Classroom
 * - Virtual/Online
 * - Homebound
 */

import type { AttendanceStatus } from '../entities/base.entity';

/**
 * Map internal status to Ed-Fi AttendanceEventCategoryDescriptor
 */
export function toEdFiAttendanceCategory(status: AttendanceStatus, excuseReason?: string): string {
  switch (status) {
    case 'present':
      return 'In Attendance';
    case 'absent':
      return excuseReason ? 'Excused Absence' : 'Unexcused Absence';
    case 'excused':
      return 'Excused Absence';
    case 'late':
    case 'tardy':
      return 'Tardy';
    case 'early_departure':
      return 'Early departure';
    case 'half_day':
      return 'Partial';
    case 'remote':
      return 'In Attendance';
    default:
      return 'In Attendance';
  }
}

/**
 * Map internal status to Ed-Fi EducationalEnvironmentDescriptor
 */
export function toEdFiEducationalEnvironment(status: AttendanceStatus): string {
  if (status === 'remote') return 'Virtual/Online';
  return 'Classroom';
}

/**
 * Map internal excuse reason to Ed-Fi AttendanceEventReason
 */
export function toEdFiAttendanceReason(
  status: AttendanceStatus,
  excuseReason?: string,
): string | undefined {
  if ((status === 'excused' || status === 'absent') && excuseReason) return excuseReason;
  if (status === 'absent') return 'Unexcused';
  return undefined;
}

/**
 * Populate Ed-Fi descriptors on an entity
 */
export function populateEdFiDescriptors(status: AttendanceStatus, excuseReason?: string) {
  return {
    attendanceEventCategory: toEdFiAttendanceCategory(status, excuseReason),
    attendanceEventReason: toEdFiAttendanceReason(status, excuseReason),
    educationalEnvironment: toEdFiEducationalEnvironment(status),
  };
}

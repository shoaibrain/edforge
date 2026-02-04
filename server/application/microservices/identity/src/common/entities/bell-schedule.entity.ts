/**
 * Bell Schedule Entity - Identity Service
 * 
 * DynamoDB Entity for school bell schedule management with Ed-Fi alignment.
 * 
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#BELL#{bellScheduleId}
 */

import { BaseEntity } from './base.entity';

// ============================================
// Bell Schedule Types
// ============================================

export type ScheduleDayType = 
  | 'regular'
  | 'early_release'
  | 'late_start'
  | 'assembly'
  | 'testing'
  | 'half_day'
  | 'special';

export type PeriodType = 
  | 'instructional'
  | 'homeroom'
  | 'lunch'
  | 'recess'
  | 'passing'
  | 'assembly'
  | 'advisory'
  | 'study_hall'
  | 'extracurricular';

export type DayOfWeek = 
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

// ============================================
// Class Period Interface
// ============================================

export interface ClassPeriod {
  classPeriodName: string;       // Ed-Fi: classPeriodName
  periodNumber: number;
  periodType: PeriodType;
  startTime: string;             // HH:MM format
  endTime: string;               // HH:MM format
  durationMinutes: number;
  dayOfWeek?: DayOfWeek[];       // For rotating schedules
  description?: string;
}

// ============================================
// Bell Schedule Entity Interface
// ============================================

export interface BellSchedule extends BaseEntity {
  entityType: 'BELLSCHEDULE';
  
  // Identifiers
  bellScheduleId: string;
  schoolId: string;
  
  // Ed-Fi Core Fields
  bellScheduleName: string;         // Ed-Fi: bellScheduleName
  alternateDayName?: string;        // Ed-Fi: alternateDayName (e.g., "A Day", "B Day")
  totalInstructionalTime: number;   // Ed-Fi: totalInstructionalTime (minutes)
  
  // EdForge Extensions
  dayType: ScheduleDayType;
  classPeriods: ClassPeriod[];
  startTime?: string;               // Overall day start
  endTime?: string;                 // Overall day end
  
  // Validity
  effectiveDate: string;
  endDate?: string;
  isDefault: boolean;
  isActive: boolean;
  
  // Computed
  periodCount: number;
  instructionalPeriodCount: number;
  
  // Notes
  description?: string;
}

// ============================================
// Entity Key Builders
// ============================================

export const BellScheduleKeyBuilder = {
  /**
   * Bell Schedule: SCHOOL#{schoolId}#BELL#{bellScheduleId}
   */
  bellSchedule: (schoolId: string, bellScheduleId: string): string => 
    `SCHOOL#${schoolId}#BELL#${bellScheduleId}`,
  
  /**
   * Bell Schedules for school (prefix): SCHOOL#{schoolId}#BELL#
   */
  bellSchedulesPrefix: (schoolId: string): string => 
    `SCHOOL#${schoolId}#BELL#`,
};

// ============================================
// Factory Function
// ============================================

export function createBellScheduleEntity(
  tenantId: string,
  schoolId: string,
  bellScheduleId: string,
  data: Omit<BellSchedule, 'tenantId' | 'entityKey' | 'entityType' | 'bellScheduleId' | 'schoolId' | 'periodCount' | 'instructionalPeriodCount'>
): BellSchedule {
  const classPeriods = data.classPeriods || [];
  const instructionalPeriods = classPeriods.filter(p => p.periodType === 'instructional');
  
  return {
    tenantId,
    entityKey: BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
    entityType: 'BELLSCHEDULE',
    bellScheduleId,
    schoolId,
    ...data,
    periodCount: classPeriods.length,
    instructionalPeriodCount: instructionalPeriods.length,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Calculate total instructional time from class periods
 */
export function calculateTotalInstructionalTime(classPeriods: ClassPeriod[]): number {
  return classPeriods
    .filter(p => p.periodType === 'instructional')
    .reduce((total, p) => total + p.durationMinutes, 0);
}

/**
 * Validate class periods don't overlap
 */
export function validatePeriodsNoOverlap(classPeriods: ClassPeriod[]): boolean {
  const sorted = [...classPeriods].sort((a, b) => a.startTime.localeCompare(b.startTime));
  
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < sorted[i - 1].endTime) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get period by time
 */
export function getPeriodByTime(
  bellSchedule: BellSchedule,
  time: string  // HH:MM format
): ClassPeriod | undefined {
  return bellSchedule.classPeriods.find(p => 
    time >= p.startTime && time < p.endTime
  );
}

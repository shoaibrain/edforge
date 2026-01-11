/**
 * Date Range Validators
 * 
 * Zod schemas and utilities for date validation.
 */

import { z } from 'zod';
import { dateSchema, isoDateSchema } from '../schemas/common';

// Re-export dateSchema from common for convenience
export { dateSchema } from '../schemas/common';

/**
 * ISO 8601 datetime string (re-export from common as alias)
 */
export const datetimeSchema = isoDateSchema;

// ============================================
// Date Range Schema
// ============================================

export const dateRangeSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
}).refine(
  data => new Date(data.endDate) >= new Date(data.startDate),
  { message: 'End date must be on or after start date' }
);

export type DateRange = z.infer<typeof dateRangeSchema>;

// ============================================
// Academic Year Date Range Schema
// ============================================

/**
 * Academic year must be between 120 and 365 days
 */
export const academicYearDateRangeSchema = dateRangeSchema.refine(
  data => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days >= 120 && days <= 365;
  },
  { message: 'Academic year must be between 120 and 365 days' }
);

export type AcademicYearDateRange = z.infer<typeof academicYearDateRangeSchema>;

// ============================================
// Grading Period Date Range Schema
// ============================================

/**
 * Grading period must be between 7 and 180 days
 */
export const gradingPeriodDateRangeSchema = dateRangeSchema.refine(
  data => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days >= 7 && days <= 180;
  },
  { message: 'Grading period must be between 7 and 180 days' }
);

export type GradingPeriodDateRange = z.infer<typeof gradingPeriodDateRangeSchema>;

// ============================================
// Utility Functions
// ============================================

/**
 * Parse a YYYY-MM-DD string to a Date object
 */
export function parseDate(dateString: string): Date {
  return new Date(dateString + 'T00:00:00.000Z');
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate the number of days between two dates
 */
export function daysBetween(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date falls within a date range (inclusive)
 */
export function isDateInRange(
  date: string,
  range: { startDate: string; endDate: string }
): boolean {
  const checkDate = parseDate(date);
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  
  return checkDate >= start && checkDate <= end;
}

/**
 * Check if two date ranges overlap
 */
export function doRangesOverlap(
  range1: { startDate: string; endDate: string },
  range2: { startDate: string; endDate: string }
): boolean {
  const start1 = parseDate(range1.startDate);
  const end1 = parseDate(range1.endDate);
  const start2 = parseDate(range2.startDate);
  const end2 = parseDate(range2.endDate);
  
  return start1 <= end2 && end1 >= start2;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayString(): string {
  return formatDate(new Date());
}

/**
 * Check if a date is in the past
 */
export function isDateInPast(dateString: string): boolean {
  const date = parseDate(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

/**
 * Check if a date is in the future
 */
export function isDateInFuture(dateString: string): boolean {
  const date = parseDate(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

/**
 * Add days to a date string
 */
export function addDays(dateString: string, days: number): string {
  const date = parseDate(dateString);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/**
 * Get the start and end dates for an academic year given a start month and year
 */
export function getAcademicYearDates(
  startYear: number,
  startMonth: number = 8, // August by default
  durationMonths: number = 10
): { startDate: string; endDate: string } {
  const startDate = new Date(startYear, startMonth - 1, 1);
  const endDate = new Date(startYear, startMonth - 1 + durationMonths, 0);
  
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * Generate grading period dates for an academic year
 */
export function generateGradingPeriods(
  academicYearStart: string,
  academicYearEnd: string,
  periodsCount: number
): Array<{ startDate: string; endDate: string; periodNumber: number }> {
  const totalDays = daysBetween(academicYearStart, academicYearEnd);
  const daysPerPeriod = Math.floor(totalDays / periodsCount);
  
  const periods: Array<{ startDate: string; endDate: string; periodNumber: number }> = [];
  let currentStart = academicYearStart;
  
  for (let i = 0; i < periodsCount; i++) {
    const isLastPeriod = i === periodsCount - 1;
    const endDate = isLastPeriod 
      ? academicYearEnd 
      : addDays(currentStart, daysPerPeriod - 1);
    
    periods.push({
      startDate: currentStart,
      endDate: endDate,
      periodNumber: i + 1,
    });
    
    if (!isLastPeriod) {
      currentStart = addDays(endDate, 1);
    }
  }
  
  return periods;
}

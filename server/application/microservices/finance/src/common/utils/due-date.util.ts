/**
 * Due Date Calculation Utility
 *
 * Calculates invoice due dates based on fee structure rules.
 */

import type { DueDateRule } from '../entities/fee-structure.entity';

/**
 * Calculate the invoice due date based on the fee structure's due date rule.
 *
 * @param rule - The due date rule from the fee structure (undefined → default +30 days)
 * @param enrollmentDate - ISO date string (YYYY-MM-DD) of the enrollment
 * @returns ISO date string (YYYY-MM-DD) for the due date
 */
export function calculateDueDate(
  rule: DueDateRule | undefined,
  enrollmentDate: string,
): string {
  const base = new Date(enrollmentDate + 'T00:00:00Z');

  if (!rule) {
    // Default: 30 days after enrollment
    base.setUTCDate(base.getUTCDate() + 30);
    return toDateString(base);
  }

  switch (rule.type) {
    case 'on_enrollment':
      return toDateString(base);

    case 'days_after_enrollment': {
      const days = rule.days ?? 30;
      base.setUTCDate(base.getUTCDate() + days);
      return toDateString(base);
    }

    case 'fixed_day_of_month': {
      const dayOfMonth = rule.dayOfMonth ?? 1;
      // Find the next occurrence of dayOfMonth after enrollmentDate
      let year = base.getUTCFullYear();
      let month = base.getUTCMonth();

      // If the day has already passed this month, move to next month
      if (base.getUTCDate() >= dayOfMonth) {
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }

      // Clamp to last day of month (e.g., dayOfMonth=28 in Feb)
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const clampedDay = Math.min(dayOfMonth, lastDay);
      return toDateString(new Date(Date.UTC(year, month, clampedDay)));
    }

    default:
      // Unknown rule type — fall back to +30 days
      base.setUTCDate(base.getUTCDate() + 30);
      return toDateString(base);
  }
}

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

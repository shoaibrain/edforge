/**
 * Pro-Rate Service
 *
 * Calculates proportional amounts for mid-term enrollment.
 */

import { Injectable } from '@nestjs/common';
import type { FeeFrequency } from '@aibrains/shared-types';

export interface ProRateParams {
  fullAmount: number;
  termStartDate: string;
  termEndDate: string;
  enrollmentDate: string;
  frequency: FeeFrequency;
  proRateEnabled: boolean;
}

@Injectable()
export class ProRateService {
  /**
   * Calculate pro-rated amount for mid-term enrollment.
   *
   * - one_time fees: always full amount
   * - monthly fees: full month amount (no partial months)
   * - quarterly/annual fees: proportional to remaining days
   * - If proRateEnabled is false, always return full amount
   */
  calculateProRatedAmount(params: ProRateParams): number {
    const { fullAmount, termStartDate, termEndDate, enrollmentDate, frequency, proRateEnabled } = params;

    // No pro-rating for one-time fees or when disabled
    if (!proRateEnabled || frequency === 'one_time') {
      return fullAmount;
    }

    // Monthly: charge full month (no partial month pro-rating)
    if (frequency === 'monthly') {
      return fullAmount;
    }

    // Quarterly/Annual: pro-rate based on remaining days
    const start = new Date(termStartDate);
    const end = new Date(termEndDate);
    const enrollment = new Date(enrollmentDate);

    // Validate date boundaries
    if (end <= start) {
      return fullAmount;
    }

    // If enrolled on or before start, full amount
    if (enrollment <= start) {
      return fullAmount;
    }

    // If enrolled after end, no charge (edge case)
    if (enrollment >= end) {
      return 0;
    }

    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const remainingDays = Math.ceil((end.getTime() - enrollment.getTime()) / (1000 * 60 * 60 * 24));

    if (totalDays <= 0) return fullAmount;

    // Pro-rate and round to nearest integer (NPR has no decimals)
    const proRated = Math.round(fullAmount * (remainingDays / totalDays));

    // Minimum 1-day charge
    return Math.max(proRated, Math.round(fullAmount / totalDays));
  }
}

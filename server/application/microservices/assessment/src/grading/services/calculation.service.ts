import { Injectable } from '@nestjs/common';
import type { GradingScale, GradeRange } from '@edforge/shared-types';

@Injectable()
export class CalculationService {
  
  /**
   * Calculate percentage from score and max points
   */
  calculatePercentage(score: number, maxPoints: number): number {
    if (maxPoints === 0) return 0;
    return Math.round((score / maxPoints) * 100 * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate letter grade based on percentage and grading scale
   */
  calculateLetterGrade(percentage: number, gradingScale: GradingScale): string {
    for (const range of gradingScale.ranges) {
      if (percentage >= range.minPercentage && percentage <= range.maxPercentage) {
        return range.letterGrade;
      }
    }
    return 'F'; // Default if no range matches
  }

  /**
   * Apply late submission penalty
   */
  applyLatePenalty(
    score: number,
    maxPoints: number,
    daysLate: number,
    penaltyPercentagePerDay: number
  ): { finalScore: number; penaltyApplied: number } {
    const totalPenaltyPercentage = Math.min(daysLate * penaltyPercentagePerDay, 100);
    const penaltyPoints = (maxPoints * totalPenaltyPercentage) / 100;
    const finalScore = Math.max(score - penaltyPoints, 0);
    
    return {
      finalScore: Math.round(finalScore * 100) / 100,
      penaltyApplied: totalPenaltyPercentage
    };
  }

  /**
   * Calculate weighted average for a student's grades
   * Used for calculating final course grade
   */
  calculateWeightedAverage(
    grades: Array<{ score: number; maxPoints: number; weight?: number }>
  ): number {
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const grade of grades) {
      const weight = grade.weight || 1; // Default weight of 1 if not specified
      const percentage = this.calculatePercentage(grade.score, grade.maxPoints);
      totalWeightedScore += percentage * weight;
      totalWeight += weight;
    }

    return totalWeight === 0 ? 0 : Math.round((totalWeightedScore / totalWeight) * 100) / 100;
  }

  /**
   * Calculate GPA from letter grade
   */
  calculateGPA(letterGrade: string, gradingScale: GradingScale): number {
    for (const range of gradingScale.ranges) {
      if (range.letterGrade === letterGrade) {
        return range.gradePoints;
      }
    }
    return 0.0;
  }

  /**
   * Get default grading scale (standard US letter grades)
   */
  getDefaultGradingScale(): GradingScale {
    return {
      scaleId: 'default-letter-grade',
      scaleName: 'Standard Letter Grade',
      type: 'letter',
      ranges: [
        { minPercentage: 93, maxPercentage: 100, letterGrade: 'A', gradePoints: 4.0 },
        { minPercentage: 90, maxPercentage: 92.99, letterGrade: 'A-', gradePoints: 3.7 },
        { minPercentage: 87, maxPercentage: 89.99, letterGrade: 'B+', gradePoints: 3.3 },
        { minPercentage: 83, maxPercentage: 86.99, letterGrade: 'B', gradePoints: 3.0 },
        { minPercentage: 80, maxPercentage: 82.99, letterGrade: 'B-', gradePoints: 2.7 },
        { minPercentage: 77, maxPercentage: 79.99, letterGrade: 'C+', gradePoints: 2.3 },
        { minPercentage: 73, maxPercentage: 76.99, letterGrade: 'C', gradePoints: 2.0 },
        { minPercentage: 70, maxPercentage: 72.99, letterGrade: 'C-', gradePoints: 1.7 },
        { minPercentage: 67, maxPercentage: 69.99, letterGrade: 'D+', gradePoints: 1.3 },
        { minPercentage: 63, maxPercentage: 66.99, letterGrade: 'D', gradePoints: 1.0 },
        { minPercentage: 60, maxPercentage: 62.99, letterGrade: 'D-', gradePoints: 0.7 },
        { minPercentage: 0, maxPercentage: 59.99, letterGrade: 'F', gradePoints: 0.0 },
      ]
    };
  }

  /**
   * Calculate days late between due date and submission date
   */
  calculateDaysLate(dueDate: string, submittedAt: string): number {
    const due = new Date(dueDate);
    const submitted = new Date(submittedAt);
    
    if (submitted <= due) return 0;
    
    const diff = submitted.getTime() - due.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  }

  /**
   * Calculate rubric total score
   */
  calculateRubricTotal(rubricScores: Array<{ pointsEarned: number }>): number {
    return rubricScores.reduce((total, score) => total + score.pointsEarned, 0);
  }
}


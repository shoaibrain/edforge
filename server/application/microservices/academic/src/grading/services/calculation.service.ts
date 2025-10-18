import { Injectable } from '@nestjs/common';
import { GradingScale, GradeRange } from '../entities/grading.entity';

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
      if (percentage >= range.min && percentage <= range.max) {
        return range.letter;
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
      if (range.letter === letterGrade && range.gpa !== undefined) {
        return range.gpa;
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
      name: 'Standard Letter Grade',
      type: 'letter',
      ranges: [
        { min: 93, max: 100, letter: 'A', gpa: 4.0 },
        { min: 90, max: 92.99, letter: 'A-', gpa: 3.7 },
        { min: 87, max: 89.99, letter: 'B+', gpa: 3.3 },
        { min: 83, max: 86.99, letter: 'B', gpa: 3.0 },
        { min: 80, max: 82.99, letter: 'B-', gpa: 2.7 },
        { min: 77, max: 79.99, letter: 'C+', gpa: 2.3 },
        { min: 73, max: 76.99, letter: 'C', gpa: 2.0 },
        { min: 70, max: 72.99, letter: 'C-', gpa: 1.7 },
        { min: 67, max: 69.99, letter: 'D+', gpa: 1.3 },
        { min: 63, max: 66.99, letter: 'D', gpa: 1.0 },
        { min: 60, max: 62.99, letter: 'D-', gpa: 0.7 },
        { min: 0, max: 59.99, letter: 'F', gpa: 0.0 },
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


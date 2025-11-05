/**
 * GPA Calculation Service
 * 
 * Handles all GPA-related calculations:
 * - Unweighted GPA (standard 4.0 scale)
 * - Weighted GPA (honors/AP courses)
 * - Term/Semester GPA
 * - Cumulative GPA
 * - Class rank percentiles
 * 
 * Supports multiple grading scales and international systems
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Grade, GradingScale, GradeRange } from '@edforge/shared-types';

export interface GPAResult {
  gpa: number;
  totalCredits: number;
  totalQualityPoints: number;
  gradeCount: number;
  letterGradeEquivalent?: string;
  percentile?: number;
}

export interface TermGPAResult extends GPAResult {
  termId: string;
  termName: string;
}

export interface CumulativeGPAResult extends GPAResult {
  termGPAs: TermGPAResult[];
  overallTrend: 'improving' | 'declining' | 'stable';
}

export interface ClassRankResult {
  studentId: string;
  rank: number;
  totalStudents: number;
  percentile: number;
  gpa: number;
}

@Injectable()
export class GPACalculationService {
  private readonly logger = new Logger(GPACalculationService.name);
  
  /**
   * Calculate unweighted GPA for a set of grades
   * 
   * Formula: GPA = Σ(grade_points × credits) / Σ(credits)
   * 
   * @param grades - Array of final grades
   * @param gradingScale - Grading scale to use for conversion
   * @param creditHours - Optional map of assignmentId to credit hours (defaults to 1.0)
   */
  calculateGPA(
    grades: Grade[],
    gradingScale: GradingScale,
    creditHours?: Map<string, number>
  ): GPAResult {
    let totalQualityPoints = 0;
    let totalCredits = 0;
    let gradeCount = 0;
    
    for (const grade of grades) {
      // Skip non-final, excused, or incomplete grades
      if (!grade.isFinal || grade.isExcused || grade.status !== 'published') {
        continue;
      }
      
      const credits = creditHours?.get(grade.assignmentId) || 1.0;
      const gradePoints = this.getGradePoints(grade.percentage, gradingScale);
      
      totalQualityPoints += gradePoints * credits;
      totalCredits += credits;
      gradeCount++;
    }
    
    const gpa = totalCredits > 0 ? totalQualityPoints / totalCredits : 0;
    const roundedGPA = Math.round(gpa * 100) / 100;  // Round to 2 decimals
    
    // Get letter grade equivalent for GPA
    const letterGradeEquivalent = this.getLetterGradeFromGPA(roundedGPA, gradingScale);
    
    return {
      gpa: roundedGPA,
      totalCredits,
      totalQualityPoints,
      gradeCount,
      letterGradeEquivalent
    };
  }
  
  /**
   * Calculate weighted GPA (for honors, AP, IB courses)
   * 
   * Weighted GPA gives extra points for advanced courses:
   * - Regular courses: 1.0x multiplier
   * - Honors courses: 1.5x multiplier
   * - AP/IB courses: 2.0x multiplier
   * 
   * @param grades - Array of final grades
   * @param gradingScale - Base grading scale
   * @param courseWeights - Map of classroomId to weight multiplier
   * @param creditHours - Optional credit hours per assignment
   */
  calculateWeightedGPA(
    grades: Grade[],
    gradingScale: GradingScale,
    courseWeights: Map<string, number>,
    creditHours?: Map<string, number>
  ): GPAResult {
    let totalQualityPoints = 0;
    let totalCredits = 0;
    let gradeCount = 0;
    
    for (const grade of grades) {
      if (!grade.isFinal || grade.isExcused || grade.status !== 'published') {
        continue;
      }
      
      const credits = creditHours?.get(grade.assignmentId) || 1.0;
      const baseGradePoints = this.getGradePoints(grade.percentage, gradingScale);
      const courseWeight = courseWeights.get(grade.classroomId) || 1.0;
      
      // Apply course weight to grade points
      const weightedGradePoints = baseGradePoints * courseWeight;
      
      totalQualityPoints += weightedGradePoints * credits;
      totalCredits += credits;
      gradeCount++;
    }
    
    const gpa = totalCredits > 0 ? totalQualityPoints / totalCredits : 0;
    const roundedGPA = Math.round(gpa * 100) / 100;
    
    return {
      gpa: roundedGPA,
      totalCredits,
      totalQualityPoints,
      gradeCount
    };
  }
  
  /**
   * Get grade points from percentage using grading scale
   */
  private getGradePoints(
    percentage: number,
    gradingScale: GradingScale
  ): number {
    for (const range of gradingScale.ranges) {
      if (percentage >= range.minPercentage && percentage <= range.maxPercentage) {
        return range.gradePoints;
      }
    }
    
    this.logger.warn(`No grade range found for percentage ${percentage} in scale ${gradingScale.scaleName}`);
    return 0;  // Default if no range matches
  }
  
  /**
   * Get letter grade from GPA value
   */
  private getLetterGradeFromGPA(
    gpa: number,
    gradingScale: GradingScale
  ): string {
    // Find the range that matches this GPA value
    for (const range of gradingScale.ranges) {
      if (gpa >= range.gradePoints) {
        return range.letterGrade;
      }
    }
    
    return gradingScale.ranges[gradingScale.ranges.length - 1]?.letterGrade || 'F';
  }
  
  /**
   * Calculate GPA for a specific term/semester
   * 
   * @param grades - All grades for the student
   * @param termId - Specific term to calculate for
   * @param gradingScale - Grading scale to use
   */
  calculateTermGPA(
    grades: Grade[],
    termId: string,
    termName: string,
    gradingScale: GradingScale,
    creditHours?: Map<string, number>
  ): TermGPAResult {
    // Filter grades for this term
    const termGrades = grades.filter(g => g.termId === termId);
    
    const gpaResult = this.calculateGPA(termGrades, gradingScale, creditHours);
    
    return {
      termId,
      termName,
      ...gpaResult
    };
  }
  
  /**
   * Calculate cumulative GPA across all terms
   * 
   * @param grades - All grades for the student
   * @param terms - Array of term IDs and names
   * @param gradingScale - Grading scale to use
   */
  calculateCumulativeGPA(
    grades: Grade[],
    terms: Array<{ termId: string; termName: string }>,
    gradingScale: GradingScale,
    creditHours?: Map<string, number>
  ): CumulativeGPAResult {
    // Calculate GPA for each term
    const termGPAs: TermGPAResult[] = terms.map(term =>
      this.calculateTermGPA(grades, term.termId, term.termName, gradingScale, creditHours)
    );
    
    // Calculate overall cumulative GPA from ALL grades
    const cumulativeGPA = this.calculateGPA(grades, gradingScale, creditHours);
    
    // Analyze trend across terms
    const overallTrend = this.analyzeGPATrend(termGPAs);
    
    return {
      ...cumulativeGPA,
      termGPAs,
      overallTrend
    };
  }
  
  /**
   * Analyze GPA trend across terms
   */
  private analyzeGPATrend(termGPAs: TermGPAResult[]): 'improving' | 'declining' | 'stable' {
    if (termGPAs.length < 2) return 'stable';
    
    // Compare last 2 terms
    const lastTerm = termGPAs[termGPAs.length - 1];
    const previousTerm = termGPAs[termGPAs.length - 2];
    
    const difference = lastTerm.gpa - previousTerm.gpa;
    const threshold = 0.2; // 0.2 GPA point change is significant
    
    if (difference > threshold) return 'improving';
    if (difference < -threshold) return 'declining';
    return 'stable';
  }
  
  /**
   * Calculate class rank for a student
   * 
   * @param studentGPA - The student's GPA
   * @param allStudentGPAs - GPAs of all students in the class/cohort
   */
  calculateClassRank(
    studentId: string,
    studentGPA: number,
    allStudentGPAs: Array<{ studentId: string; gpa: number }>
  ): ClassRankResult {
    // Sort by GPA descending
    const sorted = [...allStudentGPAs].sort((a, b) => b.gpa - a.gpa);
    
    // Find student's rank (1-based)
    const rank = sorted.findIndex(s => s.studentId === studentId) + 1;
    const totalStudents = sorted.length;
    
    // Calculate percentile (higher is better)
    // Top student = 100th percentile, bottom = 0th percentile
    const percentile = totalStudents > 1
      ? Math.round(((totalStudents - rank) / (totalStudents - 1)) * 100)
      : 100;
    
    return {
      studentId,
      rank,
      totalStudents,
      percentile,
      gpa: studentGPA
    };
  }
  
  /**
   * Calculate honor roll eligibility
   * 
   * Typical criteria:
   * - Honor Roll: 3.0-3.49 GPA
   * - High Honor Roll: 3.5-3.79 GPA
   * - Highest Honor Roll: 3.8-4.0 GPA
   */
  calculateHonorRollStatus(
    gpa: number,
    gpaScale: number = 4.0
  ): 'highest_honors' | 'high_honors' | 'honor_roll' | 'none' {
    // Normalize to 4.0 scale if different
    const normalizedGPA = (gpa / gpaScale) * 4.0;
    
    if (normalizedGPA >= 3.8) return 'highest_honors';
    if (normalizedGPA >= 3.5) return 'high_honors';
    if (normalizedGPA >= 3.0) return 'honor_roll';
    return 'none';
  }
  
  /**
   * Project future GPA based on current trend
   * Uses simple linear regression on term GPAs
   */
  projectFutureGPA(
    termGPAs: TermGPAResult[],
    termsAhead: number = 1
  ): number {
    if (termGPAs.length < 2) {
      return termGPAs[termGPAs.length - 1]?.gpa || 0;
    }
    
    // Simple linear trend projection
    const recentGPAs = termGPAs.slice(-3).map(t => t.gpa); // Last 3 terms
    const avgChange = (recentGPAs[recentGPAs.length - 1] - recentGPAs[0]) / (recentGPAs.length - 1);
    
    const projectedGPA = recentGPAs[recentGPAs.length - 1] + (avgChange * termsAhead);
    
    // Clamp to valid range [0, max GPA scale]
    return Math.max(0, Math.min(projectedGPA, 4.0));
  }
}


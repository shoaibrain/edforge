import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateGradeDto, UpdateGradeDto, CreateGradingScaleDto } from '../dto/grading.dto';

@Injectable()
export class ValidationService {
  
  /**
   * Validate grade creation
   */
  async validateGradeCreation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    data: CreateGradeDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate score does not exceed max points
    if (data.score > data.maxPoints) {
      errors.push('Score cannot exceed max points');
    }

    // Validate score is not negative
    if (data.score < 0) {
      errors.push('Score cannot be negative');
    }

    // Validate max points is positive
    if (data.maxPoints <= 0) {
      errors.push('Max points must be greater than 0');
    }

    // Validate late submission data (removed daysLate requirement)

    // Validate rubric scores
    if (data.rubricScores && data.rubricScores.length > 0) {
      for (const rubric of data.rubricScores) {
        if (rubric.pointsEarned > rubric.maxPoints) {
          errors.push(`Rubric "${rubric.criteriaName}": points earned cannot exceed max points`);
        }
        if (rubric.pointsEarned < 0) {
          errors.push(`Rubric "${rubric.criteriaName}": points earned cannot be negative`);
        }
      }

      // Check if rubric total matches grade score
      const rubricTotal = data.rubricScores.reduce((sum, r) => sum + r.pointsEarned, 0);
      if (Math.abs(rubricTotal - data.score) > 0.01) { // Allow small floating point differences
        errors.push(`Rubric total (${rubricTotal}) must match grade score (${data.score})`);
      }
    }

    // Submission date validation removed (not in DTO)

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Grade validation failed',
        errors
      });
    }
  }

  /**
   * Validate grade update
   */
  async validateGradeUpdate(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    gradeId: string,
    data: UpdateGradeDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate score vs max points if both provided
    if (data.score !== undefined && data.maxPoints !== undefined) {
      if (data.score > data.maxPoints) {
        errors.push('Score cannot exceed max points');
      }
    }

    // Validate score
    if (data.score !== undefined && data.score < 0) {
      errors.push('Score cannot be negative');
    }

    // Validate max points
    if (data.maxPoints !== undefined && data.maxPoints <= 0) {
      errors.push('Max points must be greater than 0');
    }

    // Validate rubric scores
    if (data.rubricScores && data.rubricScores.length > 0) {
      for (const rubric of data.rubricScores) {
        if (rubric.pointsEarned > rubric.maxPoints) {
          errors.push(`Rubric "${rubric.criteriaName}": points earned cannot exceed max points`);
        }
        if (rubric.pointsEarned < 0) {
          errors.push(`Rubric "${rubric.criteriaName}": points earned cannot be negative`);
        }
      }

      // If score is provided, check rubric total matches
      if (data.score !== undefined) {
        const rubricTotal = data.rubricScores.reduce((sum, r) => sum + r.pointsEarned, 0);
        if (Math.abs(rubricTotal - data.score) > 0.01) {
          errors.push(`Rubric total (${rubricTotal}) must match grade score (${data.score})`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Grade validation failed',
        errors
      });
    }
  }

  /**
   * Validate grading scale creation
   */
  async validateGradingScaleCreation(
    tenantId: string,
    schoolId: string,
    data: CreateGradingScaleDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate ranges
    if (!data.ranges || data.ranges.length === 0) {
      errors.push('At least one grade range must be defined');
    }

    // Validate each range
    for (const range of data.ranges) {
      if (range.min > range.max) {
        errors.push(`Range "${range.letter}": min (${range.min}) cannot be greater than max (${range.max})`);
      }
      
      if (range.min < 0 || range.max > 100) {
        errors.push(`Range "${range.letter}": percentages must be between 0 and 100`);
      }
    }

    // Check for overlapping ranges
    const sortedRanges = [...data.ranges].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sortedRanges.length - 1; i++) {
      if (sortedRanges[i].max >= sortedRanges[i + 1].min) {
        errors.push(`Overlapping ranges detected: "${sortedRanges[i].letter}" and "${sortedRanges[i + 1].letter}"`);
      }
    }

    // Check for gaps in coverage (optional warning, not blocking)
    const fullCoverage = sortedRanges[0].min === 0 && sortedRanges[sortedRanges.length - 1].max === 100;
    if (!fullCoverage) {
      console.warn('Warning: Grading scale does not cover full 0-100 range');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Grading scale validation failed',
        errors
      });
    }
  }
}


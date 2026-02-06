/**
 * GPA Calculator Service
 *
 * Computes GPA from finalized Grade documents.
 * Supports unweighted (standard 4.0) and weighted (honors/AP) calculations.
 */

import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { Grade } from '../common/entities/grade.entity';
import { Course } from '../common/entities/course.entity';
import { RequestContext } from '../common/entities/base.entity';

export interface GpaResult {
  studentId: string;
  academicYearId: string;
  cumulativeGpa: number | null;
  weightedGpa: number | null;
  totalCredits: number;
  termGpas: {
    termId: string;
    gpa: number;
    weightedGpa: number;
    credits: number;
  }[];
}

@Injectable()
export class GpaCalculatorService {
  private readonly logger = new Logger(GpaCalculatorService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Calculate GPA for a student in an academic year.
   *
   * 1. Query all Grade docs via GSI2 (studentId, GRADE#{yearId}#)
   * 2. Filter to finalized grades only
   * 3. Look up course credits via batchGetItems
   * 4. Compute unweighted and weighted GPAs
   */
  async calculateGpa(
    studentId: string,
    academicYearId: string,
    context: RequestContext,
  ): Promise<GpaResult> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get all grades for student in this academic year
    const gradeResult = await this.dynamoDBClient.queryGSI<Grade>(
      client,
      'GSI2',
      studentId,
      `GRADE#${academicYearId}#`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
    );

    const grades = gradeResult.items;

    // Only use finalized grades for GPA
    const finalGrades = grades.filter(g => g.isFinal && g.gpaPoints !== undefined);

    if (finalGrades.length === 0) {
      return {
        studentId,
        academicYearId,
        cumulativeGpa: null,
        weightedGpa: null,
        totalCredits: 0,
        termGpas: [],
      };
    }

    // Fetch course details for credit info
    const courseKeys = [...new Set(finalGrades.map(g => g.courseId))].map(courseId => ({
      tenantId: context.tenantId,
      entityKey: `COURSE#${finalGrades.find(g => g.courseId === courseId)!.schoolId}#${courseId}`,
    }));

    let courses: Course[] = [];
    if (courseKeys.length > 0) {
      courses = await this.dynamoDBClient.batchGetItems<Course>(client, courseKeys);
    }

    const courseMap = new Map(courses.map(c => [c.courseId, c]));

    // Group by term
    const byTerm = new Map<string, Grade[]>();
    for (const g of finalGrades) {
      if (!byTerm.has(g.termId)) {
        byTerm.set(g.termId, []);
      }
      byTerm.get(g.termId)!.push(g);
    }

    // Calculate per-term and cumulative GPA
    let totalQualityPoints = 0;
    let totalWeightedQualityPoints = 0;
    let totalCredits = 0;
    const termGpas: GpaResult['termGpas'] = [];

    for (const [termId, termGrades] of byTerm) {
      let termQP = 0;
      let termWeightedQP = 0;
      let termCredits = 0;

      for (const g of termGrades) {
        const course = courseMap.get(g.courseId);
        const credits = g.credits || course?.credits || 1;
        const gpaPoints = g.gpaPoints || 0;

        // Unweighted: standard 4.0 scale
        termQP += gpaPoints * credits;

        // Weighted: honors/AP courses get bonus
        const creditType = course?.creditType;
        let weightedGpaPoints = gpaPoints;
        if (creditType === 'honors' && gpaPoints > 0) {
          weightedGpaPoints = Math.min(gpaPoints + 0.5, 4.5);
        } else if (creditType === 'ap' && gpaPoints > 0) {
          weightedGpaPoints = Math.min(gpaPoints + 1.0, 5.0);
        }
        termWeightedQP += weightedGpaPoints * credits;

        termCredits += credits;
      }

      const termGpa = termCredits > 0 ? Math.round((termQP / termCredits) * 100) / 100 : 0;
      const termWeightedGpa = termCredits > 0
        ? Math.round((termWeightedQP / termCredits) * 100) / 100
        : 0;

      termGpas.push({
        termId,
        gpa: termGpa,
        weightedGpa: termWeightedGpa,
        credits: termCredits,
      });

      totalQualityPoints += termQP;
      totalWeightedQualityPoints += termWeightedQP;
      totalCredits += termCredits;
    }

    const cumulativeGpa = totalCredits > 0
      ? Math.round((totalQualityPoints / totalCredits) * 100) / 100
      : null;
    const weightedGpa = totalCredits > 0
      ? Math.round((totalWeightedQualityPoints / totalCredits) * 100) / 100
      : null;

    return {
      studentId,
      academicYearId,
      cumulativeGpa,
      weightedGpa,
      totalCredits,
      termGpas,
    };
  }
}

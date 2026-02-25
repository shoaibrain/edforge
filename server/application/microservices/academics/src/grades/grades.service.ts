/**
 * Grades Service
 *
 * Core grade recording and calculation using the embedded assignments model.
 * Each Grade document contains an array of AssignmentGrades and computed
 * CategoryGrades, with overall numericGrade/letterGrade/gpaPoints.
 *
 * Ed-Fi Alignment: Maps to Ed-Fi Grade and StudentSectionAssociation.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { GradingPolicyService } from './grading-policy.service';
import {
  Grade,
  AssignmentGrade,
  AssessmentCategory,
  CategoryGrade,
  createGradeEntity,
  GradingScaleEntry,
  CategoryWeight,
} from '../common/entities/grade.entity';
import { CourseSection } from '../common/entities/course.entity';
import { GradingPolicyEntity } from '../common/entities/grading-policy.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  GradeLetter,
} from '../common/entities/base.entity';
import { GradeResponseDto, gradeEntityToDto } from '../common/mappers/grade.mapper';

export interface RecordAssignmentGradeDto {
  studentId: string;
  studentName?: string;
  schoolId: string;
  courseId: string;
  courseName?: string;
  sectionId?: string;
  termId: string;
  academicYearId: string;
  teacherId: string;
  assignment: {
    assignmentId?: string;
    assignmentName: string;
    assignmentType: AssignmentGrade['assignmentType'];
    categoryId?: string;
    assessmentCategory?: AssessmentCategory;
    dueDate?: string;
    earnedPoints?: number;
    possiblePoints: number;
    isExtraCredit?: boolean;
    isMissing?: boolean;
    isExcused?: boolean;
    comment?: string;
  };
}

export interface BulkRecordGradeDto {
  schoolId: string;
  sectionId: string;
  courseId: string;
  courseName?: string;
  termId: string;
  academicYearId: string;
  teacherId: string;
  assignment: {
    assignmentId?: string;
    assignmentName: string;
    assignmentType: AssignmentGrade['assignmentType'];
    categoryId?: string;
    assessmentCategory?: AssessmentCategory;
    dueDate?: string;
    possiblePoints: number;
    isExtraCredit?: boolean;
  };
  grades: {
    studentId: string;
    studentName?: string;
    earnedPoints?: number;
    isMissing?: boolean;
    isExcused?: boolean;
    comment?: string;
  }[];
}

export interface GradeOverviewResponse {
  totalStudentsGraded: number;
  averageGpa: number;
  averageGrade: number;
  passRate: number;
  atRiskCount: number;
  gradeDistribution: { range: string; count: number }[];
  coursePerformance: {
    courseId: string;
    courseName: string;
    sectionCount: number;
    studentCount: number;
    avgGrade: number;
    avgGpa: number;
    passRate: number;
  }[];
  atRiskStudents: {
    studentId: string;
    studentName: string;
    courseId: string;
    courseName: string;
    numericGrade: number;
    letterGrade: string | null;
  }[];
  totalSections: number;
  sectionsWithGrades: number;
  assessmentBreakdown: {
    formative: { count: number; avgScore: number };
    summative: { count: number; avgScore: number };
    unclassified: { count: number; avgScore: number };
  };
  gradingProgress: {
    totalAssignmentEntries: number;
    gradedEntries: number;
    ungradedStubs: number;
    completionRate: number;
  };
  categoryPerformance: {
    categoryId: string;
    categoryName: string;
    assignmentCount: number;
    avgScore: number;
  }[];
}

@Injectable()
export class GradesService {
  private readonly logger = new Logger(GradesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly gradingPolicyService: GradingPolicyService,
    private readonly dataScopeService: DataScopeService,
  ) {}

  /**
   * Record a single assignment grade for a student.
   *
   * Finds or creates the Grade document for the student+course+term,
   * appends/updates the assignment, and recalculates.
   */
  async recordAssignmentGrade(
    dto: RecordAssignmentGradeDto,
    context: RequestContext,
    preloadedPolicy?: GradingPolicyEntity | null,
  ): Promise<GradeResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.grade(dto.studentId, dto.courseId, dto.termId);

    // Validate score
    if (
      dto.assignment.earnedPoints !== undefined &&
      !dto.assignment.isExtraCredit &&
      dto.assignment.earnedPoints > dto.assignment.possiblePoints
    ) {
      throw new BadRequestException(
        `Earned points (${dto.assignment.earnedPoints}) cannot exceed possible points (${dto.assignment.possiblePoints})`,
      );
    }

    // Find existing grade document
    let grade = await this.dynamoDBClient.getItem<Grade>(
      client,
      context.tenantId,
      entityKey,
    );

    // Get grading policy for recalculation (use preloaded if provided)
    const policy = preloadedPolicy !== undefined
      ? preloadedPolicy
      : await this.gradingPolicyService.getDefaultPolicyEntity(dto.schoolId, context);

    const now = new Date().toISOString();
    const assignmentId = dto.assignment.assignmentId || uuid();

    const resolvedCategory = this.resolveAssessmentCategory(
      dto.assignment.assessmentCategory,
      dto.assignment.categoryId,
      dto.assignment.assignmentType,
      policy,
    );

    const assignmentGrade: AssignmentGrade = {
      assignmentId,
      assignmentName: dto.assignment.assignmentName,
      assignmentType: dto.assignment.assignmentType,
      categoryId: dto.assignment.categoryId,
      assessmentCategory: resolvedCategory,
      dueDate: dto.assignment.dueDate,
      earnedPoints: dto.assignment.earnedPoints,
      possiblePoints: dto.assignment.possiblePoints,
      percentage:
        dto.assignment.earnedPoints !== undefined
          ? Math.round((dto.assignment.earnedPoints / dto.assignment.possiblePoints) * 10000) / 100
          : undefined,
      isExtraCredit: dto.assignment.isExtraCredit,
      isMissing: dto.assignment.isMissing,
      isExcused: dto.assignment.isExcused,
      comment: dto.assignment.comment,
      gradedBy: context.userId,
      gradedAt: now,
    };

    // Resolve courseName from section if not provided by caller
    if (!dto.courseName && dto.sectionId) {
      const sectionResult = await this.dynamoDBClient.queryGSI<CourseSection>(
        client,
        'GSI1',
        GSIKeyBuilder.schoolScope(context.tenantId, dto.schoolId),
        `SECTION#${dto.courseId}#`,
        'begins_with',
        undefined,
        undefined,
        undefined,
        1,
      );
      if (sectionResult.items.length > 0 && sectionResult.items[0].courseName) {
        dto.courseName = sectionResult.items[0].courseName;
      }
    }

    if (grade) {
      // Retry loop for optimistic locking — re-read and re-apply on conflict
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Check if finalized
        if (grade.isFinal) {
          throw new ConflictException(
            `Grade for student ${dto.studentId} in course ${dto.courseId} term ${dto.termId} is already finalized`,
          );
        }

        // Update existing — append or replace assignment
        const assignments = [...(grade.assignments || [])];
        // Check by ID first (exact match), then by name+category (semantic match for stubs)
        let existingIdx = assignments.findIndex(a => a.assignmentId === assignmentId);
        if (existingIdx < 0) {
          existingIdx = assignments.findIndex(
            a => a.assignmentName === assignmentGrade.assignmentName
              && a.categoryId === assignmentGrade.categoryId
              && a.earnedPoints === undefined // Only merge with ungraded stubs
          );
        }
        if (existingIdx >= 0) {
          assignments[existingIdx] = assignmentGrade;
        } else {
          assignments.push(assignmentGrade);
        }

        // Recalculate
        const calculated = this.calculateGrade(assignments, policy);

        // Build update expression — backfill names if not already set
        let updateExpr = 'SET assignments = :assignments, categoryGrades = :categoryGrades, numericGrade = :numericGrade, letterGrade = :letterGrade, gpaPoints = :gpaPoints, isPassing = :isPassing, lastCalculatedAt = :lastCalculatedAt, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc';
        const exprValues: Record<string, any> = {
          ':assignments': assignments,
          ':categoryGrades': calculated.categoryGrades,
          ':numericGrade': calculated.numericGrade,
          ':letterGrade': calculated.letterGrade ?? null,
          ':gpaPoints': calculated.gpaPoints ?? null,
          ':isPassing': calculated.isPassing,
          ':lastCalculatedAt': now,
          ':updatedAt': now,
          ':updatedBy': context.userId,
          ':inc': 1,
        };

        if (dto.studentName && !grade.studentName) {
          updateExpr += ', studentName = :studentName';
          exprValues[':studentName'] = dto.studentName;
        }

        if (dto.courseName && !grade.courseName) {
          updateExpr += ', courseName = :courseName';
          exprValues[':courseName'] = dto.courseName;
        }

        // Lazy-migrate GSI2SK to include courseId if missing
        const expectedGsi2sk = `GRADE#${dto.academicYearId}#${dto.termId}#${dto.courseId}`;
        if (grade.gsi2sk !== expectedGsi2sk) {
          updateExpr += ', gsi2sk = :gsi2sk';
          exprValues[':gsi2sk'] = expectedGsi2sk;
        }

        // Optimistic locking: ensure no concurrent modification
        exprValues[':expectedVersion'] = grade.version ?? 0;

        try {
          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            entityKey,
            updateExpr,
            exprValues,
            'version = :expectedVersion',
          );
          break; // Success — exit retry loop
        } catch (err: any) {
          if (err.name === 'ConditionalCheckFailedException' && attempt < MAX_RETRIES - 1) {
            this.logger.warn(
              `Optimistic lock conflict on grade ${entityKey}, retry ${attempt + 1}/${MAX_RETRIES}`,
            );
            // Re-read the grade and retry
            grade = await this.dynamoDBClient.getItem<Grade>(client, context.tenantId, entityKey);
            if (!grade) {
              throw new NotFoundException(`Grade document disappeared during retry`);
            }
            continue;
          }
          throw err; // Re-throw on final attempt or non-conflict errors
        }
      }

      // Re-fetch for return
      grade = await this.dynamoDBClient.getItem<Grade>(client, context.tenantId, entityKey);
    } else {
      // Create new grade document
      const gradeId = uuid();
      const calculated = this.calculateGrade([assignmentGrade], policy);

      grade = createGradeEntity(
        context.tenantId,
        gradeId,
        dto.studentId,
        dto.schoolId,
        dto.courseId,
        dto.termId,
        dto.academicYearId,
        {
          sectionId: dto.sectionId,
          teacherId: dto.teacherId,
          studentName: dto.studentName,
          courseName: dto.courseName,
          numericGrade: calculated.numericGrade,
          letterGrade: calculated.letterGrade,
          gpaPoints: calculated.gpaPoints,
          categoryGrades: calculated.categoryGrades,
          assignments: [assignmentGrade],
          isFinal: false,
          isPassing: calculated.isPassing,
          lastCalculatedAt: now,
          createdAt: now,
          createdBy: context.userId,
          updatedAt: now,
          updatedBy: context.userId,
          version: 1,
        },
      );

      await this.dynamoDBClient.putItem(client, grade);
    }

    this.logger.log(
      `Assignment grade recorded: ${dto.assignment.assignmentName} for student ${dto.studentId}`,
    );

    this.eventsService.publishEvent({
      eventType: 'GradeRecorded',
      timestamp: now,
      tenantId: context.tenantId,
      studentId: dto.studentId,
      courseId: dto.courseId,
      schoolId: dto.schoolId,
      termId: dto.termId,
      assignmentId,
    }).catch(err => this.logger.error('Failed to publish GradeRecorded event', err));

    return gradeEntityToDto(grade!);
  }

  /**
   * Record grades for multiple students on one assignment (bulk)
   */
  async recordBulkGrades(
    dto: BulkRecordGradeDto,
    context: RequestContext,
  ): Promise<{ recorded: number; errors: { studentId: string; error: string }[] }> {
    let recorded = 0;
    const errors: { studentId: string; error: string }[] = [];

    // Fetch grading policy once for all students (Ticket 2.7 optimization)
    const policy = await this.gradingPolicyService.getDefaultPolicyEntity(dto.schoolId, context);

    // Use a shared assignmentId so the same assignment column is created across all students
    const sharedAssignmentId = dto.assignment.assignmentId || uuid();

    for (const studentGrade of dto.grades) {
      try {
        await this.recordAssignmentGrade(
          {
            studentId: studentGrade.studentId,
            studentName: studentGrade.studentName,
            schoolId: dto.schoolId,
            courseId: dto.courseId,
            courseName: dto.courseName,
            sectionId: dto.sectionId,
            termId: dto.termId,
            academicYearId: dto.academicYearId,
            teacherId: dto.teacherId,
            assignment: {
              assignmentId: sharedAssignmentId,
              assignmentName: dto.assignment.assignmentName,
              assignmentType: dto.assignment.assignmentType,
              categoryId: dto.assignment.categoryId,
              assessmentCategory: dto.assignment.assessmentCategory,
              dueDate: dto.assignment.dueDate,
              possiblePoints: dto.assignment.possiblePoints,
              earnedPoints: studentGrade.earnedPoints,
              isExtraCredit: dto.assignment.isExtraCredit,
              isMissing: studentGrade.isMissing,
              isExcused: studentGrade.isExcused,
              comment: studentGrade.comment,
            },
          },
          context,
          policy,
        );
        recorded++;
      } catch (err: any) {
        errors.push({ studentId: studentGrade.studentId, error: err.message });
      }
    }

    this.logger.log(
      `Bulk grade recorded: ${recorded}/${dto.grades.length} for assignment ${dto.assignment.assignmentName}`,
    );

    this.eventsService.publishEvent({
      eventType: 'GradeBulkRecorded',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      schoolId: dto.schoolId,
      courseId: dto.courseId,
      sectionId: dto.sectionId,
      termId: dto.termId,
      totalRecords: recorded,
    }).catch(err => this.logger.error('Failed to publish GradeBulkRecorded event', err));

    return { recorded, errors };
  }

  /**
   * Get a grade document
   */
  async getGrade(
    studentId: string,
    courseId: string,
    termId: string,
    context: RequestContext,
  ): Promise<GradeResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const grade = await this.dynamoDBClient.getItem<Grade>(
      client,
      context.tenantId,
      EntityKeyBuilder.grade(studentId, courseId, termId),
    );

    if (!grade) {
      throw new NotFoundException(
        `Grade for student ${studentId}, course ${courseId}, term ${termId} not found`,
      );
    }

    return gradeEntityToDto(grade);
  }

  /**
   * Get all grades for a section, optionally filtered by term (teacher view)
   */
  async getSectionGrades(
    sectionId: string,
    schoolId: string,
    context: RequestContext,
    termId?: string,
  ): Promise<GradeResponseDto[]> {
    // Row-level security: verify section is in user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isSectionInScope(scope, sectionId)) {
      return []; // Teacher not assigned to this section — return empty
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query GSI1 for grades in this school, filtered by sectionId
    const result = await this.dynamoDBClient.queryGSI<Grade>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'GRADE#',
      'begins_with',
      'sectionId = :sectionId',
      { ':sectionId': sectionId },
      undefined,
      500,
    );

    // Filter by termId in memory if provided (GSI1SK contains courseId#termId)
    const filtered = termId
      ? result.items.filter(g => g.termId === termId)
      : result.items;

    const dtos = filtered.map(gradeEntityToDto);

    // Backfill null letterGrade/gpaPoints from numericGrade for stale data
    // (matches the same logic in getStudentGrades)
    if (dtos.some(d => d.numericGrade != null && d.letterGrade == null)) {
      const policy = await this.gradingPolicyService.getDefaultPolicyEntity(schoolId, context);
      if (policy?.gradingScale?.length) {
        for (const dto of dtos) {
          if (dto.numericGrade != null && dto.letterGrade == null) {
            dto.letterGrade = this.lookupLetterGrade(dto.numericGrade, policy.gradingScale);
            dto.gpaPoints = this.lookupGpaPoints(dto.numericGrade, policy.gradingScale);
          }
        }
      }
    }

    return dtos;
  }

  /**
   * Get all grades for a student in an academic year (report card / GPA)
   */
  async getStudentGrades(
    studentId: string,
    academicYearId: string,
    context: RequestContext,
    termId?: string,
  ): Promise<GradeResponseDto[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const skPrefix = termId
      ? `GRADE#${academicYearId}#${termId}#`
      : `GRADE#${academicYearId}#`;

    const result = await this.dynamoDBClient.queryGSI<Grade>(
      client,
      'GSI2',
      studentId,
      skPrefix,
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
    );

    const dtos = result.items.map(gradeEntityToDto);

    // Backfill null letterGrade/gpaPoints from numericGrade for stale data
    if (dtos.some(d => d.numericGrade != null && d.letterGrade == null)) {
      const schoolId = result.items[0]?.schoolId;
      if (schoolId) {
        const policy = await this.gradingPolicyService.getDefaultPolicyEntity(schoolId, context);
        if (policy?.gradingScale?.length) {
          for (const dto of dtos) {
            if (dto.numericGrade != null && dto.letterGrade == null) {
              dto.letterGrade = this.lookupLetterGrade(dto.numericGrade, policy.gradingScale);
              dto.gpaPoints = this.lookupGpaPoints(dto.numericGrade, policy.gradingScale);
            }
          }
        }
      }
    }

    return dtos;
  }

  /**
   * Finalize a grade (prevent further changes)
   */
  async finalizeGrade(
    studentId: string,
    courseId: string,
    termId: string,
    context: RequestContext,
  ): Promise<GradeResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.grade(studentId, courseId, termId);

    const grade = await this.dynamoDBClient.getItem<Grade>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!grade) {
      throw new NotFoundException(
        `Grade for student ${studentId}, course ${courseId}, term ${termId} not found`,
      );
    }

    if (grade.isFinal) {
      throw new ConflictException('Grade is already finalized');
    }

    const now = new Date().toISOString();

    const updated = await this.dynamoDBClient.updateItem<Grade>(
      client,
      context.tenantId,
      entityKey,
      'SET isFinal = :isFinal, publishedAt = :publishedAt, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
      {
        ':isFinal': true,
        ':publishedAt': now,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
    );

    this.logger.log(`Grade finalized: student ${studentId}, course ${courseId}, term ${termId}`);

    this.eventsService.publishEvent({
      eventType: 'GradeFinalized',
      timestamp: now,
      tenantId: context.tenantId,
      studentId,
      courseId,
      schoolId: grade.schoolId,
      termId,
      numericGrade: grade.numericGrade,
      letterGrade: grade.letterGrade,
    }).catch(err => this.logger.error('Failed to publish GradeFinalized event', err));

    return gradeEntityToDto(updated);
  }

  /**
   * Bulk-finalize all grades for a section in a term.
   * Returns counts for finalized, already-finalized, and errored records.
   */
  async bulkFinalizeGrades(
    sectionId: string,
    termId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{
    finalized: number;
    alreadyFinalized: number;
    errors: Array<{ studentId: string; courseId: string; error: string }>;
  }> {
    const grades = await this.getSectionGrades(sectionId, schoolId, context, termId);

    let finalized = 0;
    let alreadyFinalized = 0;
    const errors: Array<{ studentId: string; courseId: string; error: string }> = [];

    for (const grade of grades) {
      if (grade.isFinal) {
        alreadyFinalized++;
        continue;
      }

      try {
        await this.finalizeGrade(grade.studentId, grade.courseId, grade.termId, context);
        finalized++;
      } catch (err: any) {
        errors.push({
          studentId: grade.studentId,
          courseId: grade.courseId,
          error: err.message,
        });
      }
    }

    this.logger.log(
      `Bulk finalize: ${finalized} finalized, ${alreadyFinalized} already final, ${errors.length} errors for section ${sectionId}`,
    );

    this.eventsService.publishEvent({
      eventType: 'GradeBulkFinalized',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      sectionId,
      schoolId,
      termId,
      finalized,
      alreadyFinalized,
      errors: errors.length,
    }).catch(err => this.logger.error('Failed to publish GradeBulkFinalized event', err));

    return { finalized, alreadyFinalized, errors };
  }

  // ============================================
  // Grade Overview (School-wide Aggregation)
  // ============================================

  /**
   * Get aggregated grade overview for a school.
   * Replaces the N+1 client-side aggregation with a single backend query.
   */
  async getGradeOverview(
    schoolId: string,
    academicYearId: string,
    context: RequestContext,
  ): Promise<GradeOverviewResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all grades for this school via GSI1
    const result = await this.dynamoDBClient.queryGSI<Grade>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'GRADE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      2000,
    );

    // Query sections for this school to build courseId → courseName lookup
    const sectionResult = await this.dynamoDBClient.queryGSI<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'SECTION#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      500,
    );
    const courseNameLookup = new Map<string, string>();
    for (const section of sectionResult.items) {
      if (section.courseName && !courseNameLookup.has(section.courseId)) {
        courseNameLookup.set(section.courseId, section.courseName);
      }
    }

    // Row-level security: filter by user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const scopedGrades = this.dataScopeService.filterByStudentScope(scope, result.items);

    // Filter by academicYearId in memory
    const allGrades = scopedGrades.filter(g => g.academicYearId === academicYearId);

    if (allGrades.length === 0) {
      return {
        totalStudentsGraded: 0,
        averageGpa: 0,
        averageGrade: 0,
        passRate: 0,
        atRiskCount: 0,
        gradeDistribution: [
          { range: 'A (90-100)', count: 0 },
          { range: 'B (80-89)', count: 0 },
          { range: 'C (70-79)', count: 0 },
          { range: 'D (60-69)', count: 0 },
          { range: 'F (0-59)', count: 0 },
        ],
        coursePerformance: [],
        atRiskStudents: [],
        totalSections: 0,
        sectionsWithGrades: 0,
        assessmentBreakdown: {
          formative: { count: 0, avgScore: 0 },
          summative: { count: 0, avgScore: 0 },
          unclassified: { count: 0, avgScore: 0 },
        },
        gradingProgress: {
          totalAssignmentEntries: 0,
          gradedEntries: 0,
          ungradedStubs: 0,
          completionRate: 0,
        },
        categoryPerformance: [],
      };
    }

    // Aggregate
    const distribution = [
      { range: 'A (90-100)', count: 0 },
      { range: 'B (80-89)', count: 0 },
      { range: 'C (70-79)', count: 0 },
      { range: 'D (60-69)', count: 0 },
      { range: 'F (0-59)', count: 0 },
    ];
    let totalGrade = 0;
    let totalGpa = 0;
    let gpaCount = 0;
    let passCount = 0;
    const atRiskStudents: GradeOverviewResponse['atRiskStudents'] = [];
    const courseMap = new Map<string, {
      courseId: string;
      courseName: string;
      sectionIds: Set<string>;
      grades: number[];
      gpas: number[];
      passCount: number;
    }>();
    const sectionIds = new Set<string>();

    for (const grade of allGrades) {
      const pct = grade.numericGrade ?? 0;
      totalGrade += pct;
      if (grade.gpaPoints != null) {
        totalGpa += grade.gpaPoints;
        gpaCount++;
      }
      if (pct >= 60) passCount++;
      if (grade.sectionId) sectionIds.add(grade.sectionId);

      // Distribution
      if (pct >= 90) distribution[0].count++;
      else if (pct >= 80) distribution[1].count++;
      else if (pct >= 70) distribution[2].count++;
      else if (pct >= 60) distribution[3].count++;
      else distribution[4].count++;

      // At-risk (below 60%)
      if (pct < 60) {
        atRiskStudents.push({
          studentId: grade.studentId,
          studentName: grade.studentName || grade.studentId.slice(0, 8),
          courseId: grade.courseId,
          courseName: grade.courseName || courseNameLookup.get(grade.courseId) || grade.courseId,
          numericGrade: pct,
          letterGrade: grade.letterGrade ?? null,
        });
      }

      // Course aggregation
      const gpa = grade.gpaPoints ?? 0;
      const existing = courseMap.get(grade.courseId);
      if (existing) {
        existing.grades.push(pct);
        existing.gpas.push(gpa);
        if (pct >= 60) existing.passCount++;
        if (grade.sectionId) existing.sectionIds.add(grade.sectionId);
      } else {
        courseMap.set(grade.courseId, {
          courseId: grade.courseId,
          courseName: grade.courseName || courseNameLookup.get(grade.courseId) || grade.courseId,
          sectionIds: new Set(grade.sectionId ? [grade.sectionId] : []),
          grades: [pct],
          gpas: [gpa],
          passCount: pct >= 60 ? 1 : 0,
        });
      }
    }

    const coursePerformance = Array.from(courseMap.values())
      .map(c => ({
        courseId: c.courseId,
        courseName: c.courseName,
        sectionCount: c.sectionIds.size,
        studentCount: c.grades.length,
        avgGrade: c.grades.reduce((a, b) => a + b, 0) / c.grades.length,
        avgGpa: c.gpas.reduce((a, b) => a + b, 0) / c.gpas.length,
        passRate: (c.passCount / c.grades.length) * 100,
      }))
      .sort((a, b) => b.avgGrade - a.avgGrade);

    // Assessment type breakdown (formative/summative/unclassified)
    const assessmentAccum = {
      formative: { count: 0, totalScore: 0 },
      summative: { count: 0, totalScore: 0 },
      unclassified: { count: 0, totalScore: 0 },
    };
    for (const grade of allGrades) {
      for (const a of grade.assignments || []) {
        if (a.earnedPoints === undefined || a.isExcused) continue;
        const pct = a.possiblePoints > 0 ? (a.earnedPoints / a.possiblePoints) * 100 : 0;
        const bucket = a.assessmentCategory || 'unclassified';
        assessmentAccum[bucket].count++;
        assessmentAccum[bucket].totalScore += pct;
      }
    }
    const assessmentBreakdown = {
      formative: {
        count: assessmentAccum.formative.count,
        avgScore: assessmentAccum.formative.count > 0
          ? Math.round((assessmentAccum.formative.totalScore / assessmentAccum.formative.count) * 100) / 100
          : 0,
      },
      summative: {
        count: assessmentAccum.summative.count,
        avgScore: assessmentAccum.summative.count > 0
          ? Math.round((assessmentAccum.summative.totalScore / assessmentAccum.summative.count) * 100) / 100
          : 0,
      },
      unclassified: {
        count: assessmentAccum.unclassified.count,
        avgScore: assessmentAccum.unclassified.count > 0
          ? Math.round((assessmentAccum.unclassified.totalScore / assessmentAccum.unclassified.count) * 100) / 100
          : 0,
      },
    };

    // Grading progress — count scored vs stub assignment entries
    let totalAssignmentEntries = 0;
    let gradedEntries = 0;
    let ungradedStubs = 0;
    const categoryAccum = new Map<string, { categoryId: string; categoryName: string; count: number; totalPct: number }>();

    for (const grade of allGrades) {
      for (const a of grade.assignments || []) {
        if (a.isExcused) continue;
        totalAssignmentEntries++;
        if (a.earnedPoints !== undefined) {
          gradedEntries++;
          // Category performance accumulation
          const catId = a.categoryId || 'uncategorized';
          const catName = a.assignmentType || catId;
          const pct = a.possiblePoints > 0 ? (a.earnedPoints / a.possiblePoints) * 100 : 0;
          const existing = categoryAccum.get(catId);
          if (existing) {
            existing.count++;
            existing.totalPct += pct;
          } else {
            categoryAccum.set(catId, { categoryId: catId, categoryName: catName, count: 1, totalPct: pct });
          }
        } else {
          ungradedStubs++;
        }
      }
    }

    const gradingProgress = {
      totalAssignmentEntries,
      gradedEntries,
      ungradedStubs,
      completionRate: totalAssignmentEntries > 0
        ? Math.round((gradedEntries / totalAssignmentEntries) * 10000) / 100
        : 0,
    };

    const categoryPerformance = Array.from(categoryAccum.values())
      .map(c => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        assignmentCount: c.count,
        avgScore: Math.round((c.totalPct / c.count) * 100) / 100,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    return {
      totalStudentsGraded: allGrades.length,
      averageGpa: gpaCount > 0 ? totalGpa / gpaCount : 0,
      averageGrade: totalGrade / allGrades.length,
      passRate: (passCount / allGrades.length) * 100,
      atRiskCount: atRiskStudents.length,
      gradeDistribution: distribution,
      coursePerformance,
      atRiskStudents: atRiskStudents.sort((a, b) => a.numericGrade - b.numericGrade),
      totalSections: sectionResult.items.filter(s => s.academicYearId === academicYearId).length,
      sectionsWithGrades: sectionIds.size,
      assessmentBreakdown,
      gradingProgress,
      categoryPerformance,
    };
  }

  // ============================================
  // Grade Calculation Engine
  // ============================================

  /**
   * Calculate overall grade from assignments using grading policy.
   *
   * Steps:
   * 1. Group assignments by categoryId
   * 2. Calculate category averages (handle drops, extra credit, excused)
   * 3. Apply category weights → overall numericGrade
   * 4. Map numeric → letterGrade + gpaPoints via grading scale
   */
  calculateGrade(
    assignments: AssignmentGrade[],
    policy: GradingPolicyEntity | null,
  ): {
    numericGrade: number;
    letterGrade: GradeLetter | undefined;
    gpaPoints: number | undefined;
    isPassing: boolean;
    categoryGrades: CategoryGrade[];
  } {
    // Filter to gradable assignments (not excused)
    const gradable = assignments.filter(a => !a.isExcused);

    if (gradable.length === 0) {
      return {
        numericGrade: 0,
        letterGrade: undefined,
        gpaPoints: undefined,
        isPassing: false,
        categoryGrades: [],
      };
    }

    // If no assignments have actual scores (all stubs), return without calculating
    const hasScored = gradable.some(a => a.earnedPoints !== undefined || a.isMissing);
    if (!hasScored) {
      return {
        numericGrade: 0,
        letterGrade: undefined,
        gpaPoints: undefined,
        isPassing: false,
        categoryGrades: [],
      };
    }

    // If no policy, use simple average
    if (!policy || !policy.categoryWeights?.length) {
      return this.calculateSimpleAverage(gradable, policy);
    }

    return this.calculateWeightedGrade(gradable, policy);
  }

  private calculateSimpleAverage(
    assignments: AssignmentGrade[],
    policy: GradingPolicyEntity | null,
  ): {
    numericGrade: number;
    letterGrade: GradeLetter | undefined;
    gpaPoints: number | undefined;
    isPassing: boolean;
    categoryGrades: CategoryGrade[];
  } {
    let totalEarned = 0;
    let totalPossible = 0;

    for (const a of assignments) {
      if (a.isMissing) {
        totalPossible += a.possiblePoints;
        continue;
      }
      if (a.earnedPoints !== undefined) {
        if (a.isExtraCredit) {
          totalEarned += a.earnedPoints;
        } else {
          totalEarned += a.earnedPoints;
          totalPossible += a.possiblePoints;
        }
      }
    }

    const numericGrade = totalPossible > 0
      ? this.applyRounding((totalEarned / totalPossible) * 100, policy?.roundingRule)
      : 0;

    const letterGrade = policy ? this.lookupLetterGrade(numericGrade, policy.gradingScale) : undefined;
    const gpaPoints = policy ? this.lookupGpaPoints(numericGrade, policy.gradingScale) : undefined;
    const minimumPassing = policy?.minimumPassingGrade ?? 60;

    return {
      numericGrade,
      letterGrade,
      gpaPoints,
      isPassing: numericGrade >= minimumPassing,
      categoryGrades: [],
    };
  }

  private calculateWeightedGrade(
    assignments: AssignmentGrade[],
    policy: GradingPolicyEntity,
  ): {
    numericGrade: number;
    letterGrade: GradeLetter | undefined;
    gpaPoints: number | undefined;
    isPassing: boolean;
    categoryGrades: CategoryGrade[];
  } {
    // Group by category
    const byCategory = new Map<string, AssignmentGrade[]>();
    for (const a of assignments) {
      const catId = a.categoryId || 'uncategorized';
      if (!byCategory.has(catId)) {
        byCategory.set(catId, []);
      }
      byCategory.get(catId)!.push(a);
    }

    const categoryGrades: CategoryGrade[] = [];
    let weightedSum = 0;
    let totalWeight = 0;

    for (const cw of policy.categoryWeights) {
      const categoryAssignments = byCategory.get(cw.categoryId) || [];
      if (categoryAssignments.length === 0) continue;

      // Apply drop lowest
      let effectiveAssignments = [...categoryAssignments];
      const dropRule = policy.dropLowestScores?.find(d => d.categoryId === cw.categoryId);
      if (dropRule && dropRule.count > 0) {
        effectiveAssignments = this.dropLowest(effectiveAssignments, dropRule.count);
      }

      // Check if this category has any scored or missing assignments
      // (stubs with earnedPoints === undefined are ungraded placeholders)
      const hasScoredAssignments = effectiveAssignments.some(
        a => a.earnedPoints !== undefined || a.isMissing,
      );

      if (!hasScoredAssignments) {
        // All assignments are ungraded stubs — include in categoryGrades for
        // display but do NOT add to weightedSum/totalWeight so the normalization
        // at the end correctly handles partial weights.
        categoryGrades.push({
          categoryId: cw.categoryId,
          categoryName: cw.categoryName,
          weight: cw.weight,
          earnedPoints: 0,
          possiblePoints: 0,
          percentage: 0,
          letterGrade: undefined,
        });
        continue;
      }

      let earned = 0;
      let possible = 0;

      for (const a of effectiveAssignments) {
        if (a.isMissing) {
          // Missing work: penalizes the student (adds to denominator)
          possible += a.possiblePoints;
          continue;
        }
        if (a.earnedPoints === undefined) {
          // Ungraded stub: skip entirely — don't inflate the denominator
          continue;
        }
        // Scored assignment
        if (a.isExtraCredit) {
          earned += a.earnedPoints;
        } else {
          earned += a.earnedPoints;
          possible += a.possiblePoints;
        }
      }

      const percentage = possible > 0
        ? this.applyRounding((earned / possible) * 100, policy.roundingRule)
        : 0;

      categoryGrades.push({
        categoryId: cw.categoryId,
        categoryName: cw.categoryName,
        weight: cw.weight,
        earnedPoints: earned,
        possiblePoints: possible,
        percentage,
        letterGrade: this.lookupLetterGrade(percentage, policy.gradingScale),
      });

      weightedSum += percentage * (cw.weight / 100);
      totalWeight += cw.weight;
    }

    // Handle uncategorized assignments — include as proportional extra category
    const uncategorized = byCategory.get('uncategorized');
    if (uncategorized && uncategorized.length > 0) {
      let ucEarned = 0;
      let ucPossible = 0;
      for (const a of uncategorized) {
        if (a.isMissing) {
          ucPossible += a.possiblePoints;
          continue;
        }
        if (a.earnedPoints !== undefined) {
          if (a.isExtraCredit) {
            ucEarned += a.earnedPoints;
          } else {
            ucEarned += a.earnedPoints;
            ucPossible += a.possiblePoints;
          }
        }
      }
      if (ucPossible > 0) {
        const ucPct = this.applyRounding((ucEarned / ucPossible) * 100, policy.roundingRule);
        const remainingWeight = 100 - totalWeight;
        if (remainingWeight > 0) {
          weightedSum += ucPct * (remainingWeight / 100);
          totalWeight += remainingWeight;
        }
      }
    }

    // Normalize if not all categories have assignments
    const numericGrade = totalWeight > 0
      ? this.applyRounding((weightedSum / (totalWeight / 100)), policy.roundingRule)
      : 0;

    const letterGrade = this.lookupLetterGrade(numericGrade, policy.gradingScale);
    const gpaPoints = this.lookupGpaPoints(numericGrade, policy.gradingScale);

    return {
      numericGrade,
      letterGrade,
      gpaPoints,
      isPassing: numericGrade >= policy.minimumPassingGrade,
      categoryGrades,
    };
  }

  private dropLowest(assignments: AssignmentGrade[], count: number): AssignmentGrade[] {
    if (assignments.length <= count) return assignments;

    // Sort by percentage (lowest first), mark lowest as dropped
    const withPercentage = assignments
      .filter(a => a.earnedPoints !== undefined && !a.isMissing && !a.isExtraCredit)
      .map(a => ({
        assignment: a,
        pct: (a.earnedPoints! / a.possiblePoints) * 100,
      }))
      .sort((a, b) => a.pct - b.pct);

    const droppedIds = new Set(
      withPercentage.slice(0, count).map(w => w.assignment.assignmentId),
    );

    return assignments.map(a => ({
      ...a,
      isDropped: droppedIds.has(a.assignmentId),
    })).filter(a => !a.isDropped);
  }

  private lookupLetterGrade(numericGrade: number, scale: GradingScaleEntry[]): GradeLetter | undefined {
    if (!scale?.length) return undefined;
    // Sort descending by minPercentage so we match highest bracket first
    const sorted = [...scale].sort((a, b) => b.minPercentage - a.minPercentage);

    // Handle grades above the highest scale entry (extra credit > 100%)
    if (numericGrade > sorted[0].maxPercentage) {
      return sorted[0].letter;
    }

    // Use >= minPercentage only (descending order guarantees first match is correct).
    // This avoids gaps when scale uses integer boundaries (e.g., B: 80-89, A: 90-100
    // would miss 89.5 with the old >= min && <= max check).
    for (const entry of sorted) {
      if (numericGrade >= entry.minPercentage) {
        return entry.letter;
      }
    }
    // If below all ranges, return lowest grade
    return sorted[sorted.length - 1]?.letter;
  }

  private lookupGpaPoints(numericGrade: number, scale: GradingScaleEntry[]): number | undefined {
    if (!scale?.length) return undefined;
    const sorted = [...scale].sort((a, b) => b.minPercentage - a.minPercentage);

    // Handle grades above the highest scale entry (extra credit > 100%)
    if (numericGrade > sorted[0].maxPercentage) {
      return sorted[0].gpaPoints;
    }

    // Use >= minPercentage only (matches lookupLetterGrade logic)
    for (const entry of sorted) {
      if (numericGrade >= entry.minPercentage) {
        return entry.gpaPoints;
      }
    }
    return sorted[sorted.length - 1]?.gpaPoints;
  }

  /**
   * Resolve the assessment category (formative/summative) for an assignment.
   *
   * Priority: explicit value > policy category default > heuristic from type name.
   */
  private resolveAssessmentCategory(
    explicit: AssessmentCategory | undefined,
    categoryId: string | undefined,
    assignmentType: string,
    policy: GradingPolicyEntity | null,
  ): AssessmentCategory | undefined {
    // 1. Explicit value always wins
    if (explicit) return explicit;

    // 2. Policy category default
    if (categoryId && policy?.categoryWeights) {
      const cat = policy.categoryWeights.find(c => c.categoryId === categoryId);
      if (cat?.defaultAssessmentCategory) return cat.defaultAssessmentCategory;
    }

    // 3. Heuristic from assignment type / category name
    const typeLower = (assignmentType || '').toLowerCase();
    const FORMATIVE_TYPES = ['quiz', 'quizzes', 'homework', 'participation', 'classwork', 'warmup', 'bellringer', 'practice'];
    const SUMMATIVE_TYPES = ['test', 'tests', 'exam', 'exams', 'final', 'midterm', 'project', 'projects', 'presentation', 'presentations', 'benchmark'];

    if (FORMATIVE_TYPES.some(t => typeLower.includes(t))) return 'formative';
    if (SUMMATIVE_TYPES.some(t => typeLower.includes(t))) return 'summative';

    return undefined;
  }

  private applyRounding(value: number, rule?: 'up' | 'down' | 'nearest'): number {
    const factor = 100; // Round to 2 decimal places
    switch (rule) {
      case 'up':
        return Math.ceil(value * factor) / factor;
      case 'down':
        return Math.floor(value * factor) / factor;
      case 'nearest':
      default:
        return Math.round(value * factor) / factor;
    }
  }
}

import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import type { Grade, RequestContext } from '@edforge/shared-types';
import { EntityKeyBuilder } from './entities/grading.entity';
import { CreateGradeDto, UpdateGradeDto, BulkGradeDto } from './dto/grading.dto';
import { ValidationService } from './services/validation.service';
import { CalculationService } from './services/calculation.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { AssessmentEventsService } from '../common/services/assessment-events.service';
import { retryWithBackoff } from '@app/common-utils';
// @ts-ignore - csv-parse doesn't have complete TypeScript definitions
import { parse } from 'csv-parse/sync';

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly validationService: ValidationService,
    private readonly calculationService: CalculationService,
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AssessmentEventsService
  ) {}

  private tableName: string = process.env.TABLE_NAME || 'ACADEMIC_TABLE';

  /**
   * Create a new grade
   */
  async createGrade(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    createDto: CreateGradeDto,
    context: RequestContext
  ): Promise<Grade> {
    try {
      // 1. Validate
      await this.validationService.validateGradeCreation(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        createDto
      );

      // 2. Calculate percentage and letter grade
      const percentage = this.calculationService.calculatePercentage(createDto.score, createDto.maxPoints);
      const gradingScale = this.calculationService.getDefaultGradingScale();
      const letterGrade = this.calculationService.calculateLetterGrade(percentage, gradingScale);

      // 3. Build entity
      const gradeId = uuid();
      const timestamp = new Date().toISOString();
      
      const grade: Grade = {
        tenantId,
        entityKey: EntityKeyBuilder.grade(schoolId, academicYearId, createDto.studentId, createDto.assignmentId),
        entityType: 'GRADE',
        gradeId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId: createDto.assignmentId,
        studentId: createDto.studentId,
        termId: createDto.termId,
        score: createDto.score,
        maxPoints: createDto.maxPoints,
        percentage,
        letterGrade,
        gradePoints: undefined, // TODO: Calculate GPA points
        categoryId: createDto.categoryId,
        categoryName: '', // TODO: Fetch from category
        categoryWeight: 0, // TODO: Fetch from category
        submittedAt: undefined,
        gradedAt: timestamp,
        gradedByTeacherId: context.userId,
        isLate: createDto.isLate || false,
        daysLate: undefined,
        penaltyApplied: createDto.penaltyApplied,
        feedback: createDto.feedback,
        rubricScores: createDto.rubricScores,
        status: createDto.status || 'draft',
        publishedAt: createDto.status === 'published' ? timestamp : undefined,
        gradeTrend: 'stable', // TODO: Calculate based on history
        percentile: 0, // TODO: Calculate based on class distribution
        classAverage: 0, // TODO: Calculate from class grades
        standardDeviation: 0, // TODO: Calculate from class grades
        lastModifiedBy: context.userId,
        lastModifiedAt: timestamp,
        isExcused: createDto.isExcused || false,
        isFinal: createDto.isFinal || false,
        canRetake: createDto.canRetake || false,
        retakeCount: 0,
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        gsi1pk: `${classroomId}#${academicYearId}`,
        gsi1sk: `GRADE#${timestamp}#${gradeId}`,
        gsi2pk: `${createDto.studentId}#${academicYearId}`,
        gsi2sk: `GRADE#${timestamp}#${gradeId}`,
        gsi3pk: createDto.assignmentId ? `${createDto.assignmentId}#${academicYearId}` : '',
        gsi3sk: createDto.assignmentId ? `GRADE#${timestamp}#${gradeId}` : '',
        gsi4pk: `${createDto.categoryId}#${academicYearId}`,
        gsi4sk: `GRADE#${timestamp}#${gradeId}`,
        gsi5pk: createDto.termId ? `${createDto.termId}#${academicYearId}` : '',
        gsi5sk: createDto.termId ? `GRADE#${timestamp}#${gradeId}` : '',
        gsi6pk: `${schoolId}#${academicYearId}`,
        gsi6sk: `GRADE#${timestamp}#${gradeId}`,
      };

      // 4. Save to DynamoDB
      try {
        await this.dynamoDBClient.putItem(grade);
        this.logger.log(`Grade created for student ${createDto.studentId} on assignment ${createDto.assignmentId}: ${percentage}% (${letterGrade})`);
      } catch (error: any) {
        this.logger.error(`Failed to save grade to DynamoDB: ${error.message}`);
        throw new InternalServerErrorException('Failed to create grade record');
      }

      // 5. Publish GradeCreated event
      try {
        await this.eventsService.publishGradeCreated(grade);
      } catch (error: any) {
        this.logger.warn(`Failed to publish GradeCreated event: ${error.message}`);
        // Don't fail the operation if event publishing fails
      }

      return grade;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      console.error('❌ Grade creation failed:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        error: error.message,
        stack: error.stack
      });
      
      throw new InternalServerErrorException({
        message: 'Failed to create grade',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get grade by student and assignment
   */
  async getGrade(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    studentId: string,
    assignmentId: string,
    jwtToken: string
  ): Promise<Grade> {
    // TODO: Implement DynamoDB query
    throw new NotFoundException(`Grade not found for student ${studentId} on assignment ${assignmentId}`);
  }

  /**
   * Get all grades for a classroom
   */
  async getGradesByClassroom(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    filters: any,
    jwtToken: string
  ): Promise<Grade[]> {
    // TODO: Implement DynamoDB query using GSI1
    return [];
  }

  /**
   * Get all grades for a student
   */
  async getGradesByStudent(
    tenantId: string,
    studentId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<Grade[]> {
    // TODO: Implement DynamoDB query using GSI3
    return [];
  }

  /**
   * Get all grades submitted by a teacher
   */
  async getGradesByTeacher(
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<Grade[]> {
    // TODO: Implement DynamoDB query using GSI2
    return [];
  }

  /**
   * Update grade
   */
  async updateGrade(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string,
    assignmentId: string,
    updateDto: UpdateGradeDto,
    context: RequestContext
  ): Promise<Grade> {
    try {
      // 1. Validate
      await this.validationService.validateGradeUpdate(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        `${studentId}#${assignmentId}`,
        updateDto
      );

      // 2. Use retry mechanism with fresh data fetch on conflict
      const updatedGrade = await retryWithBackoff(
        async () => {
          // Fetch fresh grade data on each retry attempt to get latest version
          const existing = await this.getGrade(tenantId, schoolId, academicYearId, studentId, assignmentId, context.jwtToken);

          // Use the fresh version from database
          const currentVersion = existing.version;

          // 3. Recalculate if score or maxPoints changed
          let percentage = existing.percentage;
          let letterGrade = existing.letterGrade;
          
          if (updateDto.score !== undefined || updateDto.maxPoints !== undefined) {
            const newScore = updateDto.score ?? existing.score;
            const newMaxPoints = updateDto.maxPoints ?? existing.maxPoints;
            percentage = this.calculationService.calculatePercentage(newScore, newMaxPoints);
            const gradingScale = this.calculationService.getDefaultGradingScale();
            letterGrade = this.calculationService.calculateLetterGrade(percentage, gradingScale);
          }

          // 4. Update DynamoDB (TODO: Implement full DynamoDB update)
          // For now, return updated grade with new values
          const updated: Grade = {
            ...existing,
            ...updateDto,
            percentage,
            letterGrade,
            updatedAt: new Date().toISOString(),
            updatedBy: context.userId,
            lastModifiedBy: context.userId,
            lastModifiedAt: new Date().toISOString(),
            version: currentVersion + 1
          };

          // TODO: Replace with actual DynamoDB updateItem call
          // await this.dynamoDBClient.updateItem(...)
          
          return updated;
        },
        {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 2000
        },
        console // Use console as logger
      ).catch((error) => {
        // Transform error to user-friendly message
        if (error.name === 'ConditionalCheckFailedException' || error.message?.includes('Update condition not met')) {
          throw new BadRequestException('Grade has been modified by another user. Please refresh and try again.');
        }
        throw error;
      });

      console.log(`✅ Grade updated: ${updatedGrade.gradeId} (v${updatedGrade.version})`);
      return updatedGrade;

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      console.error('❌ Grade update failed:', error);
      throw new InternalServerErrorException('Failed to update grade');
    }
  }

  /**
   * Publish grade (release to student)
   */
  async publishGrade(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string,
    assignmentId: string,
    context: RequestContext
  ): Promise<Grade> {
    const existing = await this.getGrade(tenantId, schoolId, academicYearId, studentId, assignmentId, context.jwtToken);
    
    if (existing.status !== 'draft') {
      throw new BadRequestException('Only draft grades can be published');
    }

    return this.updateGrade(
      tenantId,
      schoolId,
      academicYearId,
      classroomId,
      studentId,
      assignmentId,
      { status: 'published', version: existing.version },
      context
    );
  }

  /**
   * Calculate course grade for a student
   */
  async calculateCourseGrade(
    tenantId: string,
    studentId: string,
    classroomId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<{
    overallPercentage: number;
    overallLetterGrade: string;
    totalAssignments: number;
    completedAssignments: number;
  }> {
    // TODO: Implement
    // 1. Get all published grades for student in classroom
    // 2. Get assignment weights
    // 3. Calculate weighted average
    // 4. Return overall grade
    
    return {
      overallPercentage: 0,
      overallLetterGrade: 'N/A',
      totalAssignments: 0,
      completedAssignments: 0
    };
  }

  /**
   * Bulk Grade Entry
   * Phase 5: Advanced Features - Bulk Operations
   * 
   * Processes multiple grades in parallel with pre-validation.
   * Uses BatchWriteItem for performance (25 items per batch).
   * 
   * DESIGN RATIONALE:
   * - Pre-validation ensures data quality before processing
   * - BatchWriteItem provides 25x performance improvement
   * - Each grade publishes GradeCreated event
   * - Handles partial failures gracefully
   */
  async bulkCreateGrades(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    bulkDto: BulkGradeDto,
    context: RequestContext
  ): Promise<{
    success: Array<{ studentId: string; assignmentId: string; gradeId: string }>;
    failed: Array<{ studentId: string; assignmentId: string; error: string }>;
    summary: { total: number; succeeded: number; failed: number };
  }> {
    const startTime = Date.now();
    this.logger.log(`Starting bulk grade entry: ${bulkDto.grades.length} grades`);

    const success: Array<{ studentId: string; assignmentId: string; gradeId: string }> = [];
    const failures: Array<{ studentId: string; assignmentId: string; error: string }> = [];

    // Step 1: Pre-validate all grades
    this.logger.log('Pre-validating all grades...');
    const validationErrors = await this.preValidateBulkGrades(tenantId, schoolId, academicYearId, classroomId, bulkDto.grades);
    
    if (validationErrors.length > 0) {
      this.logger.warn(`Pre-validation failed for ${validationErrors.length} grades`);
      return {
        success: [],
        failed: validationErrors,
        summary: {
          total: bulkDto.grades.length,
          succeeded: 0,
          failed: validationErrors.length
        }
      };
    }

    // Step 2: Build grade entities
    const timestamp = new Date().toISOString();
    const grades: Grade[] = [];
    const gradingScale = this.calculationService.getDefaultGradingScale();

    for (const createDto of bulkDto.grades) {
      try {
        const percentage = this.calculationService.calculatePercentage(createDto.score, createDto.maxPoints);
        const letterGrade = this.calculationService.calculateLetterGrade(percentage, gradingScale);
        const gradeId = uuid();

        const grade: Grade = {
          tenantId,
          entityKey: EntityKeyBuilder.grade(schoolId, academicYearId, createDto.studentId, createDto.assignmentId),
          entityType: 'GRADE',
          gradeId,
          schoolId,
          academicYearId,
          classroomId,
          assignmentId: createDto.assignmentId,
          studentId: createDto.studentId,
          termId: createDto.termId,
          score: createDto.score,
          maxPoints: createDto.maxPoints,
          percentage,
          letterGrade,
          gradePoints: undefined,
          categoryId: createDto.categoryId,
          categoryName: '',
          categoryWeight: 0,
          submittedAt: undefined,
          gradedAt: timestamp,
          gradedByTeacherId: context.userId,
          isLate: createDto.isLate || false,
          daysLate: undefined,
          penaltyApplied: createDto.penaltyApplied,
          feedback: createDto.feedback,
          rubricScores: createDto.rubricScores,
          status: createDto.status || 'draft',
          publishedAt: createDto.status === 'published' ? timestamp : undefined,
          gradeTrend: 'stable',
          percentile: 0,
          classAverage: 0,
          standardDeviation: 0,
          lastModifiedBy: context.userId,
          lastModifiedAt: timestamp,
          isExcused: createDto.isExcused || false,
          isFinal: createDto.isFinal || false,
          canRetake: createDto.canRetake || false,
          retakeCount: 0,
          createdAt: timestamp,
          createdBy: context.userId,
          updatedAt: timestamp,
          updatedBy: context.userId,
          version: 1,
          gsi1pk: `${classroomId}#${academicYearId}`,
          gsi1sk: `GRADE#${timestamp}#${gradeId}`,
          gsi2pk: `${createDto.studentId}#${academicYearId}`,
          gsi2sk: `GRADE#${timestamp}#${gradeId}`,
          gsi3pk: `${createDto.assignmentId}#${academicYearId}`,
          gsi3sk: `GRADE#${timestamp}#${gradeId}`,
          gsi4pk: `${createDto.categoryId}#${academicYearId}`,
          gsi4sk: `GRADE#${timestamp}#${gradeId}`,
          gsi5pk: createDto.termId ? `${createDto.termId}#${academicYearId}` : '',
          gsi5sk: createDto.termId ? `GRADE#${timestamp}#${gradeId}` : '',
          gsi6pk: `${schoolId}#${academicYearId}`,
          gsi6sk: `GRADE#${timestamp}#${gradeId}`,
        };

        grades.push(grade);
      } catch (error: any) {
        failures.push({
          studentId: createDto.studentId,
          assignmentId: createDto.assignmentId,
          error: error.message || 'Unknown error'
        });
      }
    }

    // Step 3: Write in batches using BatchWriteItem
    const batchSize = 25;
    const batches: Grade[][] = [];
    
    for (let i = 0; i < grades.length; i += batchSize) {
      batches.push(grades.slice(i, i + batchSize));
    }

    this.logger.log(`Writing ${grades.length} grades in ${batches.length} batches`);

    // Step 4: Process each batch
    for (const batch of batches) {
      try {
        await this.dynamoDBClient.batchWriteItems(batch);
        
        // Publish events for successful grades (async, non-blocking)
        batch.forEach(grade => {
          this.eventsService.publishGradeCreated(grade).catch(error => {
            this.logger.warn(`Failed to publish GradeCreated event for grade ${grade.gradeId}: ${error.message}`);
          });
        });

        // Add to success list
        batch.forEach(grade => {
          success.push({
            studentId: grade.studentId,
            assignmentId: grade.assignmentId,
            gradeId: grade.gradeId
          });
        });

        this.logger.debug(`Batch write completed: ${batch.length} grades`);
      } catch (error: any) {
        this.logger.error(`Batch write failed: ${error.message}`, error.stack);
        // Mark all grades in failed batch as failed
        batch.forEach(grade => {
          failures.push({
            studentId: grade.studentId,
            assignmentId: grade.assignmentId,
            error: `Batch write failed: ${error.message}`
          });
        });
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Bulk grade entry completed in ${duration}ms: ${success.length} succeeded, ${failures.length} failed`
    );

    return {
      success,
      failed: failures,
      summary: {
        total: bulkDto.grades.length,
        succeeded: success.length,
        failed: failures.length
      }
    };
  }

  /**
   * Pre-validate all bulk grades before processing
   */
  private async preValidateBulkGrades(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    grades: CreateGradeDto[]
  ): Promise<Array<{ studentId: string; assignmentId: string; error: string }>> {
    const errors: Array<{ studentId: string; assignmentId: string; error: string }> = [];

    // Batch check assignments exist (using BatchGetItem)
    const assignmentKeys = grades.map(g => ({
      tenantId,
      entityKey: `ASSIGNMENT#${g.assignmentId}`
    }));

    const batchSize = 100;
    const assignmentChunks: typeof assignmentKeys[] = [];
    for (let i = 0; i < assignmentKeys.length; i += batchSize) {
      assignmentChunks.push(assignmentKeys.slice(i, i + batchSize));
    }

    const existingAssignments = new Set<string>();
    for (const chunk of assignmentChunks) {
      try {
        const assignments = await this.dynamoDBClient.batchGetItems(chunk);
        assignments.forEach((assignment: any) => {
          if (assignment?.entityType === 'ASSIGNMENT') {
            existingAssignments.add(assignment.assignmentId || assignment.entityKey.split('#')[1]);
          }
        });
      } catch (error: any) {
        this.logger.error(`BatchGetItem failed during pre-validation: ${error.message}`);
      }
    }

    // Validate each grade
    for (const grade of grades) {
      // Check assignment exists
      if (!existingAssignments.has(grade.assignmentId)) {
        errors.push({
          studentId: grade.studentId,
          assignmentId: grade.assignmentId,
          error: `Assignment ${grade.assignmentId} does not exist`
        });
        continue;
      }

      // Validate score range
      if (grade.score < 0 || grade.score > grade.maxPoints) {
        errors.push({
          studentId: grade.studentId,
          assignmentId: grade.assignmentId,
          error: `Score ${grade.score} is out of range (0-${grade.maxPoints})`
        });
      }

      // Check for duplicate grades (query existing grade)
      try {
        const entityKey = EntityKeyBuilder.grade(schoolId, academicYearId, grade.studentId, grade.assignmentId);
        const existingGrade = await this.dynamoDBClient.getItem(tenantId, entityKey);
        if (existingGrade && existingGrade.entityType === 'GRADE') {
          errors.push({
            studentId: grade.studentId,
            assignmentId: grade.assignmentId,
            error: `Grade already exists for student ${grade.studentId} on assignment ${grade.assignmentId}`
          });
        }
      } catch (error: any) {
        // If query fails, log but don't block (will fail during actual grade creation)
        this.logger.warn(`Failed to check duplicate grade: ${error.message}`);
      }
    }

    return errors;
  }

  /**
   * Import grades from CSV file
   * Phase 5: Advanced Features - CSV Import
   * 
   * CSV Format:
   * studentId,assignmentId,score,maxScore,letterGrade,notes
   * student-123,assignment-456,85,100,B,Good work
   */
  async importGradesFromCsv(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    csvFile: any,
    context: RequestContext
  ): Promise<{
    success: Array<{ studentId: string; assignmentId: string; gradeId: string }>;
    failed: Array<{ row: number; studentId?: string; assignmentId?: string; error: string }>;
    summary: { total: number; succeeded: number; failed: number };
  }> {
    const startTime = Date.now();
    try {
      // 1. Parse CSV file
      let records: any[];
      try {
        records = parse(csvFile.buffer.toString('utf-8'), {
          columns: true,
          skip_empty_lines: true,
          trim: true
        }) as any[];
      } catch (parseError: any) {
        this.logger.error(`CSV parsing failed: ${parseError.message}`);
        throw new BadRequestException(`Invalid CSV format: ${parseError.message}`);
      }

      if (records.length === 0) {
        throw new BadRequestException('CSV file is empty or contains no valid records');
      }

      this.logger.log(`Parsed ${records.length} records from CSV file`);

      // 2. Convert CSV records to CreateGradeDto format
      const grades: CreateGradeDto[] = [];
      const failures: Array<{ row: number; studentId?: string; assignmentId?: string; error: string }> = [];

      records.forEach((record, index) => {
        const rowNumber = index + 2;

        try {
          // Validate required fields
          if (!record.studentId || !record.assignmentId || record.score === undefined || record.maxScore === undefined) {
            failures.push({
              row: rowNumber,
              studentId: record.studentId,
              assignmentId: record.assignmentId,
              error: 'Missing required fields: studentId, assignmentId, score, or maxScore'
            });
            return;
          }

          // Validate score range
          const score = parseFloat(record.score);
          const maxScore = parseFloat(record.maxScore);
          if (isNaN(score) || isNaN(maxScore) || score < 0 || score > maxScore) {
            failures.push({
              row: rowNumber,
              studentId: record.studentId,
              assignmentId: record.assignmentId,
              error: `Invalid score: ${record.score}/${record.maxScore}. Score must be between 0 and maxScore`
            });
            return;
          }

          // Build CreateGradeDto
          const createDto: CreateGradeDto = {
            studentId: record.studentId,
            assignmentId: record.assignmentId,
            score,
            maxPoints: maxScore,
            termId: record.termId,
            categoryId: record.categoryId,
            isLate: record.isLate === 'true' || record.isLate === '1',
            penaltyApplied: record.penaltyApplied ? parseFloat(record.penaltyApplied) : undefined,
            feedback: record.notes || record.feedback,
            rubricScores: undefined,
            status: record.status || 'draft',
            isExcused: record.isExcused === 'true' || record.isExcused === '1',
            isFinal: record.isFinal === 'true' || record.isFinal === '1',
            canRetake: record.canRetake === 'true' || record.canRetake === '1'
          };

          grades.push(createDto);
        } catch (error: any) {
          failures.push({
            row: rowNumber,
            studentId: record.studentId,
            assignmentId: record.assignmentId,
            error: error.message || 'Unknown error'
          });
        }
      });

      // 3. Use bulkCreateGrades to process the grades
      const bulkDto: BulkGradeDto = { grades };
      const result = await this.bulkCreateGrades(tenantId, schoolId, academicYearId, classroomId, bulkDto, context);

      // Combine CSV parsing failures with bulk processing failures
      const allFailures = [
        ...failures,
        ...result.failed.map(f => ({
          row: 0,
          studentId: f.studentId,
          assignmentId: f.assignmentId,
          error: f.error
        }))
      ];

      const duration = Date.now() - startTime;
      this.logger.log(
        `CSV import completed in ${duration}ms: ${result.summary.succeeded} succeeded, ${allFailures.length} failed`
      );

      return {
        success: result.success,
        failed: allFailures,
        summary: {
          total: records.length,
          succeeded: result.summary.succeeded,
          failed: allFailures.length
        }
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error('❌ CSV import failed:', error);
      throw new InternalServerErrorException('Failed to import grades from CSV');
    }
  }
}


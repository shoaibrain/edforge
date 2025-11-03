import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Grade, EntityKeyBuilder, RequestContext } from './entities/grading.entity';
import { CreateGradeDto, UpdateGradeDto } from './dto/grading.dto';
import { ValidationService } from './services/validation.service';
import { CalculationService } from './services/calculation.service';

@Injectable()
export class GradingService {
  constructor(
    private readonly validationService: ValidationService,
    private readonly calculationService: CalculationService
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

      // 4. Save to DynamoDB (TODO: Add when DynamoDB is configured)
      // await this.saveToDynamoDB(grade);

      console.log(`✅ Grade created for student ${createDto.studentId} on assignment ${createDto.assignmentId}: ${percentage}% (${letterGrade})`);
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

      // 2. Get existing grade
      const existing = await this.getGrade(tenantId, schoolId, academicYearId, studentId, assignmentId, context.jwtToken);

      // 3. Check version for optimistic locking
      if (updateDto.version && existing.version !== updateDto.version) {
        throw new BadRequestException('Grade has been modified by another user. Please refresh and try again.');
      }

      // 4. Recalculate if score or maxPoints changed
      let percentage = existing.percentage;
      let letterGrade = existing.letterGrade;
      
      if (updateDto.score !== undefined || updateDto.maxPoints !== undefined) {
        const newScore = updateDto.score ?? existing.score;
        const newMaxPoints = updateDto.maxPoints ?? existing.maxPoints;
        percentage = this.calculationService.calculatePercentage(newScore, newMaxPoints);
        const gradingScale = this.calculationService.getDefaultGradingScale();
        letterGrade = this.calculationService.calculateLetterGrade(percentage, gradingScale);
      }

      // 5. Update (TODO: Implement DynamoDB update)
      throw new Error('Update not implemented yet');

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
}


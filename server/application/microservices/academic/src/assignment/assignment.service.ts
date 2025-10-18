import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Assignment, EntityKeyBuilder, RequestContext } from './entities/assignment.entity';
import { CreateAssignmentDto, UpdateAssignmentDto } from './dto/assignment.dto';
import { ValidationService } from './services/validation.service';

@Injectable()
export class AssignmentService {
  constructor(
    private readonly validationService: ValidationService
  ) {}

  private tableName: string = process.env.TABLE_NAME || 'ACADEMIC_TABLE';

  /**
   * Create a new assignment
   */
  async createAssignment(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    createDto: CreateAssignmentDto,
    context: RequestContext
  ): Promise<Assignment> {
    try {
      // 1. Validate
      await this.validationService.validateAssignmentCreation(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        createDto
      );

      // 2. Build entity
      const assignmentId = uuid();
      const timestamp = new Date().toISOString();
      
      const assignment: Assignment = {
        tenantId,
        entityKey: EntityKeyBuilder.assignment(schoolId, academicYearId, classroomId, assignmentId),
        entityType: 'ASSIGNMENT',
        assignmentId,
        schoolId,
        academicYearId,
        classroomId,
        title: createDto.title,
        description: createDto.description,
        instructions: createDto.instructions,
        type: createDto.type,
        category: createDto.category,
        assignedDate: createDto.assignedDate,
        dueDate: createDto.dueDate,
        availableFrom: createDto.availableFrom,
        availableUntil: createDto.availableUntil,
        maxPoints: createDto.maxPoints,
        weight: createDto.weight,
        passingScore: createDto.passingScore,
        allowLateSubmission: createDto.allowLateSubmission ?? true,
        lateSubmissionPenalty: createDto.lateSubmissionPenalty,
        attachments: createDto.attachments?.map(a => ({
          ...a,
          uploadedAt: timestamp
        })) || [],
        status: createDto.status || 'draft',
        publishedAt: createDto.status === 'published' ? timestamp : undefined,
        createdByTeacherId: context.userId,
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        gsi1pk: `${classroomId}#${academicYearId}`,
        gsi1sk: `ASSIGNMENT#${assignmentId}`,
        gsi2pk: `${context.userId}#${academicYearId}`,
        gsi2sk: `ASSIGNMENT#${assignmentId}`,
      };

      // 3. Save to DynamoDB (TODO: Add when DynamoDB is configured)
      // await this.saveToDynamoDB(assignment);

      console.log(`✅ Assignment created: ${assignment.title} (${assignmentId})`);
      return assignment;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      console.error('❌ Assignment creation failed:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        error: error.message,
        stack: error.stack
      });
      
      throw new InternalServerErrorException({
        message: 'Failed to create assignment',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get assignment by ID
   */
  async getAssignment(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string,
    jwtToken: string
  ): Promise<Assignment> {
    // TODO: Implement DynamoDB query
    throw new NotFoundException(`Assignment with ID ${assignmentId} not found`);
  }

  /**
   * Get all assignments for a classroom
   */
  async getAssignments(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    filters: any,
    jwtToken: string
  ): Promise<Assignment[]> {
    // TODO: Implement DynamoDB query using GSI1
    // Query: gsi1pk = classroomId#academicYearId
    // Optional filters: status, type, date range
    return [];
  }

  /**
   * Get assignments created by a teacher
   */
  async getAssignmentsByTeacher(
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<Assignment[]> {
    // TODO: Implement DynamoDB query using GSI2
    // Query: gsi2pk = teacherId#academicYearId
    return [];
  }

  /**
   * Update assignment
   */
  async updateAssignment(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string,
    updateDto: UpdateAssignmentDto,
    context: RequestContext
  ): Promise<Assignment> {
    try {
      // 1. Validate
      await this.validationService.validateAssignmentUpdate(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId,
        updateDto
      );

      // 2. Get existing assignment
      const existing = await this.getAssignment(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId,
        context.jwtToken
      );

      // 3. Check version for optimistic locking
      if (updateDto.version && existing.version !== updateDto.version) {
        throw new BadRequestException('Assignment has been modified by another user. Please refresh and try again.');
      }

      // 4. Update (TODO: Implement DynamoDB update)
      throw new Error('Update not implemented yet');

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      console.error('❌ Assignment update failed:', error);
      throw new InternalServerErrorException('Failed to update assignment');
    }
  }

  /**
   * Publish assignment (change status from draft to published)
   */
  async publishAssignment(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string,
    context: RequestContext
  ): Promise<Assignment> {
    try {
      // Get existing assignment
      const existing = await this.getAssignment(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId,
        context.jwtToken
      );

      if (existing.status !== 'draft') {
        throw new BadRequestException('Only draft assignments can be published');
      }

      // Update status to published
      return this.updateAssignment(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId,
        { status: 'published', version: existing.version },
        context
      );

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      console.error('❌ Assignment publish failed:', error);
      throw new InternalServerErrorException('Failed to publish assignment');
    }
  }

  /**
   * Archive assignment
   */
  async archiveAssignment(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string,
    context: RequestContext
  ): Promise<Assignment> {
    try {
      const existing = await this.getAssignment(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId,
        context.jwtToken
      );

      return this.updateAssignment(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        assignmentId,
        { status: 'archived', version: existing.version },
        context
      );

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      console.error('❌ Assignment archive failed:', error);
      throw new InternalServerErrorException('Failed to archive assignment');
    }
  }
}


import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import type { Assignment, RequestContext } from '@edforge/shared-types';
import { EntityKeyBuilder } from './entities/assignment.entity';
import { CreateAssignmentDto, UpdateAssignmentDto } from './dto/assignment.dto';
import { ValidationService } from './services/validation.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { retryWithBackoff } from '../common/utils/retry.util';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly validationService: ValidationService,
    private readonly dynamoDBClient: DynamoDBClientService
  ) {}

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

      // 3. Save to DynamoDB
      try {
        await this.dynamoDBClient.putItem(assignment);
        this.logger.log(`Assignment created successfully: ${assignment.title} (${assignmentId})`);
      } catch (error) {
        this.logger.error(`Failed to save assignment to DynamoDB: ${error.message}`);
        throw new InternalServerErrorException('Failed to create assignment');
      }

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
    jwtToken: string // Note: This should be a RequestContext object
  ): Promise<Assignment> {
    try {
      const entityKey = EntityKeyBuilder.assignment(schoolId, academicYearId, classroomId, assignmentId);
      const assignment = await this.dynamoDBClient.getItem(tenantId, entityKey);
      
      if (!assignment) {
        this.logger.warn(`Assignment not found: ${assignmentId} for tenant: ${tenantId}`);
        throw new NotFoundException(`Assignment with ID ${assignmentId} not found`);
      }

      // Verify tenant isolation
      if (assignment.tenantId !== tenantId) {
        this.logger.warn(`Tenant isolation violation: ${tenantId} trying to access assignment ${assignmentId}`);
        throw new NotFoundException(`Assignment with ID ${assignmentId} not found`);
      }

      this.logger.debug(`Assignment retrieved successfully: ${assignmentId}`);
      return assignment as Assignment;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      this.logger.error(`Failed to get assignment: ${error.message}`, {
        tenantId,
        assignmentId,
        error: error.stack
      });
      throw new InternalServerErrorException('Failed to retrieve assignment');
    }
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
    jwtToken: string // Note: This should be a RequestContext object
  ): Promise<Assignment[]> {
    try {
      const gsi1pk = `${classroomId}#${academicYearId}`;
      const gsi1sk = 'ASSIGNMENT#';
      
      // Build filter expression for optional filters
      let filterExpression: string | undefined;
      const expressionAttributeValues: any = {};
      
      if (filters.status) {
        filterExpression = '#status = :status';
        expressionAttributeValues[':status'] = filters.status;
      }
      
      if (filters.type) {
        if (filterExpression) {
          filterExpression += ' AND #type = :type';
        } else {
          filterExpression = '#type = :type';
        }
        expressionAttributeValues[':type'] = filters.type;
      }

      const assignments = await this.dynamoDBClient.queryGSI(
        'GSI1',
        gsi1pk,
        gsi1sk,
        'begins_with',
        filterExpression,
        expressionAttributeValues,
        filters.limit || 100
      );

      // Filter by tenant isolation
      const tenantAssignments = assignments.filter(assignment => assignment.tenantId === tenantId);
      
      this.logger.debug(`Retrieved ${tenantAssignments.length} assignments for classroom ${classroomId}`);
      return tenantAssignments as Assignment[];
    } catch (error) {
      this.logger.error(`Failed to get assignments: ${error.message}`, {
        tenantId,
        classroomId,
        error: error.stack
      });
      return [];
    }
  }

  /**
   * Get assignments created by a teacher
   */
  async getAssignmentsByTeacher(
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    jwtToken: string // Note: This should be a RequestContext object
  ): Promise<Assignment[]> {
    try {
      const gsi2pk = `${teacherId}#${academicYearId}`;
      const gsi2sk = 'ASSIGNMENT#';
      
      const assignments = await this.dynamoDBClient.queryGSI(
        'GSI2',
        gsi2pk,
        gsi2sk,
        'begins_with',
        undefined,
        {},
        100
      );

      // Filter by tenant isolation
      const tenantAssignments = assignments.filter(assignment => assignment.tenantId === tenantId);
      
      this.logger.debug(`Retrieved ${tenantAssignments.length} assignments for teacher ${teacherId}`);
      return tenantAssignments as Assignment[];
    } catch (error) {
      this.logger.error(`Failed to get assignments by teacher: ${error.message}`, {
        tenantId,
        teacherId,
        error: error.stack
      });
      return [];
    }
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

      // 2. Use retry mechanism with fresh data fetch on conflict
      const updatedAssignment = await retryWithBackoff(
        async () => {
          // Fetch fresh assignment data on each retry attempt to get latest version
          const existing = await this.getAssignment(
            tenantId,
            schoolId,
            academicYearId,
            classroomId,
            assignmentId,
            context.jwtToken
          );

          // Use the fresh version from database
          const currentVersion = existing.version;

          // 3. Update DynamoDB
          const timestamp = new Date().toISOString();
          const updateExpression = 'SET #title = :title, #description = :description, #instructions = :instructions, #type = :type, #category = :category, #assignedDate = :assignedDate, #dueDate = :dueDate, #availableFrom = :availableFrom, #availableUntil = :availableUntil, #maxPoints = :maxPoints, #weight = :weight, #passingScore = :passingScore, #allowLateSubmission = :allowLateSubmission, #lateSubmissionPenalty = :lateSubmissionPenalty, #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = :version';
          
          const expressionAttributeNames = {
            '#title': 'title',
            '#description': 'description',
            '#instructions': 'instructions',
            '#type': 'type',
            '#category': 'category',
            '#assignedDate': 'assignedDate',
            '#dueDate': 'dueDate',
            '#availableFrom': 'availableFrom',
            '#availableUntil': 'availableUntil',
            '#maxPoints': 'maxPoints',
            '#weight': 'weight',
            '#passingScore': 'passingScore',
            '#allowLateSubmission': 'allowLateSubmission',
            '#lateSubmissionPenalty': 'lateSubmissionPenalty',
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#updatedBy': 'updatedBy',
            '#version': 'version'
          };

          const expressionAttributeValues = {
            ':title': updateDto.title || existing.title,
            ':description': updateDto.description !== undefined ? updateDto.description : existing.description,
            ':instructions': updateDto.instructions !== undefined ? updateDto.instructions : existing.instructions,
            ':type': updateDto.type || existing.type,
            ':category': updateDto.category || existing.category,
            ':assignedDate': updateDto.assignedDate || existing.assignedDate,
            ':dueDate': updateDto.dueDate || existing.dueDate,
            ':availableFrom': updateDto.availableFrom !== undefined ? updateDto.availableFrom : existing.availableFrom,
            ':availableUntil': updateDto.availableUntil !== undefined ? updateDto.availableUntil : existing.availableUntil,
            ':maxPoints': updateDto.maxPoints !== undefined ? updateDto.maxPoints : existing.maxPoints,
            ':weight': updateDto.weight !== undefined ? updateDto.weight : existing.weight,
            ':passingScore': updateDto.passingScore !== undefined ? updateDto.passingScore : existing.passingScore,
            ':allowLateSubmission': updateDto.allowLateSubmission !== undefined ? updateDto.allowLateSubmission : existing.allowLateSubmission,
            ':lateSubmissionPenalty': updateDto.lateSubmissionPenalty !== undefined ? updateDto.lateSubmissionPenalty : existing.lateSubmissionPenalty,
            ':status': updateDto.status || existing.status,
            ':updatedAt': timestamp,
            ':updatedBy': context.userId,
            ':version': currentVersion + 1,
            ':currentVersion': currentVersion
          };

          const conditionExpression = '#version = :currentVersion';

          const updated = await this.dynamoDBClient.updateItem(
            tenantId,
            existing.entityKey,
            updateExpression,
            expressionAttributeValues,
            conditionExpression,
            expressionAttributeNames
          );

          return updated as Assignment;
        },
        {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 2000
        },
        this.logger
      ).catch((error) => {
        // Transform error to user-friendly message
        if (error.name === 'ConditionalCheckFailedException' || error.message?.includes('Update condition not met')) {
          throw new BadRequestException('Assignment has been modified by another user. Please refresh and try again.');
        }
        throw error;
      });

      this.logger.log(`✅ Assignment updated successfully: ${assignmentId} (v${updatedAssignment.version})`);
      return updatedAssignment;

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


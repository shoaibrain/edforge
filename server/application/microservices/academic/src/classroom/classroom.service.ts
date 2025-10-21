import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Classroom, EntityKeyBuilder, RequestContext } from './entities/classroom.entity';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classroom.dto';
import { ValidationService } from './services/validation.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';

@Injectable()
export class ClassroomService {
  private readonly logger = new Logger(ClassroomService.name);

  constructor(
    private readonly validationService: ValidationService,
    private readonly dynamoDBClient: DynamoDBClientService
  ) {}

  /**
   * Create a new classroom
   */
  async createClassroom(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    createDto: CreateClassroomDto,
    context: RequestContext
  ): Promise<Classroom> {
    try {
      // 1. Validate
      await this.validationService.validateClassroomCreation(
        tenantId,
        schoolId,
        academicYearId,
        createDto
      );

      // 2. Build entity
      const classroomId = uuid();
      const timestamp = new Date().toISOString();
      
      const classroom: Classroom = {
        tenantId,
        entityKey: EntityKeyBuilder.classroom(schoolId, academicYearId, classroomId),
        entityType: 'CLASSROOM',
        classroomId,
        schoolId,
        academicYearId,
        name: createDto.name,
        code: createDto.code,
        subject: createDto.subject,
        grade: createDto.grade,
        section: createDto.section,
        teacherId: createDto.teacherId,
        coTeacherIds: createDto.coTeacherIds || [],
        room: createDto.room,
        capacity: createDto.capacity,
        schedule: createDto.schedule,
        enrolledStudentIds: [],
        enrollmentCount: 0,
        status: createDto.status || 'active',
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        gsi1pk: `${schoolId}#${academicYearId}`,
        gsi1sk: `CLASSROOM#${classroomId}`,
        gsi2pk: `${createDto.teacherId}#${academicYearId}`,
        gsi2sk: `CLASSROOM#${classroomId}`,
      };

      // 3. Save to DynamoDB
      try {
        await this.dynamoDBClient.putItem(classroom);
        this.logger.log(`Classroom created successfully: ${classroom.name} (${classroomId})`);
      } catch (error) {
        this.logger.error(`Failed to save classroom to DynamoDB: ${error.message}`);
        throw new InternalServerErrorException('Failed to create classroom');
      }

      return classroom;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      console.error('❌ Classroom creation failed:', {
        tenantId,
        schoolId,
        academicYearId,
        error: error.message,
        stack: error.stack
      });
      
      throw new InternalServerErrorException({
        message: 'Failed to create classroom',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get classroom by ID
   */
  async getClassroom(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    jwtToken: string
  ): Promise<Classroom> {
    try {
      const entityKey = EntityKeyBuilder.classroom(schoolId, academicYearId, classroomId);
      const classroom = await this.dynamoDBClient.getItem(tenantId, entityKey);
      
      if (!classroom) {
        this.logger.warn(`Classroom not found: ${classroomId} for tenant: ${tenantId}`);
        throw new NotFoundException(`Classroom with ID ${classroomId} not found`);
      }

      // Verify tenant isolation
      if (classroom.tenantId !== tenantId) {
        this.logger.warn(`Tenant isolation violation: ${tenantId} trying to access classroom ${classroomId}`);
        throw new NotFoundException(`Classroom with ID ${classroomId} not found`);
      }

      this.logger.debug(`Classroom retrieved successfully: ${classroomId}`);
      return classroom as Classroom;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      this.logger.error(`Failed to get classroom: ${error.message}`, {
        tenantId,
        classroomId,
        error: error.stack
      });
      throw new InternalServerErrorException('Failed to retrieve classroom');
    }
  }

  /**
   * Get all classrooms for a school/academic year
   */
  async getClassrooms(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    filters: any,
    jwtToken: string
  ): Promise<Classroom[]> {
    try {
      const gsi1pk = `${schoolId}#${academicYearId}`;
      const gsi1sk = 'CLASSROOM#';
      
      // Build filter expression for optional filters
      let filterExpression: string | undefined;
      const expressionAttributeValues: any = {};
      
      if (filters.status) {
        filterExpression = '#status = :status';
        expressionAttributeValues[':status'] = filters.status;
      }
      
      if (filters.grade) {
        if (filterExpression) {
          filterExpression += ' AND #grade = :grade';
        } else {
          filterExpression = '#grade = :grade';
        }
        expressionAttributeValues[':grade'] = filters.grade;
      }

      if (filters.subject) {
        if (filterExpression) {
          filterExpression += ' AND #subject = :subject';
        } else {
          filterExpression = '#subject = :subject';
        }
        expressionAttributeValues[':subject'] = filters.subject;
      }

      const classrooms = await this.dynamoDBClient.queryGSI(
        'GSI1',
        gsi1pk,
        gsi1sk,
        'begins_with',
        filterExpression,
        expressionAttributeValues,
        filters.limit || 100
      );

      // Filter by tenant isolation
      const tenantClassrooms = classrooms.filter(classroom => classroom.tenantId === tenantId);
      
      this.logger.debug(`Retrieved ${tenantClassrooms.length} classrooms for school ${schoolId}`);
      return tenantClassrooms as Classroom[];
    } catch (error) {
      this.logger.error(`Failed to get classrooms: ${error.message}`, {
        tenantId,
        schoolId,
        error: error.stack
      });
      return [];
    }
  }

  /**
   * Get classrooms for a teacher
   */
  async getClassroomsByTeacher(
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    jwtToken: string  // Note: This should be a RequestContext object
  ): Promise<Classroom[]> {
    try {
      const gsi2pk = `${teacherId}#${academicYearId}`;
      const gsi2sk = 'CLASSROOM#';
      
      const classrooms = await this.dynamoDBClient.queryGSI(
        'GSI2',
        gsi2pk,
        gsi2sk,
        'begins_with',
        undefined,
        {},
        100
      );

      // Filter by tenant isolation
      const tenantClassrooms = classrooms.filter(classroom => classroom.tenantId === tenantId);
      
      this.logger.debug(`Retrieved ${tenantClassrooms.length} classrooms for teacher ${teacherId}`);
      return tenantClassrooms as Classroom[];
    } catch (error) {
      this.logger.error(`Failed to get classrooms by teacher: ${error.message}`, {
        tenantId,
        teacherId,
        error: error.stack
      });
      return [];
    }
  }

  /**
   * Update classroom
   */
  async updateClassroom(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    updateDto: UpdateClassroomDto,
    context: RequestContext
  ): Promise<Classroom> {
    try {
      // 1. Validate
      await this.validationService.validateClassroomUpdate(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        updateDto
      );

      // 2. Get existing classroom
      const existing = await this.getClassroom(tenantId, schoolId, academicYearId, classroomId, context.jwtToken);

      // 3. Check version for optimistic locking
      if (updateDto.version && existing.version !== updateDto.version) {
        throw new BadRequestException('Classroom has been modified by another user. Please refresh and try again.');
      }

      // 4. Update DynamoDB
      const timestamp = new Date().toISOString();
      const updateExpression = 'SET #name = :name, #code = :code, #subject = :subject, #grade = :grade, #section = :section, #teacherId = :teacherId, #coTeacherIds = :coTeacherIds, #room = :room, #capacity = :capacity, #schedule = :schedule, #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = :version';
      
      const expressionAttributeNames = {
        '#name': 'name',
        '#code': 'code',
        '#subject': 'subject',
        '#grade': 'grade',
        '#section': 'section',
        '#teacherId': 'teacherId',
        '#coTeacherIds': 'coTeacherIds',
        '#room': 'room',
        '#capacity': 'capacity',
        '#schedule': 'schedule',
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
        '#version': 'version'
      };

      const expressionAttributeValues = {
        ':name': updateDto.name || existing.name,
        ':code': updateDto.code || existing.code,
        ':subject': updateDto.subject || existing.subject,
        ':grade': updateDto.grade || existing.grade,
        ':section': updateDto.section || existing.section,
        ':teacherId': updateDto.teacherId || existing.teacherId,
        ':coTeacherIds': updateDto.coTeacherIds !== undefined ? updateDto.coTeacherIds : existing.coTeacherIds,
        ':room': updateDto.room !== undefined ? updateDto.room : existing.room,
        ':capacity': updateDto.capacity !== undefined ? updateDto.capacity : existing.capacity,
        ':schedule': updateDto.schedule || existing.schedule,
        ':status': updateDto.status || existing.status,
        ':updatedAt': timestamp,
        ':updatedBy': context.userId,
        ':version': existing.version + 1,
        ':currentVersion': existing.version
      };

      const conditionExpression = '#version = :currentVersion';

      try {
        const updatedClassroom = await this.dynamoDBClient.updateItem(
          tenantId,
          existing.entityKey,
          updateExpression,
          expressionAttributeValues,
          conditionExpression
        );

        this.logger.log(`Classroom updated successfully: ${classroomId}`);
        return updatedClassroom as Classroom;
      } catch (error) {
        if (error.message.includes('Update condition not met')) {
          throw new BadRequestException('Classroom has been modified by another user. Please refresh and try again.');
        }
        throw error;
      }

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      console.error('❌ Classroom update failed:', error);
      throw new InternalServerErrorException('Failed to update classroom');
    }
  }

  /**
   * Enroll student in classroom
   */
  async enrollStudent(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string,
    context: RequestContext
  ): Promise<Classroom> {
    // TODO: Implement enrollment logic
    throw new Error('Enrollment not implemented yet');
  }

  /**
   * Unenroll student from classroom
   */
  async unenrollStudent(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string,
    context: RequestContext
  ): Promise<Classroom> {
    // TODO: Implement unenrollment logic
    throw new Error('Unenrollment not implemented yet');
  }
}


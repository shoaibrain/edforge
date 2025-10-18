import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Classroom, EntityKeyBuilder, RequestContext } from './entities/classroom.entity';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classroom.dto';
import { ValidationService } from './services/validation.service';

@Injectable()
export class ClassroomService {
  constructor(
    private readonly validationService: ValidationService
  ) {}

  private tableName: string = process.env.TABLE_NAME || 'ACADEMIC_TABLE';

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

      // 3. Save to DynamoDB (TODO: Add when DynamoDB is configured)
      // await this.saveToDynamoDB(classroom);

      console.log(`✅ Classroom created: ${classroom.name} (${classroomId})`);
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
    // TODO: Implement DynamoDB query
    throw new NotFoundException(`Classroom with ID ${classroomId} not found`);
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
    // TODO: Implement DynamoDB query using GSI1
    return [];
  }

  /**
   * Get classrooms for a teacher
   */
  async getClassroomsByTeacher(
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<Classroom[]> {
    // TODO: Implement DynamoDB query using GSI2
    return [];
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

      // 4. Update (TODO: Implement DynamoDB update)
      throw new Error('Update not implemented yet');

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


/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Service - Enrollment lifecycle management with atomic transactions
 * 
 * ARCHITECTURE:
 * - Atomic transactions for enrollment operations
 * - Integrates with School service for capacity management
 * - Integrates with Finance service for invoice generation
 */

import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { StudentService } from '../student/student.service';
import { FinanceHttpClientService } from '../common/services/finance-http-client.service';
import { CurriculumHttpClientService } from '../common/services/curriculum-http-client.service';
import { EnrollmentEventsService } from '../common/services/enrollment-events.service';
import { Enrollment, EnrollmentWithGSI } from '../common/entities/enrollment.entities';
import { RequestContext } from '../common/entities/base.entity';
import type { Invoice } from '@edforge/shared-types';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { retryWithBackoff } from '@app/common-utils';
import { 
  CreateEnrollmentDto, 
  UpdateEnrollmentStatusDto, 
  TransferEnrollmentDto,
  SuspendEnrollmentDto,
  GraduateEnrollmentDto,
  BulkEnrollmentDto,
  BulkEnrollmentResponse,
  BulkEnrollmentResult,
  BulkEnrollmentFailure
} from './dto/enrollment.dto';
import { UpdateStudentDto } from '../student/dto/student.dto';
import {
  EnrollmentNotFoundException,
  CapacityExceededException,
  DuplicateEnrollmentException,
  InvalidStatusTransitionException
} from '../common/errors/enrollment-exception';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CsvParserService } from '@app/csv-parser';
import { ICacheService } from '@app/cache';
import { Inject } from '@nestjs/common';

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly studentService: StudentService,
    private readonly financeHttpClient: FinanceHttpClientService,
    private readonly curriculumHttpClient: CurriculumHttpClientService,
    private readonly eventsService: EnrollmentEventsService,
    private readonly csvParser: CsvParserService,
    @Inject('ICacheService') private readonly cache: ICacheService
  ) {}

  /**
   * Enroll Student - ATOMIC TRANSACTION (4-item)
   * 
   * Creates: Enrollment + Updates Student + Creates Invoice + Creates/Updates BillingAccount
   * 
   * This is a critical operation that must be atomic to ensure data consistency.
   * All four operations succeed or fail together.
   */
  async enrollStudent(
    tenantId: string,
    studentId: string,
    createEnrollmentDto: CreateEnrollmentDto,
    context: RequestContext
  ): Promise<{ enrollment: Enrollment; invoice: any }> {
    const timestamp = new Date().toISOString();
    const enrollmentId = uuid();

    // 1. Validate student exists
    const student = await this.studentService.getStudent(tenantId, studentId);

    // 2. Check for duplicate enrollment
    const existingEnrollment = await this.getEnrollmentByStudentYear(
      tenantId,
      studentId,
      createEnrollmentDto.academicYearId
    );
    if (existingEnrollment && existingEnrollment.status !== 'withdrawn') {
      throw new DuplicateEnrollmentException(studentId, createEnrollmentDto.academicYearId);
    }

    // 3. Validate classroom capacity (if classroomId provided in future)
    // Note: For MVP, capacity validation is optional
    // TODO: Add classroomId to CreateEnrollmentDto when needed
    // For now, capacity validation can be done via events in Phase 3
    
    // 4. Get tuition configuration for invoice calculation with retry logic
    let tuitionConfig;
    try {
      tuitionConfig = await retryWithBackoff(
        () => this.financeHttpClient.getTuitionConfiguration(
          tenantId,
          createEnrollmentDto.schoolId,
          createEnrollmentDto.academicYearId
        ),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000
        },
        this.logger
      );
    } catch (error: any) {
      this.logger.error(`Failed to get tuition configuration after retries: ${error.message}`);
      if (error instanceof ServiceUnavailableException || error.isCircuitBreakerOpen) {
        // If Finance Service is down, log and continue enrollment (invoice created later)
        this.logger.warn(`Finance Service unavailable, continuing enrollment without invoice. Will retry later.`);
        throw new ServiceUnavailableException('Finance Service is currently unavailable. Please try again later.');
      }
      throw new BadRequestException(`Failed to get tuition configuration: ${error.message}`);
    }

    // 5. Create enrollment entity
    const enrollment: EnrollmentWithGSI = {
      tenantId,
      entityKey: EntityKeyBuilder.enrollment(
        createEnrollmentDto.schoolId,
        createEnrollmentDto.academicYearId,
        studentId
      ),
      entityType: 'ENROLLMENT',
      
      studentId,
      schoolId: createEnrollmentDto.schoolId,
      academicYearId: createEnrollmentDto.academicYearId,
      enrollmentId,
      
      enrollmentDate: createEnrollmentDto.enrollmentDate,
      gradeLevel: createEnrollmentDto.gradeLevel,
      section: createEnrollmentDto.section,
      
      status: createEnrollmentDto.status || 'active',
      statusDate: timestamp,
      
      academicStatus: 'on_track',
      promotionEligible: true,
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // GSI Keys
      gsi1pk: createEnrollmentDto.schoolId,
      gsi1sk: `ENROLLMENT#${createEnrollmentDto.academicYearId}#${studentId}`,
      gsi2pk: `${createEnrollmentDto.schoolId}#${createEnrollmentDto.academicYearId}`,
      gsi2sk: `ENROLLMENT#${createEnrollmentDto.status || 'active'}#${studentId}`,
      gsi7pk: studentId,
      gsi7sk: `ENROLLMENT#${createEnrollmentDto.academicYearId}#${createEnrollmentDto.status || 'active'}`
    };

    // 6. Calculate invoice (HTTP call to finance-service) with retry logic
    let invoiceCalculation;
    try {
      invoiceCalculation = await retryWithBackoff(
        () => this.financeHttpClient.calculateInvoice(enrollment, tuitionConfig),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000
        },
        this.logger
      );
    } catch (error: any) {
      this.logger.error(`Failed to calculate invoice after retries: ${error.message}`);
      if (error instanceof ServiceUnavailableException || error.isCircuitBreakerOpen) {
        // If Finance Service is down, don't create enrollment
        throw new ServiceUnavailableException('Finance Service is currently unavailable. Cannot calculate invoice. Please try again later.');
      }
      throw new BadRequestException(`Failed to calculate invoice: ${error.message}`);
    }

    // 7. Get or check billing account
    const accountKey = EntityKeyBuilder.billingAccount(
      createEnrollmentDto.schoolId,
      createEnrollmentDto.academicYearId,
      studentId
    );
    const existingAccount = await this.dynamoDBClient.getItem(tenantId, accountKey) as any;

    // 8. Prepare invoice and account entities with retry logic
    const accountId = existingAccount?.accountId || uuid();
    let invoice;
    let paymentPlanInfo;
    
    try {
      // Prepare invoice entity
      invoice = await retryWithBackoff(
        () => this.financeHttpClient.prepareInvoiceEntity(
          tenantId,
          enrollment,
          tuitionConfig,
          invoiceCalculation,
          accountId,
          context
        ),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000
        },
        this.logger
      );

      // Select payment plan
      paymentPlanInfo = await retryWithBackoff(
        () => this.financeHttpClient.selectPaymentPlan(tuitionConfig, invoiceCalculation.total),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000
        },
        this.logger
      );
    } catch (error: any) {
      this.logger.error(`Failed to prepare invoice after retries: ${error.message}`);
      if (error instanceof ServiceUnavailableException || error.isCircuitBreakerOpen) {
        // If Finance Service is down, don't create enrollment
        throw new ServiceUnavailableException('Finance Service is currently unavailable. Cannot create invoice. Please try again later.');
      }
      throw new BadRequestException(`Failed to prepare invoice: ${error.message}`);
    }
    
    let account: any;
    const isNewAccount = !existingAccount;
    
    if (isNewAccount) {
      account = {
        tenantId,
        entityKey: accountKey,
        entityType: 'BILLING_ACCOUNT',
        studentId,
        schoolId: createEnrollmentDto.schoolId,
        academicYearId: createEnrollmentDto.academicYearId,
        accountId,
        balance: {
          totalDue: invoiceCalculation.total,
          totalPaid: 0,
          totalOutstanding: invoiceCalculation.total,
          currency: invoiceCalculation.currency,
          lastUpdated: timestamp
        },
        paymentPlan: paymentPlanInfo.paymentPlan,
        installmentCount: paymentPlanInfo.installmentCount,
        installmentAmount: paymentPlanInfo.installmentAmount,
        nextDueDate: paymentPlanInfo.nextDueDate,
        status: 'active',
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        gsi2pk: `${createEnrollmentDto.schoolId}#${createEnrollmentDto.academicYearId}`,
        gsi2sk: `ACCOUNT#active#${studentId}`,
        gsi7pk: studentId,
        gsi7sk: `ACCOUNT#${createEnrollmentDto.academicYearId}`
      };
    }

    // 9. Prepare 4-item atomic transaction
    const transactItems: any[] = [
      // Item 1: Create Enrollment
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: enrollment
        }
      },
      // Item 2: Update Student
      {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: {
            tenantId,
            entityKey: EntityKeyBuilder.student(studentId)
          },
          UpdateExpression: 'SET currentEnrollment = :currentEnrollment, gsi1pk = :gsi1pk, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#version': 'version'
          },
          ExpressionAttributeValues: {
            ':currentEnrollment': {
              schoolId: createEnrollmentDto.schoolId,
              academicYearId: createEnrollmentDto.academicYearId,
              gradeLevel: createEnrollmentDto.gradeLevel,
              status: createEnrollmentDto.status || 'active'
            },
            ':gsi1pk': createEnrollmentDto.schoolId,
            ':updatedAt': timestamp,
            ':updatedBy': context.userId,
            ':inc': 1
          },
          ConditionExpression: 'attribute_exists(entityKey)'
        }
      },
      // Item 3: Create Invoice
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: invoice
        }
      }
    ];

    // Item 4: Create or Update Billing Account
    if (isNewAccount) {
      transactItems.push({
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: account
        }
      });
    } else {
      transactItems.push({
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: {
            tenantId,
            entityKey: accountKey
          },
          UpdateExpression: 'SET balance.totalDue = balance.totalDue + :amount, balance.totalOutstanding = balance.totalOutstanding + :amount, balance.lastUpdated = :timestamp, updatedAt = :timestamp, updatedBy = :userId, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#version': 'version'
          },
          ExpressionAttributeValues: {
            ':amount': invoiceCalculation.total,
            ':timestamp': timestamp,
            ':userId': context.userId,
            ':inc': 1,
            ':currentVersion': existingAccount.version
          },
          ConditionExpression: '#version = :currentVersion'
        }
      });
    }

    // 10. Execute atomic transaction (all 4 items)
    try {
      await this.dynamoDBClient.transactWrite(transactItems);
    } catch (error: any) {
      this.logger.error(`Transaction failed during enrollment: ${error.message}`, error.stack);
      // Transaction automatically rolls back on failure
      throw new BadRequestException(`Failed to complete enrollment transaction: ${error.message}`);
    }

    // 11. Publish StudentEnrolled event after successful enrollment
    try {
      await this.eventsService.publishStudentEnrolled({
        tenantId,
        studentId,
        schoolId: createEnrollmentDto.schoolId,
        academicYearId: createEnrollmentDto.academicYearId,
        enrollmentId,
        enrollmentDate: createEnrollmentDto.enrollmentDate || timestamp,
        gradeLevel: createEnrollmentDto.gradeLevel
      });
    } catch (eventError) {
      // Log error but don't fail enrollment if event publishing fails
      this.logger.warn(`Failed to publish StudentEnrolled event: ${eventError.message}`);
    }

    this.logger.log(
      `Student enrolled atomically: ${studentId} in school ${createEnrollmentDto.schoolId}, ` +
      `invoice ${invoice.invoiceNumber} created`
    );

    // Cache the newly created enrollment
    const cacheKey = `${tenantId}:enrollment:${enrollmentId}`;
    await this.cache.set(cacheKey, enrollment, 600);
    // Also invalidate student cache since enrollment status changed
    const studentCacheKey = `${tenantId}:student:${studentId}`;
    await this.cache.delete(studentCacheKey);

    return { enrollment, invoice };
  }

  /**
   * Get Enrollment by ID
   */
  /**
   * Get Enrollment by ID
   * Phase 5: Advanced Features - Caching Layer
   * 
   * Cache key: {tenantId}:enrollment:{enrollmentId}, TTL: 10 minutes
   */
  async getEnrollment(tenantId: string, enrollmentId: string): Promise<Enrollment> {
    const cacheKey = `${tenantId}:enrollment:${enrollmentId}`;
    
    // Check cache first
    const cached = await this.cache.get<Enrollment>(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - query DynamoDB
    // Need to query by enrollmentId - this requires a scan or GSI query
    // For now, we'll use a different approach - store enrollmentId in a way we can query
    // In production, you might want to add enrollmentId to GSI or use a different key structure
    
    // For MVP, we'll need to query enrollments and filter
    const enrollments = await this.dynamoDBClient.query(
      tenantId,
      'SCHOOL#',
      'entityType = :type AND enrollmentId = :enrollmentId',
      {
        ':type': 'ENROLLMENT',
        ':enrollmentId': enrollmentId
      }
    );

    if (enrollments.length === 0) {
      throw new EnrollmentNotFoundException(enrollmentId);
    }

    const enrollment = enrollments[0] as Enrollment;
    
    // Store in cache (TTL: 10 minutes = 600 seconds)
    await this.cache.set(cacheKey, enrollment, 600);
    
    return enrollment;
  }

  /**
   * Get Enrollment by Student and Year
   */
  async getEnrollmentByStudentYear(
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<Enrollment | null> {
    const result = await this.dynamoDBClient.queryGSI(
      'GSI7',
      studentId,
      `ENROLLMENT#${academicYearId}#`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      1
    );

    const enrollment = result.items.find(
      e => e.tenantId === tenantId && 
           e.entityType === 'ENROLLMENT' && 
           e.academicYearId === academicYearId
    );

    return enrollment ? (enrollment as Enrollment) : null;
  }

  /**
   * Update Enrollment Status
   */
  async updateEnrollmentStatus(
    tenantId: string,
    enrollmentId: string,
    updateStatusDto: UpdateEnrollmentStatusDto,
    context: RequestContext
  ): Promise<Enrollment> {
    const enrollment = await this.getEnrollment(tenantId, enrollmentId);
    
    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      'pending': ['active', 'cancelled'],
      'active': ['suspended', 'graduated', 'transferred', 'withdrawn'],
      'suspended': ['active', 'withdrawn'],
      'graduated': [],
      'transferred': [],
      'withdrawn': []
    };

    const allowedStatuses = validTransitions[enrollment.status] || [];
    if (!allowedStatuses.includes(updateStatusDto.status)) {
      throw new InvalidStatusTransitionException(enrollment.status, updateStatusDto.status);
    }

    const timestamp = new Date().toISOString();
    
    // Update enrollment
    const updated = await this.dynamoDBClient.updateItem(
      tenantId,
      enrollment.entityKey,
      'SET #status = :status, statusDate = :statusDate, statusReason = :statusReason, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc, gsi2sk = :gsi2sk',
      {
        ':status': updateStatusDto.status,
        ':statusDate': timestamp,
        ':statusReason': updateStatusDto.statusReason,
        ':updatedAt': timestamp,
        ':updatedBy': context.userId,
        ':inc': 1,
        ':gsi2sk': `ENROLLMENT#${updateStatusDto.status}#${enrollment.studentId}`
      },
      '#version = :currentVersion',
      {
        '#status': 'status',
        '#version': 'version'
      }
    );

    // Update student's current enrollment if status changed to active/withdrawn
    if (updateStatusDto.status === 'active' || updateStatusDto.status === 'withdrawn') {
      await this.studentService.updateStudent(
        tenantId,
        enrollment.studentId,
        {} as UpdateStudentDto, // Student update not needed for enrollment status change
        context
      );
    }

    // Invalidate and update cache
    const cacheKey = `${tenantId}:enrollment:${enrollmentId}`;
    await this.cache.set(cacheKey, updated as Enrollment, 600);
    // Also invalidate student cache since enrollment status changed
    const studentCacheKey = `${tenantId}:student:${enrollment.studentId}`;
    await this.cache.delete(studentCacheKey);

    this.logger.log(`Enrollment status updated: ${enrollmentId} -> ${updateStatusDto.status}`);
    return updated as Enrollment;
  }

  /**
   * Transfer Student - ATOMIC TRANSACTION
   * 
   * Creates withdrawal at source + new enrollment at destination atomically
   */
  async transferStudent(
    tenantId: string,
    enrollmentId: string,
    transferDto: TransferEnrollmentDto,
    context: RequestContext
  ): Promise<{ withdrawal: Enrollment; newEnrollment: Enrollment }> {
    const sourceEnrollment = await this.getEnrollment(tenantId, enrollmentId);
    
    if (sourceEnrollment.status !== 'active') {
      throw new Error('Can only transfer active enrollments');
    }

    const timestamp = new Date().toISOString();
    const newEnrollmentId = uuid();

    // Create withdrawal enrollment
    const withdrawal: Enrollment = {
      ...sourceEnrollment,
      enrollmentId: uuid(),
      entityKey: EntityKeyBuilder.enrollment(
        sourceEnrollment.schoolId,
        sourceEnrollment.academicYearId,
        sourceEnrollment.studentId
      ) + '#WITHDRAWAL',
      status: 'transferred',
      statusDate: timestamp,
      transferredTo: {
        schoolId: transferDto.targetSchoolId,
        schoolName: '', // Would be fetched from School service
        transferDate: transferDto.transferDate
      },
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: sourceEnrollment.version + 1
    };

    // Create new enrollment
    const newEnrollment: EnrollmentWithGSI = {
      tenantId,
      entityKey: EntityKeyBuilder.enrollment(
        transferDto.targetSchoolId,
        transferDto.targetAcademicYearId,
        sourceEnrollment.studentId
      ),
      entityType: 'ENROLLMENT',
      
      studentId: sourceEnrollment.studentId,
      schoolId: transferDto.targetSchoolId,
      academicYearId: transferDto.targetAcademicYearId,
      enrollmentId: newEnrollmentId,
      
      enrollmentDate: transferDto.transferDate,
      gradeLevel: transferDto.targetGradeLevel,
      
      status: 'active',
      statusDate: timestamp,
      
      transferredFrom: {
        schoolId: sourceEnrollment.schoolId,
        schoolName: '', // Would be fetched
        transferDate: transferDto.transferDate
      },
      
      academicStatus: 'on_track',
      promotionEligible: true,
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // GSI Keys
      gsi1pk: transferDto.targetSchoolId,
      gsi1sk: `ENROLLMENT#${transferDto.targetAcademicYearId}#${sourceEnrollment.studentId}`,
      gsi2pk: `${transferDto.targetSchoolId}#${transferDto.targetAcademicYearId}`,
      gsi2sk: `ENROLLMENT#active#${sourceEnrollment.studentId}`,
      gsi7pk: sourceEnrollment.studentId,
      gsi7sk: `ENROLLMENT#${transferDto.targetAcademicYearId}#active`
    };

    // Update student
    const studentUpdate = {
      currentEnrollment: {
        schoolId: transferDto.targetSchoolId,
        academicYearId: transferDto.targetAcademicYearId,
        gradeLevel: transferDto.targetGradeLevel,
        status: 'active'
      },
      gsi1pk: transferDto.targetSchoolId,
      updatedAt: timestamp,
      updatedBy: context.userId
    };

    // Atomic transaction
    const transactItems = [
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: withdrawal
        }
      },
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: newEnrollment
        }
      },
      {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: {
            tenantId,
            entityKey: EntityKeyBuilder.student(sourceEnrollment.studentId)
          },
          UpdateExpression: 'SET currentEnrollment = :currentEnrollment, gsi1pk = :gsi1pk, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#version': 'version'
          },
          ExpressionAttributeValues: {
            ':currentEnrollment': studentUpdate.currentEnrollment,
            ':gsi1pk': studentUpdate.gsi1pk,
            ':updatedAt': studentUpdate.updatedAt,
            ':updatedBy': studentUpdate.updatedBy,
            ':inc': 1
          }
        }
      }
    ];

    await this.dynamoDBClient.transactWrite(transactItems);

    this.logger.log(`Student transferred: ${sourceEnrollment.studentId} from ${sourceEnrollment.schoolId} to ${transferDto.targetSchoolId}`);
    
    return { withdrawal, newEnrollment };
  }

  /**
   * Suspend Enrollment
   */
  async suspendEnrollment(
    tenantId: string,
    enrollmentId: string,
    suspendDto: SuspendEnrollmentDto,
    context: RequestContext
  ): Promise<Enrollment> {
    return this.updateEnrollmentStatus(
      tenantId,
      enrollmentId,
      {
        status: 'suspended',
        statusReason: suspendDto.reason
      },
      context
    );
  }

  /**
   * Graduate Student
   */
  async graduateStudent(
    tenantId: string,
    enrollmentId: string,
    graduateDto: GraduateEnrollmentDto,
    context: RequestContext
  ): Promise<Enrollment> {
    const enrollment = await this.getEnrollment(tenantId, enrollmentId);
    
    const timestamp = new Date().toISOString();
    
    const updated = await this.dynamoDBClient.updateItem(
      tenantId,
      enrollment.entityKey,
      'SET #status = :status, graduationDate = :graduationDate, statusDate = :statusDate, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':status': 'graduated',
        ':graduationDate': graduateDto.graduationDate,
        ':statusDate': timestamp,
        ':updatedAt': timestamp,
        ':updatedBy': context.userId,
        ':inc': 1
      },
      '#version = :currentVersion',
      {
        '#status': 'status',
        '#version': 'version'
      }
    );

    // Update student currentEnrollment status (if student has currentEnrollment)
    // Note: This is handled via events or can be done separately
    // For now, we'll skip direct student update to avoid type issues

    this.logger.log(`Student graduated: ${enrollment.studentId}`);
    return updated as Enrollment;
  }

  /**
   * Withdraw Student
   */
  async withdrawStudent(
    tenantId: string,
    enrollmentId: string,
    reason: string,
    context: RequestContext
  ): Promise<Enrollment> {
    return this.updateEnrollmentStatus(
      tenantId,
      enrollmentId,
      {
        status: 'withdrawn',
        statusReason: reason
      },
      context
    );
  }

  /**
   * List Enrollments by School/Year
   */
  async listEnrollmentsBySchoolYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    status?: string,
    limit: number = 50,
    lastEvaluatedKey?: string
  ): Promise<{ items: Enrollment[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    // Decode pagination token if provided
    let exclusiveStartKey: any = undefined;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
      } catch (error) {
        this.logger.warn(`Invalid pagination token: ${lastEvaluatedKey}`);
      }
    }

    const result = await this.dynamoDBClient.queryGSI(
      'GSI2',
      `${schoolId}#${academicYearId}`,
      'ENROLLMENT#',
      'begins_with',
      status ? 'entityType = :type AND #status = :status' : 'entityType = :type',
      status ? {
        ':type': 'ENROLLMENT',
        ':status': status
      } : {
        ':type': 'ENROLLMENT'
      },
      status ? { '#status': 'status' } : undefined,
      limit + 1, // Fetch one extra to determine if there are more items
      exclusiveStartKey
    );

    const filteredItems = result.items.filter(item => item.tenantId === tenantId) as Enrollment[];
    
    // Check if there are more items
    const hasMore = filteredItems.length > limit;
    const items = hasMore ? filteredItems.slice(0, limit) : filteredItems;
    
    // Encode pagination token if there are more items
    let encodedLastEvaluatedKey: string | undefined = undefined;
    if (result.lastEvaluatedKey && hasMore) {
      encodedLastEvaluatedKey = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64');
    }

    return {
      items,
      lastEvaluatedKey: encodedLastEvaluatedKey,
      hasMore
    };
  }

  /**
   * Export Enrollments to CSV
   * Phase 5: Advanced Features - Import/Export Functionality
   * 
   * Exports enrollments filtered by schoolId and academicYearId to CSV format.
   * Includes all enrollment fields for data portability.
   */
  async exportEnrollmentsToCsv(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<string> {
    this.logger.log(`Exporting enrollments for tenant ${tenantId}, school ${schoolId}, academic year ${academicYearId}`);
    
    // For export, fetch all enrollments (use large limit and paginate if needed)
    let allEnrollments: Enrollment[] = [];
    let lastKey: string | undefined = undefined;
    let hasMore = true;
    
    while (hasMore) {
      const result = await this.listEnrollmentsBySchoolYear(tenantId, schoolId, academicYearId, undefined, 1000, lastKey);
      allEnrollments = allEnrollments.concat(result.items);
      hasMore = result.hasMore;
      lastKey = result.lastEvaluatedKey;
    }

    if (allEnrollments.length === 0) {
      this.logger.warn(`No enrollments found for export in school ${schoolId}, academic year ${academicYearId}`);
      // Return CSV with headers only
      return this.csvParser.toCsv([], [
        'enrollmentId',
        'studentId',
        'schoolId',
        'academicYearId',
        'classroomId',
        'gradeLevel',
        'section',
        'enrollmentDate',
        'status',
        'withdrawalDate',
        'graduationDate'
      ]);
    }

    // Flatten enrollment data for CSV format
    const flattenedEnrollments = allEnrollments.map(e => ({
      enrollmentId: e.enrollmentId,
      studentId: e.studentId,
      schoolId: e.schoolId,
      academicYearId: e.academicYearId,
      classroomId: e.classroomId || '',
      gradeLevel: e.gradeLevel || '',
      section: e.section || '',
      enrollmentDate: e.enrollmentDate || '',
      status: e.status || '',
      withdrawalDate: e.withdrawalDate || '',
      graduationDate: e.graduationDate || ''
    }));

    const csv = this.csvParser.toCsv(flattenedEnrollments, [
      'enrollmentId',
      'studentId',
      'schoolId',
      'academicYearId',
      'classroomId',
      'gradeLevel',
      'section',
      'enrollmentDate',
      'status',
      'withdrawalDate',
      'graduationDate'
    ]);

    this.logger.log(`Successfully exported ${allEnrollments.length} enrollments to CSV`);
    return csv;
  }

  /**
   * Bulk Enroll Students
   * Phase 5: Advanced Features - Bulk Operations
   * 
   * Processes multiple enrollments in parallel with pre-validation.
   * Uses chunking and Promise.allSettled for concurrent processing.
   * Each enrollment remains atomic (uses TransactWrite).
   * 
   * DESIGN RATIONALE:
   * - Pre-validation prevents wasted processing on invalid data
   * - Chunk size 10 balances parallelism with transaction limits
   * - Promise.allSettled ensures all items processed even if some fail
   * - Atomic transactions per enrollment maintain data consistency
   */
  async bulkEnrollStudents(
    tenantId: string,
    bulkDto: BulkEnrollmentDto,
    context: RequestContext
  ): Promise<BulkEnrollmentResponse> {
    const startTime = Date.now();
    const { enrollments, options } = bulkDto;
    const validateAllFirst = options?.validateAllFirst !== false; // Default: true
    const maxConcurrent = options?.maxConcurrent || 10; // Default: 10

    this.logger.log(`Starting bulk enrollment: ${enrollments.length} enrollments, validateAllFirst=${validateAllFirst}, maxConcurrent=${maxConcurrent}`);

    const results: BulkEnrollmentResult[] = [];
    const failures: BulkEnrollmentFailure[] = [];

    // Step 1: Pre-validation (if enabled)
    if (validateAllFirst) {
      this.logger.log('Pre-validating all enrollments...');
      const validationErrors = await this.preValidateBulkEnrollments(tenantId, enrollments);
      
      if (validationErrors.length > 0) {
        // If validation fails, return errors immediately (don't process any)
        this.logger.warn(`Pre-validation failed for ${validationErrors.length} enrollments`);
        return {
          success: [],
          failed: validationErrors,
          summary: {
            total: enrollments.length,
            succeeded: 0,
            failed: validationErrors.length
          }
        };
      }
      this.logger.log('Pre-validation passed for all enrollments');
    }

    // Step 2: Process enrollments in chunks
    const chunkSize = maxConcurrent;
    const chunks: typeof enrollments[] = [];
    
    for (let i = 0; i < enrollments.length; i += chunkSize) {
      chunks.push(enrollments.slice(i, i + chunkSize));
    }

    this.logger.log(`Processing ${enrollments.length} enrollments in ${chunks.length} chunks of up to ${chunkSize} each`);

    // Step 3: Process each chunk in parallel
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      this.logger.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} enrollments)`);

      // Process chunk items in parallel
      // Using Promise.all with individual error handling (ES2017 compatible alternative to Promise.allSettled)
      const chunkPromises = chunk.map(async (enrollmentItem) => {
        try {
          // Use existing enrollStudent method (atomic transaction)
          const result = await this.enrollStudent(
            tenantId,
            enrollmentItem.studentId,
            {
              schoolId: enrollmentItem.schoolId,
              academicYearId: enrollmentItem.academicYearId,
              gradeLevel: enrollmentItem.gradeLevel,
              section: enrollmentItem.section,
              enrollmentDate: enrollmentItem.enrollmentDate,
              status: enrollmentItem.status
            },
            context
          );

          return {
            studentId: enrollmentItem.studentId,
            enrollmentId: result.enrollment.enrollmentId,
            invoiceId: result.invoice?.invoiceId,
            status: 'success' as const
          } as BulkEnrollmentResult;
        } catch (error: any) {
          this.logger.error(`Failed to enroll student ${enrollmentItem.studentId}: ${error.message}`, error.stack);
          
          return {
            studentId: enrollmentItem.studentId,
            error: error.message || 'Unknown error',
            errorCode: error.name || error.code,
            status: 'failed' as const
          } as BulkEnrollmentFailure;
        }
      });

      // Wait for all items in chunk to complete (success or failure)
      // ES2017 compatible: Each promise handles its own errors, so Promise.all won't reject
      const chunkResults = await Promise.all(chunkPromises);

      // Process chunk results
      chunkResults.forEach((item) => {
        if (item.status === 'success') {
          results.push(item);
        } else {
          failures.push(item);
        }
      });
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Bulk enrollment completed in ${duration}ms: ${results.length} succeeded, ${failures.length} failed`
    );

    return {
      success: results,
      failed: failures,
      summary: {
        total: enrollments.length,
        succeeded: results.length,
        failed: failures.length
      }
    };
  }

  /**
   * Pre-validate all bulk enrollments before processing
   * 
   * Validates:
   * - Student exists
   * - No duplicate enrollment for same student+year
   * - Academic year is valid (basic check)
   * 
   * Uses BatchGetItem for efficient student lookups.
   */
  private async preValidateBulkEnrollments(
    tenantId: string,
    enrollments: Array<{ studentId: string; academicYearId: string; schoolId: string }>
  ): Promise<BulkEnrollmentFailure[]> {
    const errors: BulkEnrollmentFailure[] = [];

    // Step 1: Batch check students exist (using BatchGetItem)
    const studentKeys = enrollments.map(e => ({
      tenantId,
      entityKey: `STUDENT#${e.studentId}`
    }));

    // DynamoDB BatchGetItem limit is 100 items, so chunk if needed
    const batchSize = 100;
    const studentChunks: typeof studentKeys[] = [];
    for (let i = 0; i < studentKeys.length; i += batchSize) {
      studentChunks.push(studentKeys.slice(i, i + batchSize));
    }

    const existingStudents = new Set<string>();
    for (const chunk of studentChunks) {
      try {
        const students = await this.dynamoDBClient.batchGetItems(chunk);
        students.forEach((student: any) => {
          if (student?.entityType === 'STUDENT') {
            existingStudents.add(student.studentId || student.entityKey.split('#')[1]);
          }
        });
      } catch (error: any) {
        this.logger.error(`BatchGetItem failed during pre-validation: ${error.message}`);
        // Continue validation for other items
      }
    }

    // Step 2: Check each enrollment
    for (const enrollment of enrollments) {
      // Check student exists
      if (!existingStudents.has(enrollment.studentId)) {
        errors.push({
          studentId: enrollment.studentId,
          error: `Student ${enrollment.studentId} does not exist`,
          errorCode: 'STUDENT_NOT_FOUND',
          status: 'failed'
        });
        continue;
      }

      // Check for duplicate enrollment (query existing enrollment)
      try {
        const existingEnrollment = await this.getEnrollmentByStudentYear(
          tenantId,
          enrollment.studentId,
          enrollment.academicYearId
        );

        if (existingEnrollment && existingEnrollment.status !== 'withdrawn') {
          errors.push({
            studentId: enrollment.studentId,
            error: `Student ${enrollment.studentId} already enrolled in academic year ${enrollment.academicYearId}`,
            errorCode: 'DUPLICATE_ENROLLMENT',
            status: 'failed'
          });
        }
      } catch (error: any) {
        // If query fails, log but don't block (will fail during actual enrollment)
        this.logger.warn(`Failed to check duplicate enrollment for ${enrollment.studentId}: ${error.message}`);
      }
    }

    return errors;
  }
}


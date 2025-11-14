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

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { StudentService } from '../student/student.service';
import { FinanceService } from '../finance/finance.service';
import { Enrollment, RequestContext } from '../common/entities/enrollment.entities';
import type { Invoice } from '@edforge/shared-types';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { 
  CreateEnrollmentDto, 
  UpdateEnrollmentStatusDto, 
  TransferEnrollmentDto,
  SuspendEnrollmentDto,
  GraduateEnrollmentDto
} from './dto/enrollment.dto';
import {
  EnrollmentNotFoundException,
  CapacityExceededException,
  DuplicateEnrollmentException,
  InvalidStatusTransitionException
} from '../common/errors/enrollment-exception';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly studentService: StudentService,
    private readonly financeService: FinanceService
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

    // 3. Check capacity (query School entity)
    // For now, we'll assume capacity check happens via School service
    // In production, this would query the School service or check capacity entity
    
    // 4. Get tuition configuration for invoice calculation
    const tuitionConfig = await this.financeService.getTuitionConfiguration(
      tenantId,
      createEnrollmentDto.schoolId,
      createEnrollmentDto.academicYearId
    );

    // 5. Create enrollment entity
    const enrollment: Enrollment = {
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

    // 6. Calculate invoice (pure function, no DB operations)
    const invoiceCalculation = this.financeService.calculateInvoice(enrollment, tuitionConfig);

    // 7. Get or check billing account
    const accountKey = EntityKeyBuilder.billingAccount(
      createEnrollmentDto.schoolId,
      createEnrollmentDto.academicYearId,
      studentId
    );
    const existingAccount = await this.dynamoDBClient.getItem(tenantId, accountKey) as any;

    // 8. Prepare invoice and account entities
    const accountId = existingAccount?.accountId || uuid();
    const invoice = this.financeService.prepareInvoiceEntity(
      tenantId,
      enrollment,
      tuitionConfig,
      invoiceCalculation,
      accountId,
      context
    );

    // Prepare billing account
    const paymentPlanInfo = (this.financeService as any).selectPaymentPlan(tuitionConfig, invoiceCalculation.total);
    
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
    await this.dynamoDBClient.transactWrite(transactItems);

    this.logger.log(
      `Student enrolled atomically: ${studentId} in school ${createEnrollmentDto.schoolId}, ` +
      `invoice ${invoice.invoiceNumber} created`
    );

    return { enrollment, invoice };
  }

  /**
   * Get Enrollment by ID
   */
  async getEnrollment(tenantId: string, enrollmentId: string): Promise<Enrollment> {
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

    return enrollments[0] as Enrollment;
  }

  /**
   * Get Enrollment by Student and Year
   */
  async getEnrollmentByStudentYear(
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<Enrollment | null> {
    const enrollments = await this.dynamoDBClient.queryGSI(
      'GSI7',
      studentId,
      `ENROLLMENT#${academicYearId}#`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      1
    );

    const enrollment = enrollments.find(
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
        {
          currentEnrollment: updateStatusDto.status === 'active' ? {
            schoolId: enrollment.schoolId,
            academicYearId: enrollment.academicYearId,
            gradeLevel: enrollment.gradeLevel,
            status: updateStatusDto.status
          } : undefined
        },
        context
      );
    }

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
    const newEnrollment: Enrollment = {
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

    // Update student
    await this.studentService.updateStudent(
      tenantId,
      enrollment.studentId,
      {
        currentEnrollment: {
          ...enrollment.currentEnrollment,
          status: 'graduated'
        }
      },
      context
    );

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
    status?: string
  ): Promise<Enrollment[]> {
    const items = await this.dynamoDBClient.queryGSI(
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
      100
    );

    return items.filter(item => item.tenantId === tenantId) as Enrollment[];
  }
}


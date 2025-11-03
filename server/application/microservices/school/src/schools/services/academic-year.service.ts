/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Academic Year Service - Temporal boundary management
 * 
 * ARCHITECTURE RATIONALE:
 * Academic years define temporal boundaries for ALL academic operations.
 * This service enforces critical business rules:
 * 1. Only ONE academic year can be current per school
 * 2. Year transitions are atomic (use DynamoDB transactions)
 * 3. Historical data preserved (completed years immutable)
 * 4. Events published for downstream services (Student, Academic, Finance)
 * 
 * TEMPORAL BOUNDARIES:
 * - Enrollment: Students enrolled in specific academic year
 * - Grading: Grades tied to academic year + grading period
 * - Attendance: Tracked within academic year context
 * - Budgets: Department budgets per academic year
 * - Reporting: Year-end reports, transcripts
 */

import { Injectable, HttpException, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ClientFactoryService } from '@app/client-factory';
import { v4 as uuid } from 'uuid';
import {
  AcademicYear,
  GradingPeriod,
  Holiday,
  EntityKeyBuilder,
  RequestContext
} from '../entities/school.entity.enhanced';
import { ValidationService } from './validation.service';
import { EventService } from './event.service';
@Injectable()
export class AcademicYearService {
  constructor(
    private readonly clientFac: ClientFactoryService,
    private readonly validationService: ValidationService,
    private readonly eventService: EventService
  ) {}
  
  private tableName: string = process.env.TABLE_NAME || 'SCHOOL_TABLE_NAME';

  /**
   * Create Academic Year
   * 
   * BUSINESS LOGIC:
   * 1. Validate dates and structure
   * 2. If isCurrent=true, set all other years to isCurrent=false (transaction)
   * 3. Generate grading periods if provided
   * 4. Publish AcademicYearCreated event
   */
  async createAcademicYear(
    tenantId: string,
    schoolId: string,
    data: any,
    context: RequestContext
  ): Promise<AcademicYear> {
    // Validate input
    await this.validationService.validateAcademicYearCreation(
      tenantId,
      schoolId,
      data,
      context.jwtToken
    );

    const academicYearId = uuid();
    const timestamp = new Date().toISOString();

    // Build academic year entity
    const academicYear: AcademicYear = {
      // Keys
      tenantId,
      entityKey: EntityKeyBuilder.academicYear(schoolId, academicYearId),
      
      // Relationships
      schoolId,
      academicYearId,
      
      // Identity
      yearName: data.yearName,
      yearCode: data.yearCode || this.generateYearCode(data.yearName),
      
      // Temporal
      startDate: data.startDate,
      endDate: data.endDate,
      
      // Status
      status: data.status || 'planned',
      isCurrent: data.isCurrent === true, // Only true if explicitly set to true
      
      // Structure
      structure: {
        semesterCount: data.structure?.semesterCount || 2,
        gradingPeriodCount: data.structure?.gradingPeriodCount || 4,
        instructionalDays: data.structure?.instructionalDays || 180,
        schoolDays: data.structure?.schoolDays || data.structure?.instructionalDays || 180
      },
      
      // Optional
      tuitionRates: data.tuitionRates,
      enrollmentTargets: data.enrollmentTargets,
      
      // Audit
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // DynamoDB metadata
      entityType: 'ACADEMIC_YEAR',
      
      // GSI keys
      gsi1pk: schoolId,
      gsi1sk: `YEAR#${academicYearId}`,
      gsi2pk: `${schoolId}#${academicYearId}`
    };

    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    // ALWAYS save the academic year first
    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: academicYear
    }));

    // If this year should be current, enforce "only one current" rule
    // This must happen AFTER saving because setAsCurrentYear needs to read the record
    if (academicYear.isCurrent) {
      await this.setAsCurrentYear(tenantId, schoolId, academicYearId, context);
    }

    //Publish AcademicYearCreated event to EventBridge
    await this.eventService.publishEvent({
      eventType: 'AcademicYearCreated',
      tenantId,
      schoolId,
      academicYearId,
      yearName: academicYear.yearName,
      startDate: academicYear.startDate,
      endDate: academicYear.endDate,
      timestamp
    });

    console.log(`Academic year created: ${academicYear.yearName} for school ${schoolId}`);

    return academicYear;
  }

  /**
   * Get all academic years for a school
   * 
   * ACCESS PATTERN: GSI1
   * - Query: gsi1pk=schoolId, gsi1sk begins_with YEAR#
   * - Sorted by yearId (can add sorting by startDate in application)
   */
  async getAcademicYears(
    tenantId: string,
    schoolId: string,
    jwtToken: string
  ): Promise<AcademicYear[]> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :schoolId AND begins_with(gsi1sk, :prefix)',
      ExpressionAttributeValues: {
        ':schoolId': schoolId,
        ':prefix': 'YEAR#'
      }
    }));

    const years = (result.Items || []) as AcademicYear[];
    
    // Sort by start date (most recent first)
    return years.sort((a, b) => 
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );
  }

  /**
   * Get current academic year for school
   * 
   * BUSINESS RULE: Only ONE year can be current
   * CACHING: This should be cached for 24 hours (rarely changes)
   * 
   * ACCESS PATTERN: GSI1 with filter
   */
  async getCurrentAcademicYear(
    tenantId: string,
    schoolId: string,
    jwtToken: string
  ): Promise<AcademicYear | null> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :schoolId AND begins_with(gsi1sk, :prefix)',
      FilterExpression: 'isCurrent = :current AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':schoolId': schoolId,
        ':prefix': 'YEAR#',
        ':current': true,
        ':status': 'active'
      }
    }));

    return (result.Items?.[0] as AcademicYear) || null;
  }

  /**
   * Get academic year by ID
   */
  async getAcademicYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<AcademicYear> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'tenantId = :tenantId AND entityKey = :entityKey',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':entityKey': EntityKeyBuilder.academicYear(schoolId, academicYearId)
      }
    }));

    if (!result.Items || result.Items.length === 0) {
      throw new NotFoundException('Academic year not found');
    }

    return result.Items[0] as AcademicYear;
  }

  /**
   * Set academic year as current
   * 
   * CRITICAL BUSINESS RULE: Only ONE year can be current per school
   * 
   * IMPLEMENTATION:
   * - Use DynamoDB transaction for atomicity
   * - Set all other years to isCurrent=false
   * - Set target year to isCurrent=true
   * - Update version for optimistic locking
   * 
   * RATIONALE: Transaction ensures consistency even with concurrent requests
   */
  async setAsCurrentYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    // Get target year to validate
    const targetYear = await this.getAcademicYear(tenantId, schoolId, academicYearId, context.jwtToken);

    if (targetYear.status === 'archived') {
      throw new BadRequestException('Cannot set archived year as current');
    }

    // Get all academic years for this school
    const allYears = await this.getAcademicYears(tenantId, schoolId, context.jwtToken);

    // Build transaction items
    const transactItems: any[] = [];
    const timestamp = new Date().toISOString();

    for (const year of allYears) {
      const isCurrent = year.academicYearId === academicYearId;
      
      // Only update if isCurrent status is changing
      if (year.isCurrent !== isCurrent) {
        transactItems.push({
          Update: {
            TableName: this.tableName,
            Key: {
              tenantId,
              entityKey: year.entityKey
            },
            UpdateExpression: 'SET isCurrent = :current, updatedAt = :now, updatedBy = :userId, #version = #version + :inc',
            ExpressionAttributeNames: {
              '#version': 'version'
            },
            ExpressionAttributeValues: {
              ':current': isCurrent,
              ':now': timestamp,
              ':userId': context.userId,
              ':inc': 1
            }
          }
        });
      }
    }

    // Execute transaction if there are changes
    if (transactItems.length > 0) {
      await client.send(new TransactWriteCommand({
        TransactItems: transactItems
      }));

      console.log(`Set academic year ${targetYear.yearName} as current for school ${schoolId}`);

      // TODO: Publish CurrentAcademicYearChanged event
      await this.eventService.publishEvent({
        eventType: 'CurrentAcademicYearChanged',
        tenantId,
        schoolId,
        previousYearId: allYears.find(y => y.isCurrent && y.academicYearId !== academicYearId)?.academicYearId,
        newYearId: academicYearId,
        yearName: targetYear.yearName,
        timestamp
      });
    }
  }

  /**
   * Update academic year status
   * 
   * STATUS TRANSITIONS:
   * - planned → active (year started)
   * - active → completed (year ended)
   * - completed → archived (historical data)
   * 
   * VALIDATION:
   * - Cannot modify dates if status is completed or archived
   * - Cannot skip statuses (must go in order)
   */
  async updateAcademicYearStatus(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    newStatus: 'planned' | 'active' | 'completed' | 'archived',
    context: RequestContext
  ): Promise<AcademicYear> {
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    // Get current year
    const year = await this.getAcademicYear(tenantId, schoolId, academicYearId, context.jwtToken);

    // Validate status transition
    this.validateStatusTransition(year.status, newStatus);

    const timestamp = new Date().toISOString();

    // If transitioning to active, optionally set as current
    if (newStatus === 'active' && !year.isCurrent) {
      // Ask if this should be current year
      // For now, auto-set as current when activated
      await this.setAsCurrentYear(tenantId, schoolId, academicYearId, context);
    }

    // Update status
    const result = await client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: {
        tenantId,
        entityKey: year.entityKey
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :now, updatedBy = :userId, #version = #version + :inc',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#version': 'version'
      },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':now': timestamp,
        ':userId': context.userId,
        ':inc': 1
      },
      ReturnValues: 'ALL_NEW'
    }));

    console.log(`Academic year ${year.yearName} status changed: ${year.status} → ${newStatus}`);

    // Publish event based on status
    if (newStatus === 'active') {
      await this.eventService.publishEvent({ 
        eventType: 'AcademicYearStarted',
        tenantId,
        schoolId,
        academicYearId,
        yearName: year.yearName,
        startDate: year.startDate,
        endDate: year.endDate,
        timestamp: new Date().toISOString()
      });
    } else if (newStatus === 'completed') {
      await this.eventService.publishEvent({ 
        eventType: 'AcademicYearEnded',
        tenantId,
        schoolId,
        academicYearId,
        yearName: year.yearName,
        timestamp: new Date().toISOString()
      });
    }

    return result.Attributes as AcademicYear;
  }

  /**
   * Create grading period
   * 
   * BUSINESS RULES:
   * - Must be within academic year boundaries
   * - Cannot overlap with existing periods
   * - Ordered by periodNumber
   */
  async createGradingPeriod(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    data: any,
    context: RequestContext
  ): Promise<GradingPeriod> {
    // Get academic year
    const academicYear = await this.getAcademicYear(tenantId, schoolId, academicYearId, context.jwtToken);

    // Get existing periods
    const existingPeriods = await this.getGradingPeriods(tenantId, schoolId, academicYearId, context.jwtToken);

    // Validate
    await this.validationService.validateGradingPeriod(
      tenantId,
      schoolId,
      academicYearId,
      data,
      existingPeriods,
      academicYear,
      context.jwtToken
    );

    const gradingPeriodId = uuid();
    const timestamp = new Date().toISOString();

    const gradingPeriod: GradingPeriod = {
      tenantId,
      entityKey: EntityKeyBuilder.gradingPeriod(schoolId, academicYearId, gradingPeriodId),
      
      schoolId,
      academicYearId,
      gradingPeriodId,
      
      periodName: data.periodName,
      periodType: data.periodType,
      periodNumber: data.periodNumber,
      
      startDate: data.startDate,
      endDate: data.endDate,
      
      status: data.status || 'planned',
      isCurrent: data.isCurrent || false,
      
      instructionalDays: data.instructionalDays || this.calculateInstructionalDays(data.startDate, data.endDate),
      gradesDueDate: data.gradesDueDate,
      reportCardDate: data.reportCardDate,
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      entityType: 'GRADING_PERIOD',
      gsi2pk: `${schoolId}#${academicYearId}`,
      gsi2sk: `PERIOD#${data.periodNumber.toString().padStart(2, '0')}`
    };

    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: gradingPeriod
    }));

    console.log(`Grading period created: ${gradingPeriod.periodName} for year ${academicYear.yearName}`);

    return gradingPeriod;
  }

  /**
   * Get grading periods for academic year
   * 
   * ACCESS PATTERN: GSI2
   * - Query: gsi2pk=schoolId#academicYearId, gsi2sk begins_with PERIOD#
   */
  async getGradingPeriods(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<GradingPeriod[]> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'gsi2pk = :yearKey AND begins_with(gsi2sk, :prefix)',
      ExpressionAttributeValues: {
        ':yearKey': `${schoolId}#${academicYearId}`,
        ':prefix': 'PERIOD#'
      }
    }));

    return (result.Items || []) as GradingPeriod[];
  }

  /**
   * Create holiday/closure
   */
  async createHoliday(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    data: any,
    context: RequestContext
  ): Promise<Holiday> {
    // Get academic year to validate
    const academicYear = await this.getAcademicYear(tenantId, schoolId, academicYearId, context.jwtToken);

    // Validate dates are within year
    const yearStart = new Date(academicYear.startDate);
    const yearEnd = new Date(academicYear.endDate);
    const holidayStart = new Date(data.startDate);
    const holidayEnd = new Date(data.endDate);

    if (holidayStart < yearStart || holidayEnd > yearEnd) {
      throw new BadRequestException('Holiday dates must be within academic year boundaries');
    }

    const holidayId = uuid();
    const timestamp = new Date().toISOString();

    const holiday: Holiday = {
      tenantId,
      entityKey: EntityKeyBuilder.holiday(schoolId, academicYearId, holidayId),
      
      schoolId,
      academicYearId,
      holidayId,
      
      name: data.name,
      type: data.type || 'holiday',
      
      startDate: data.startDate,
      endDate: data.endDate,
      allDay: data.allDay !== undefined ? data.allDay : true,
      
      description: data.description,
      isRecurring: data.isRecurring || false,
      recurrencePattern: data.recurrencePattern,
      
      affectsAttendance: data.affectsAttendance !== undefined ? data.affectsAttendance : true,
      affectsPayroll: data.affectsPayroll !== undefined ? data.affectsPayroll : true,
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      entityType: 'HOLIDAY',
      gsi2pk: `${schoolId}#${academicYearId}`,
      gsi2sk: `HOLIDAY#${data.startDate}`
    };

    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: holiday
    }));

    console.log(`Holiday created: ${holiday.name} for year ${academicYear.yearName}`);

    return holiday;
  }

  /**
   * Get holidays for academic year
   */
  async getHolidays(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<Holiday[]> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'gsi2pk = :yearKey AND begins_with(gsi2sk, :prefix)',
      ExpressionAttributeValues: {
        ':yearKey': `${schoolId}#${academicYearId}`,
        ':prefix': 'HOLIDAY#'
      }
    }));

    return (result.Items || []) as Holiday[];
  }

  // ========================
  // Private Helper Methods
  // ========================

  /**
   * Generate year code from year name
   * Examples: "2024-2025" → "AY24", "Academic Year 2024" → "AY24"
   */
  private generateYearCode(yearName: string): string {
    const match = yearName.match(/\d{4}/);
    if (match) {
      const year = match[0].substring(2); // Get last 2 digits
      return `AY${year}`;
    }
    return yearName.substring(0, 6).toUpperCase();
  }

  /**
   * Validate status transition
   * Allowed: planned → active → completed → archived
   */
  private validateStatusTransition(
    currentStatus: string,
    newStatus: string
  ): void {
    const transitions: Record<string, string[]> = {
      'planned': ['active'],
      'active': ['completed'],
      'completed': ['archived'],
      'archived': [] // Cannot transition from archived
    };

    if (!transitions[currentStatus]?.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition: ${currentStatus} → ${newStatus}`
      );
    }
  }

  /**
   * Update academic year
   * 
   * BUSINESS RULES:
   * - Validate all business rules via ValidationService
   * - Use optimistic locking to prevent concurrent updates
   * - Handle isCurrent changes via setAsCurrentYear if needed
   * - Preserve audit trail
   * 
   * IMPLEMENTATION:
   * - Validate update data
   * - Check optimistic locking (version)
   * - Update only provided fields
   * - Handle isCurrent changes separately
   * - Publish update event
   */
  async updateAcademicYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    data: any,
    context: RequestContext
  ): Promise<AcademicYear> {
    // Validate update data
    await this.validationService.validateAcademicYearUpdate(
      tenantId,
      schoolId,
      academicYearId,
      data,
      context.jwtToken
    );

    const client = await this.clientFac.getClient(tenantId, context.jwtToken);
    const timestamp = new Date().toISOString();

    // Get existing year for optimistic locking
    const existingYear = await this.getAcademicYear(tenantId, schoolId, academicYearId, context.jwtToken);
    if (!existingYear) {
      throw new BadRequestException('Academic year not found');
    }

    // Check optimistic locking
    if (data.version && data.version !== existingYear.version) {
      throw new BadRequestException('Academic year has been modified by another user. Please refresh and try again.');
    }

    // Build update expression dynamically
    const updateExpression: string[] = [];
    const expressionAttributeNames: { [key: string]: string } = {};
    const expressionAttributeValues: { [key: string]: any } = {};

    // Add updatedAt and updatedBy
    updateExpression.push('#updatedAt = :updatedAt');
    updateExpression.push('#updatedBy = :updatedBy');
    updateExpression.push('#version = :version');
    
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeNames['#updatedBy'] = 'updatedBy';
    expressionAttributeNames['#version'] = 'version';
    
    expressionAttributeValues[':updatedAt'] = timestamp;
    expressionAttributeValues[':updatedBy'] = context.userId;
    expressionAttributeValues[':version'] = existingYear.version + 1;

    // Handle each field update
    if (data.yearName !== undefined) {
      updateExpression.push('#yearName = :yearName');
      expressionAttributeNames['#yearName'] = 'yearName';
      expressionAttributeValues[':yearName'] = data.yearName;
    }

    if (data.yearCode !== undefined) {
      updateExpression.push('#yearCode = :yearCode');
      expressionAttributeNames['#yearCode'] = 'yearCode';
      expressionAttributeValues[':yearCode'] = data.yearCode;
    }

    if (data.startDate !== undefined) {
      updateExpression.push('#startDate = :startDate');
      expressionAttributeNames['#startDate'] = 'startDate';
      expressionAttributeValues[':startDate'] = data.startDate;
    }

    if (data.endDate !== undefined) {
      updateExpression.push('#endDate = :endDate');
      expressionAttributeNames['#endDate'] = 'endDate';
      expressionAttributeValues[':endDate'] = data.endDate;
    }

    if (data.status !== undefined) {
      updateExpression.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = data.status;
    }

    if (data.structure !== undefined) {
      updateExpression.push('#structure = :structure');
      expressionAttributeNames['#structure'] = 'structure';
      expressionAttributeValues[':structure'] = data.structure;
    }

    // Handle isCurrent changes separately (requires transaction)
    if (data.isCurrent !== undefined && data.isCurrent !== existingYear.isCurrent) {
      if (data.isCurrent) {
        // Set this year as current (will unset others)
        await this.setAsCurrentYear(tenantId, schoolId, academicYearId, context);
      } else {
        // Just unset this year's isCurrent flag
        updateExpression.push('#isCurrent = :isCurrent');
        expressionAttributeNames['#isCurrent'] = 'isCurrent';
        expressionAttributeValues[':isCurrent'] = false;
      }
    }

    // Add version condition for optimistic locking
    expressionAttributeValues[':currentVersion'] = existingYear.version;

    // Perform the update
    const updateCommand = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        tenantId,
        entityKey: EntityKeyBuilder.academicYear(schoolId, academicYearId)
      },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: '#version = :currentVersion', // Optimistic locking
      ReturnValues: 'ALL_NEW'
    });

    const result = await client.send(updateCommand);
    const updatedYear = result.Attributes as AcademicYear;

    // Publish AcademicYearUpdated event
    await this.eventService.publishEvent({
      eventType: 'AcademicYearUpdated' as const,
      tenantId,
      schoolId,
      academicYearId,
      yearName: updatedYear.yearName,
      changes: data,
      timestamp
    });

    console.log(`Academic year updated: ${updatedYear.yearName} for school ${schoolId}`);

    return updatedYear;
  }

  /**
   * Calculate instructional days between two dates
   * Excludes weekends (simple calculation)
   */
  private calculateInstructionalDays(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    let days = 0;
    const current = new Date(start);
    
    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Exclude Sunday (0) and Saturday (6)
        days++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  }
}


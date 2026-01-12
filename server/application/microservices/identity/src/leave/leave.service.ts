/**
 * Leave Service - Identity Service
 * 
 * Manages staff leave requests with approval workflow.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import {
  Leave,
  LeaveType,
  LeaveStatus,
  createLeaveEntity,
  LeaveKeyBuilder,
  calculateLeaveDays,
} from '../common/entities/leave.entity';
import {
  Staff,
  StaffKeyBuilder,
} from '../common/entities/staff.entity';
import {
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateLeaveRequestDto,
  UpdateLeaveRequestDto,
  LeaveRequestResponseDto,
  LeaveFilterDto,
  ApproveLeaveDto,
  RejectLeaveDto,
} from '@edforge/shared-types';

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
  ) {}

  // ============================================
  // Create Leave Request
  // ============================================

  async createLeaveRequest(
    staffId: string,
    createDto: CreateLeaveRequestDto,
    context: RequestContext
  ): Promise<LeaveRequestResponseDto> {
    const now = new Date().toISOString();
    const leaveId = uuid();

    // Verify staff exists
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    // Calculate total days
    const totalDays = calculateLeaveDays(
      createDto.startDate,
      createDto.endDate,
      createDto.durationType
    );

    const leave = createLeaveEntity(
      context.tenantId,
      staffId,
      leaveId,
      {
        staffId,
        staffName: `${staff.firstName} ${staff.lastSurname}`,
        schoolId: staff.primarySchoolId,
        leaveType: createDto.leaveType as LeaveType,
        startDate: createDto.startDate,
        endDate: createDto.endDate,
        durationType: createDto.durationType as any,
        hours: createDto.hours,
        totalDays,
        reason: createDto.reason,
        notes: createDto.notes,
        documentUrl: createDto.documentUrl,
        documentFileName: createDto.documentFileName,
        status: 'pending',
        substituteStaffId: createDto.substituteStaffId,
        coverageNotes: createDto.coverageNotes,
        emergencyContact: createDto.emergencyContact as any,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, leave);

    this.logger.log(`Leave request created: ${leaveId} for staff ${staffId}`);

    // Publish event
    this.eventsService.publishEvent({
      eventType: 'LeaveRequested',
      timestamp: now,
      tenantId: context.tenantId,
      leaveId,
      staffId,
      leaveType: createDto.leaveType,
      startDate: createDto.startDate,
      endDate: createDto.endDate,
      totalDays,
    }).catch(err => this.logger.error('Failed to publish LeaveRequested event', err));

    return this.toLeaveResponse(leave);
  }

  // ============================================
  // Get Leave Request
  // ============================================

  async getLeaveRequest(
    staffId: string,
    leaveId: string,
    context: RequestContext
  ): Promise<LeaveRequestResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const leave = await this.dynamoDBClient.getItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId)
    );

    if (!leave) {
      throw new NotFoundException('Leave request not found');
    }

    return this.toLeaveResponse(leave);
  }

  // ============================================
  // List Leave Requests for Staff
  // ============================================

  async listLeaveRequests(
    staffId: string,
    context: RequestContext,
    filter?: LeaveFilterDto
  ): Promise<PaginatedResult<LeaveRequestResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = filter?.limit || 20;

    const result = await this.dynamoDBClient.query<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leavesPrefix(staffId),
      'entityType = :entityType',
      { ':entityType': 'LEAVE' },
      undefined,
      limit
    );

    // Apply filters in memory
    let filtered = result.items;

    if (filter?.leaveType) {
      filtered = filtered.filter(l => l.leaveType === filter.leaveType);
    }

    if (filter?.status) {
      filtered = filtered.filter(l => l.status === filter.status);
    }

    return {
      items: filtered.map(l => this.toLeaveResponse(l)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Approve Leave Request
  // ============================================

  async approveLeaveRequest(
    staffId: string,
    leaveId: string,
    approveDto: ApproveLeaveDto,
    context: RequestContext
  ): Promise<LeaveRequestResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const leave = await this.dynamoDBClient.getItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId)
    );

    if (!leave) {
      throw new NotFoundException('Leave request not found');
    }

    if (leave.status !== 'pending') {
      throw new BadRequestException('Only pending leave requests can be approved');
    }

    const now = new Date().toISOString();

    const updatedLeave = await this.dynamoDBClient.updateItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId),
      'SET #status = :status, approvedBy = :approvedBy, approvedAt = :approvedAt, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':status': 'approved',
        ':approvedBy': context.userId,
        ':approvedAt': now,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#status': 'status', '#version': 'version' }
    );

    this.logger.log(`Leave approved: ${leaveId}`);

    // Publish event
    this.eventsService.publishEvent({
      eventType: 'LeaveApproved',
      timestamp: now,
      tenantId: context.tenantId,
      leaveId,
      staffId,
      approvedBy: context.userId,
    }).catch(err => this.logger.error('Failed to publish LeaveApproved event', err));

    return this.toLeaveResponse(updatedLeave);
  }

  // ============================================
  // Reject Leave Request
  // ============================================

  async rejectLeaveRequest(
    staffId: string,
    leaveId: string,
    rejectDto: RejectLeaveDto,
    context: RequestContext
  ): Promise<LeaveRequestResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const leave = await this.dynamoDBClient.getItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId)
    );

    if (!leave) {
      throw new NotFoundException('Leave request not found');
    }

    if (leave.status !== 'pending') {
      throw new BadRequestException('Only pending leave requests can be rejected');
    }

    const now = new Date().toISOString();

    const updatedLeave = await this.dynamoDBClient.updateItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId),
      'SET #status = :status, rejectionReason = :rejectionReason, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':status': 'rejected',
        ':rejectionReason': rejectDto.rejectionReason,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#status': 'status', '#version': 'version' }
    );

    this.logger.log(`Leave rejected: ${leaveId}`);

    return this.toLeaveResponse(updatedLeave);
  }

  // ============================================
  // Cancel Leave Request
  // ============================================

  async cancelLeaveRequest(
    staffId: string,
    leaveId: string,
    reason: string,
    context: RequestContext
  ): Promise<LeaveRequestResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const leave = await this.dynamoDBClient.getItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId)
    );

    if (!leave) {
      throw new NotFoundException('Leave request not found');
    }

    if (!['pending', 'approved'].includes(leave.status)) {
      throw new BadRequestException('Only pending or approved leave requests can be cancelled');
    }

    const now = new Date().toISOString();

    const updatedLeave = await this.dynamoDBClient.updateItem<Leave>(
      client,
      context.tenantId,
      LeaveKeyBuilder.leave(staffId, leaveId),
      'SET #status = :status, cancellationReason = :cancellationReason, cancelledAt = :cancelledAt, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':status': 'cancelled',
        ':cancellationReason': reason,
        ':cancelledAt': now,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#status': 'status', '#version': 'version' }
    );

    this.logger.log(`Leave cancelled: ${leaveId}`);

    return this.toLeaveResponse(updatedLeave);
  }

  // ============================================
  // Helper Methods
  // ============================================

  private toLeaveResponse(leave: Leave): LeaveRequestResponseDto {
    return {
      leaveId: leave.leaveId,
      staffId: leave.staffId,
      staffName: leave.staffName,
      tenantId: leave.tenantId,
      schoolId: leave.schoolId,
      schoolName: leave.schoolName,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      durationType: leave.durationType,
      hours: leave.hours,
      totalDays: leave.totalDays,
      totalHours: leave.totalHours,
      reason: leave.reason,
      notes: leave.notes,
      documentUrl: leave.documentUrl,
      status: leave.status,
      approvedBy: leave.approvedBy,
      approvedByName: leave.approvedByName,
      approvedAt: leave.approvedAt,
      rejectionReason: leave.rejectionReason,
      substituteStaffId: leave.substituteStaffId,
      substituteStaffName: leave.substituteStaffName,
      coverageNotes: leave.coverageNotes,
      emergencyContact: leave.emergencyContact,
      createdAt: leave.createdAt,
      updatedAt: leave.updatedAt,
    };
  }
}

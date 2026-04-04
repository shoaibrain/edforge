/**
 * Staff Controller - Identity Service
 * 
 * REST API endpoints for staff management.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  forwardRef,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { StaffService } from './staff.service';
import { StaffAssignmentService } from './staff-assignment.service';
import { StaffEmploymentHistoryService } from './staff-employment-history.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities/base.entity';
import {
  CreateStaffDtoZ,
  UpdateStaffDtoZ,
  UpdateEmploymentStatusDtoZ,
  StaffFilterDtoZ,
  CreateStaffAssignmentDtoZ,
  UpdateStaffAssignmentDtoZ,
  CreateStaffWithUserDtoZ,
} from '../common/dto/zod-dtos';
import type {
  StaffResponseDto,
  StaffListResponseDto,
  StaffAssignmentResponseDto,
  StaffAssignmentListResponseDto,
  EmploymentHistoryListResponseDto,
  StaffWithUserResponseDto,
} from '@aibrains/shared-types';

@Controller('staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  private readonly logger = new Logger(StaffController.name);

  constructor(
    private readonly staffService: StaffService,
    private readonly employmentHistoryService: StaffEmploymentHistoryService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  // ============================================
  // Create Staff
  // ============================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Body() createDto: CreateStaffDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.createStaff(createDto, context);
  }

  // ============================================
  // Atomic Staff + User Creation
  // ============================================

  @Post('with-user')
  @HttpCode(HttpStatus.CREATED)
  async createStaffWithUser(
    @Body() createDto: CreateStaffWithUserDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffWithUserResponseDto> {
    const context = this.buildContext(tenant, req);

    if (!createDto.createUserAccount) {
      // Just create staff without a user account
      const staff = await this.staffService.createStaff(createDto, context);
      return { staff, userCreated: false };
    }

    try {
      // Delegate to UsersService which handles Cognito + DynamoDB + Staff atomically
      const userResponse = await this.usersService.createUser(
        {
          email: createDto.email,
          firstName: createDto.firstName,
          lastName: createDto.lastSurname,
          globalRole: createDto.globalRole,
          temporaryPassword: createDto.temporaryPassword,
          schoolId: createDto.primarySchoolId,
          staffRole: createDto.role,
          departmentId: createDto.departmentId,
        },
        context
      );

      // Fetch the staff record that was auto-created
      const staffByEmail = await this.staffService.getStaffByEmail(createDto.email, context);

      if (staffByEmail) {
        return {
          staff: staffByEmail,
          userId: userResponse.userId,
          userCreated: true,
        };
      }

      // If staff wasn't auto-created (edge case), create it now linked to the user
      const staff = await this.staffService.createStaff(
        { ...createDto, userId: userResponse.userId },
        context
      );

      return {
        staff,
        userId: userResponse.userId,
        userCreated: true,
      };
    } catch (error: any) {
      this.logger.error(`Atomic staff+user creation failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        `Failed to create staff with user account: ${error.message}`
      );
    }
  }

  // ============================================
  // List All Staff
  // ============================================

  @Get()
  async listStaff(
    @Query() filter: StaffFilterDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.listStaff(context, filter);
  }

  // ============================================
  // Lookup Staff by Email (User-to-Staff bridge)
  // ============================================

  @Get('by-email')
  async getStaffByEmail(
    @Query('email') email: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    const staff = await this.staffService.getStaffByEmail(email, context);
    if (!staff) {
      throw new NotFoundException(`No staff member found with email: ${email}`);
    }
    return staff;
  }

  // ============================================
  // Search Staff (static route before :staffId)
  // ============================================

  @Get('search/:term')
  async searchStaff(
    @Param('term') term: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.searchStaff(term, context, limit ? parseInt(limit, 10) : 20);
  }

  // ============================================
  // Get Staff by ID (parameterized — must be after static routes)
  // ============================================

  @Get(':staffId')
  async getStaff(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.getStaff(staffId, context);
  }

  // ============================================
  // Update Staff
  // ============================================

  @Patch(':staffId')
  async updateStaff(
    @Param('staffId') staffId: string,
    @Body() updateDto: UpdateStaffDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.updateStaff(staffId, updateDto, context);
  }

  // ============================================
  // Update Employment Status
  // ============================================

  @Patch(':staffId/employment-status')
  async updateEmploymentStatus(
    @Param('staffId') staffId: string,
    @Body() statusDto: UpdateEmploymentStatusDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.updateEmploymentStatus(staffId, statusDto, context);
  }

  // ============================================
  // Get Employment History
  // ============================================

  @Get(':staffId/employment-history')
  async getEmploymentHistory(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EmploymentHistoryListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.employmentHistoryService.listHistory(staffId, context);
  }

  // ============================================
  // Delete Staff (Soft Delete)
  // ============================================

  @Delete(':staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStaff(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.staffService.deleteStaff(staffId, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}

// ============================================
// School-scoped Staff Controller
// ============================================

@Controller('schools/:schoolId/staff')
@UseGuards(JwtAuthGuard)
export class SchoolStaffController {
  constructor(private readonly staffService: StaffService) {}

  // ============================================
  // Create Staff in School
  // ============================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateStaffDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    // Override primarySchoolId with path parameter
    const dto = { ...createDto, primarySchoolId: schoolId };
    return this.staffService.createStaff(dto, context);
  }

  // ============================================
  // List Staff in School
  // ============================================

  @Get()
  async listSchoolStaff(
    @Param('schoolId') schoolId: string,
    @Query() filter: StaffFilterDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.listStaffBySchool(schoolId, context, filter);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}

// ============================================
// Staff Assignment Controller (first-class entities)
// ============================================

@Controller('staff/:staffId/assignments')
@UseGuards(JwtAuthGuard)
export class StaffAssignmentController {
  constructor(private readonly assignmentService: StaffAssignmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAssignment(
    @Param('staffId') staffId: string,
    @Body() createDto: CreateStaffAssignmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.assignmentService.createAssignment(staffId, createDto, context);
  }

  @Get()
  async listAssignments(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffAssignmentListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.assignmentService.listAssignmentsForStaff(staffId, context);
  }

  @Get(':assignmentId')
  async getAssignment(
    @Param('staffId') staffId: string,
    @Param('assignmentId') assignmentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.assignmentService.getAssignment(staffId, assignmentId, context);
  }

  @Patch(':assignmentId')
  async updateAssignment(
    @Param('staffId') staffId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() updateDto: UpdateStaffAssignmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.assignmentService.updateAssignment(staffId, assignmentId, updateDto, context);
  }

  @Delete(':assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async endAssignment(
    @Param('staffId') staffId: string,
    @Param('assignmentId') assignmentId: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    const effectiveEndDate = endDate || new Date().toISOString().split('T')[0];
    return this.assignmentService.endAssignment(staffId, assignmentId, effectiveEndDate, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}

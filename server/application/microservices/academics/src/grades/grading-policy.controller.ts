/**
 * Grading Policy Controller
 *
 * REST endpoints for managing school-level grading policies.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import {
  GradingPolicyService,
  CreateGradingPolicyDto,
  UpdateGradingPolicyDto,
} from './grading-policy.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities';
import { GradingPolicyResponseDto } from '../common/mappers/grading-policy.mapper';

@Controller('academics/grading-policies')
@UseGuards(JwtAuthGuard)
export class GradingPolicyController {
  constructor(private readonly gradingPolicyService: GradingPolicyService) {}

  /**
   * Create a new grading policy
   * POST /academics/grading-policies
   */
  @Post()
  async createGradingPolicy(
    @Body() dto: CreateGradingPolicyDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradingPolicyResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.gradingPolicyService.createGradingPolicy(dto, context);
  }

  /**
   * List grading policies for a school
   * GET /academics/grading-policies?schoolId=xxx
   */
  @Get()
  async listGradingPolicies(
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradingPolicyResponseDto[]> {
    const context = this.buildContext(tenant, req);
    return this.gradingPolicyService.listGradingPolicies(schoolId, context);
  }

  /**
   * Get a grading policy by ID
   * GET /academics/grading-policies/:id?schoolId=xxx
   */
  @Get(':id')
  async getGradingPolicy(
    @Param('id') policyId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradingPolicyResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.gradingPolicyService.getGradingPolicy(policyId, schoolId, context);
  }

  /**
   * Update a grading policy
   * PATCH /academics/grading-policies/:id?schoolId=xxx
   */
  @Patch(':id')
  async updateGradingPolicy(
    @Param('id') policyId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateGradingPolicyDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradingPolicyResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.gradingPolicyService.updateGradingPolicy(policyId, schoolId, dto, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}

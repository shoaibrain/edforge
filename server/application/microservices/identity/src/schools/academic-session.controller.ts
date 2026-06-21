/**
 * Academic Session Controller - AcademicSession REST endpoints
 *
 * Routes: /schools/:schoolId/academic-sessions
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
} from '@nestjs/common';
import { Request } from 'express';
import { AcademicSessionService } from './academic-session.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateAcademicSessionDtoZ,
  UpdateAcademicSessionDtoZ,
} from '../common/dto/zod-dtos';
import type {
  AcademicSessionResponseDto,
  AcademicSessionListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/academic-sessions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AcademicSessionController {
  constructor(private readonly academicSessionService: AcademicSessionService) {}

  /**
   * Create academic session
   * POST /schools/:schoolId/academic-sessions
   */
  @Post()
  @RequirePermission({ resource: 'scheduling', action: 'create', schoolIdParam: 'schoolId' })
  async createSession(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateAcademicSessionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicSessionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicSessionService.createSession(schoolId, createDto, context);
  }

  /**
   * List academic sessions
   * GET /schools/:schoolId/academic-sessions
   */
  @Get()
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async listSessions(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicSessionListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicSessionService.listSessions(
      schoolId,
      context,
      academicYearId
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get academic session by ID
   * GET /schools/:schoolId/academic-sessions/:sessionId
   */
  @Get(':sessionId')
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async getSession(
    @Param('schoolId') schoolId: string,
    @Param('sessionId') sessionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicSessionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicSessionService.getSession(schoolId, sessionId, context);
  }

  /**
   * Update academic session
   * PATCH /schools/:schoolId/academic-sessions/:sessionId
   */
  @Patch(':sessionId')
  @RequirePermission({ resource: 'scheduling', action: 'edit', schoolIdParam: 'schoolId' })
  async updateSession(
    @Param('schoolId') schoolId: string,
    @Param('sessionId') sessionId: string,
    @Body() updateDto: UpdateAcademicSessionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicSessionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicSessionService.updateSession(schoolId, sessionId, updateDto, context);
  }

  /**
   * Delete academic session
   * DELETE /schools/:schoolId/academic-sessions/:sessionId
   */
  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission({ resource: 'scheduling', action: 'delete', schoolIdParam: 'schoolId' })
  async deleteSession(
    @Param('schoolId') schoolId: string,
    @Param('sessionId') sessionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.academicSessionService.deleteSession(schoolId, sessionId, context);
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

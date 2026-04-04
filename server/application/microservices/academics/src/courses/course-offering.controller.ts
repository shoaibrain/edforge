/**
 * Course Offering Controller - REST endpoints
 *
 * Routes: /academics/course-offerings
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
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { CourseOfferingService } from './course-offering.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateCourseOfferingDtoZ,
  UpdateCourseOfferingDtoZ,
} from '../common/dto/zod-dtos';
import type {
  CourseOfferingResponseDto,
  CourseOfferingListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('academics/course-offerings')
@UseGuards(JwtAuthGuard)
export class CourseOfferingController {
  private readonly logger = new Logger(CourseOfferingController.name);

  constructor(private readonly courseOfferingService: CourseOfferingService) {}

  /**
   * Create a course offering
   * POST /academics/course-offerings
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'create' })
  async createCourseOffering(
    @Body() dto: CreateCourseOfferingDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseOfferingResponseDto> {
    this.logger.log(`POST /academics/course-offerings — bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.courseOfferingService.createCourseOffering(dto, context);
  }

  /**
   * List course offerings for a school
   * GET /academics/course-offerings?schoolId=xxx&courseId=xxx&academicSessionId=xxx
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'view' })
  async listCourseOfferings(
    @Query('schoolId') schoolId: string,
    @Query('courseId') courseId: string,
    @Query('academicSessionId') academicSessionId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseOfferingListResponseDto> {
    this.logger.log(`GET /academics/course-offerings — schoolId=${schoolId} courseId=${courseId || '[none]'} academicSessionId=${academicSessionId || '[none]'} limit=${limit || '50'} cursor=${cursor ? '[provided]' : '[none]'}`);
    const context = this.buildContext(tenant, req);
    const result = await this.courseOfferingService.listCourseOfferings(
      schoolId,
      context,
      { courseId, academicSessionId },
      limit ? parseInt(limit, 10) : 50,
      cursor,
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get course offering by ID
   * GET /academics/course-offerings/:id?schoolId=xxx
   */
  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'view' })
  async getCourseOffering(
    @Param('id') courseOfferingId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseOfferingResponseDto> {
    this.logger.log(`GET /academics/course-offerings/${courseOfferingId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.courseOfferingService.getCourseOffering(courseOfferingId, schoolId, context);
  }

  /**
   * Update course offering
   * PATCH /academics/course-offerings/:id?schoolId=xxx
   */
  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'edit' })
  async updateCourseOffering(
    @Param('id') courseOfferingId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateCourseOfferingDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseOfferingResponseDto> {
    this.logger.log(`PATCH /academics/course-offerings/${courseOfferingId} — schoolId=${schoolId} bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.courseOfferingService.updateCourseOffering(courseOfferingId, schoolId, dto, context);
  }

  /**
   * Delete course offering
   * DELETE /academics/course-offerings/:id?schoolId=xxx
   */
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCourseOffering(
    @Param('id') courseOfferingId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/course-offerings/${courseOfferingId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.courseOfferingService.deleteCourseOffering(courseOfferingId, schoolId, context);
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

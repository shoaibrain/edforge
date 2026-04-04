/**
 * Courses Controller - Course catalog management endpoints
 *
 * Ed-Fi Alignment: Maps to Ed-Fi Course resource operations.
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
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CourseResponseDto } from '@aibrains/shared-types';
import { CreateCourseDtoZ, UpdateCourseDtoZ } from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

interface CourseListResponseDto {
  items: CourseResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/courses')
@UseGuards(JwtAuthGuard)
export class CoursesController {
  private readonly logger = new Logger(CoursesController.name);

  constructor(private readonly coursesService: CoursesService) {}

  /**
   * Create a new course
   * POST /academics/courses
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'create' })
  async createCourse(
    @Body() dto: CreateCourseDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseResponseDto> {
    this.logger.log(`POST /academics/courses — bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.coursesService.createCourse(dto, context);
  }

  /**
   * List courses for a school
   * GET /academics/courses?schoolId=xxx
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'view' })
  async listCourses(
    @Query('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @Query('subjectArea') subjectArea: string,
    @Query('courseType') courseType: string,
    @Query('isActive') isActive: string,
    @Query('departmentId') departmentId: string,
    @Query('search') search: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseListResponseDto> {
    this.logger.log(`GET /academics/courses — schoolId=${schoolId} subjectArea=${subjectArea || '[none]'} courseType=${courseType || '[none]'} isActive=${isActive || '[none]'} departmentId=${departmentId || '[none]'} search=${search || '[none]'} limit=${limit || '50'} cursor=${cursor ? '[provided]' : '[none]'}`);
    const context = this.buildContext(tenant, req);

    const result = await this.coursesService.listCourses(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 50,
      cursor,
      {
        subjectArea,
        courseType,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        departmentId,
        searchTerm: search,
      },
    );

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get a course by ID
   * GET /academics/courses/:id?schoolId=xxx
   */
  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'view' })
  async getCourse(
    @Param('id') courseId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseResponseDto> {
    this.logger.log(`GET /academics/courses/${courseId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.coursesService.getCourse(courseId, schoolId, context);
  }

  /**
   * Update a course
   * PATCH /academics/courses/:id?schoolId=xxx
   */
  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'edit' })
  async updateCourse(
    @Param('id') courseId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateCourseDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CourseResponseDto> {
    this.logger.log(`PATCH /academics/courses/${courseId} — schoolId=${schoolId} bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.coursesService.updateCourse(courseId, schoolId, dto, context);
  }

  /**
   * Soft-delete a course
   * DELETE /academics/courses/:id?schoolId=xxx
   */
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'courses', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCourse(
    @Param('id') courseId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/courses/${courseId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.coursesService.deleteCourse(courseId, schoolId, context);
  }

  /**
   * Build request context from tenant credentials and request
   */
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

/**
 * Sections Controller - Course section management endpoints
 *
 * Ed-Fi Alignment: Maps to Ed-Fi Section and StudentSectionAssociation.
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
  UseInterceptors,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { SectionsService } from './sections.service';
import { SectionEnrollmentService } from './section-enrollment.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CacheTTL } from '../common/decorators/cache-ttl.decorator';
import { CacheHeaderInterceptor } from '../common/interceptors/cache-header.interceptor';
import {
  SectionResponseDto,
  StudentSectionResponseDto,
  SectionRosterResponseDto,
} from '@aibrains/shared-types';
import { CreateSectionDtoZ, UpdateSectionDtoZ, EnrollStudentInSectionDtoZ } from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

interface SectionListResponseDto {
  items: SectionResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

@Controller('academics/sections')
@UseGuards(JwtAuthGuard)
export class SectionsController {
  private readonly logger = new Logger(SectionsController.name);

  constructor(
    private readonly sectionsService: SectionsService,
    private readonly enrollmentService: SectionEnrollmentService,
  ) {}

  /**
   * Create a new section
   * POST /academics/sections
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'create' })
  async createSection(
    @Body() dto: CreateSectionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionResponseDto> {
    this.logger.log(`POST /academics/sections — bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.sectionsService.createSection(dto, context);
  }

  /**
   * List sections for a school
   * GET /academics/sections?schoolId=xxx
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'view' })
  @UseInterceptors(CacheHeaderInterceptor)
  @CacheTTL(300)
  async listSections(
    @Query('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @Query('courseId') courseId: string,
    @Query('teacherId') teacherId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('isActive') isActive: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionListResponseDto> {
    this.logger.log(`GET /academics/sections — schoolId=${schoolId} courseId=${courseId || '[none]'} teacherId=${teacherId || '[none]'} academicYearId=${academicYearId || '[none]'} isActive=${isActive || '[none]'} limit=${limit || '50'} cursor=${cursor ? '[provided]' : '[none]'}`);
    const context = this.buildContext(tenant, req);

    const result = await this.sectionsService.listSections(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 50,
      cursor,
      {
        courseId,
        teacherId,
        academicYearId,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      },
    );

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
      total: result.total,
    };
  }

  /**
   * Get a section by ID
   * GET /academics/sections/:id?schoolId=xxx
   */
  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'view' })
  async getSection(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionResponseDto> {
    this.logger.log(`GET /academics/sections/${sectionId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.sectionsService.getSection(sectionId, schoolId, context);
  }

  /**
   * Update a section
   * PATCH /academics/sections/:id?schoolId=xxx
   */
  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async updateSection(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateSectionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionResponseDto> {
    this.logger.log(`PATCH /academics/sections/${sectionId} — schoolId=${schoolId} bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.sectionsService.updateSection(sectionId, schoolId, dto, context);
  }

  /**
   * Soft-delete a section
   * DELETE /academics/sections/:id?schoolId=xxx
   */
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSection(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/sections/${sectionId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.sectionsService.deleteSection(sectionId, schoolId, context);
  }

  // ------------------------------------------
  // Section Enrollment Endpoints
  // ------------------------------------------

  /**
   * Enroll a student in a section
   * POST /academics/sections/:id/students?schoolId=xxx
   */
  @Post(':id/students')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async enrollStudent(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: EnrollStudentInSectionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentSectionResponseDto> {
    this.logger.log(`POST /academics/sections/${sectionId}/students — schoolId=${schoolId} studentId=${dto.studentId}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.enrollStudent(sectionId, schoolId, dto.studentId, context);
  }

  /**
   * Get section roster (enrolled students)
   * GET /academics/sections/:id/students?schoolId=xxx
   */
  @Get(':id/students')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'view' })
  async getSectionRoster(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionRosterResponseDto> {
    this.logger.log(`GET /academics/sections/${sectionId}/students — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getSectionRoster(sectionId, schoolId, context);
  }

  /**
   * Drop a student from a section
   * DELETE /academics/sections/:id/students/:studentId?schoolId=xxx
   */
  @Delete(':id/students/:studentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async dropStudent(
    @Param('id') sectionId: string,
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/sections/${sectionId}/students/${studentId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.dropStudent(sectionId, schoolId, studentId, context);
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

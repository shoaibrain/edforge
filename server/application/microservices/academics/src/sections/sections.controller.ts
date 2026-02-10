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
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { SectionsService } from './sections.service';
import { SectionEnrollmentService } from './section-enrollment.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  SectionResponseDto,
  StudentSectionResponseDto,
  SectionRosterResponseDto,
} from '@edforge/shared-types';
import { CreateSectionDtoZ, UpdateSectionDtoZ, EnrollStudentInSectionDtoZ } from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

interface SectionListResponseDto {
  items: SectionResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/sections')
@UseGuards(JwtAuthGuard)
export class SectionsController {
  constructor(
    private readonly sectionsService: SectionsService,
    private readonly enrollmentService: SectionEnrollmentService,
  ) {}

  /**
   * Create a new section
   * POST /academics/sections
   */
  @Post()
  async createSection(
    @Body() dto: CreateSectionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sectionsService.createSection(dto, context);
  }

  /**
   * List sections for a school
   * GET /academics/sections?schoolId=xxx
   */
  @Get()
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
    };
  }

  /**
   * Get a section by ID
   * GET /academics/sections/:id?schoolId=xxx
   */
  @Get(':id')
  async getSection(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sectionsService.getSection(sectionId, schoolId, context);
  }

  /**
   * Update a section
   * PATCH /academics/sections/:id?schoolId=xxx
   */
  @Patch(':id')
  async updateSection(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateSectionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sectionsService.updateSection(sectionId, schoolId, dto, context);
  }

  /**
   * Soft-delete a section
   * DELETE /academics/sections/:id?schoolId=xxx
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSection(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
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
  async enrollStudent(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: EnrollStudentInSectionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentSectionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.enrollStudent(sectionId, schoolId, dto.studentId, context);
  }

  /**
   * Get section roster (enrolled students)
   * GET /academics/sections/:id/students?schoolId=xxx
   */
  @Get(':id/students')
  async getSectionRoster(
    @Param('id') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionRosterResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getSectionRoster(sectionId, schoolId, context);
  }

  /**
   * Drop a student from a section
   * DELETE /academics/sections/:id/students/:studentId?schoolId=xxx
   */
  @Delete(':id/students/:studentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dropStudent(
    @Param('id') sectionId: string,
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
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

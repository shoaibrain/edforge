/**
 * Families Controllers — EPIC-FB Sprint FB-1.6
 *
 * School-scoped family CRUD + membership under
 * `/academics/schools/:schoolId/families`, plus the student-scoped view
 * `GET /academics/students/:studentId/family` (schoolId as query param,
 * mirroring the students controller's `GET /academics/students/:id`).
 *
 * Permissions mirror the students controller (families are
 * student-relationship data): reads `students:view`, mutations
 * `students:edit` (epic FB-1.6).
 *
 * Feature flag: FamilyGroupsFlagGuard 404s every route when
 * `FAMILY_GROUPS_ENABLED === 'false'`.
 *
 * Three-way handoff (per CLAUDE.md): controllers (here) + API GW spec
 * (tenant-api-prod.json — registered by the FB-1.7 follow-up package) +
 * nginx `^/academics` (existing prefix — no nginx.template change).
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
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { FamiliesService, FamilyListResponseDto } from './families.service';
import { FamilyGroupsFlagGuard } from './family-groups-flag.guard';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import {
  CreateFamilyDtoZ,
  UpdateFamilyDtoZ,
  AddFamilyMemberDtoZ,
} from '../common/dto/zod-dtos';
import type {
  FamilyResponseDto,
  FamilyMemberDto,
  StudentFamilyViewDto,
} from '@aibrains/shared-types';

function buildContext(tenant: TenantContext, req: Request): RequestContext {
  return {
    userId: tenant.userId,
    tenantId: tenant.tenantId,
    email: tenant.email,
    role: tenant.globalRole,
    jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
    username: tenant.username,
  };
}

@Controller('academics/schools/:schoolId/families')
@UseGuards(JwtAuthGuard, FamilyGroupsFlagGuard)
export class FamiliesController {
  private readonly logger = new Logger(FamiliesController.name);

  constructor(private readonly familiesService: FamiliesService) {}

  /**
   * POST /academics/schools/:schoolId/families
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  async createFamily(
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateFamilyDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<FamilyResponseDto> {
    this.logger.log(`POST /academics/schools/${schoolId}/families — name=${dto.name}`);
    if (dto.schoolId !== schoolId) {
      throw new BadRequestException('Body schoolId does not match route schoolId');
    }
    const context = buildContext(tenant, req);
    return this.familiesService.createFamily(schoolId, dto, context);
  }

  /**
   * GET /academics/schools/:schoolId/families?namePrefix=…&limit=…&cursor=…
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async listFamilies(
    @Param('schoolId') schoolId: string,
    @Query('namePrefix') namePrefix: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<FamilyListResponseDto> {
    this.logger.log(
      `GET /academics/schools/${schoolId}/families — namePrefix=${namePrefix ?? '*'} limit=${limitRaw ?? '50'}`,
    );
    let limit = 50;
    if (limitRaw !== undefined) {
      const parsed = parseInt(limitRaw, 10);
      limit = Number.isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 1), 200);
    }
    const context = buildContext(tenant, req);
    return this.familiesService.listFamilies(schoolId, { namePrefix, limit, cursor }, context);
  }

  /**
   * GET /academics/schools/:schoolId/families/:familyId
   */
  @Get(':familyId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async getFamily(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<FamilyResponseDto> {
    this.logger.log(`GET /academics/schools/${schoolId}/families/${familyId}`);
    const context = buildContext(tenant, req);
    return this.familiesService.getFamily(familyId, schoolId, context);
  }

  /**
   * PATCH /academics/schools/:schoolId/families/:familyId
   */
  @Patch(':familyId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  async updateFamily(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @Body() dto: UpdateFamilyDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<FamilyResponseDto> {
    this.logger.log(
      `PATCH /academics/schools/${schoolId}/families/${familyId} — fields=${Object.keys(dto).join(',')}`,
    );
    const context = buildContext(tenant, req);
    return this.familiesService.updateFamily(familyId, schoolId, dto, context);
  }

  /**
   * DELETE /academics/schools/:schoolId/families/:familyId
   * Soft-delete: flips isActive=false. Row retained; members stay linked
   * but the family stops resolving everywhere (reads filter it out).
   */
  @Delete(':familyId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateFamily(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/schools/${schoolId}/families/${familyId}`);
    const context = buildContext(tenant, req);
    await this.familiesService.deactivateFamily(familyId, schoolId, context);
  }

  /**
   * POST /academics/schools/:schoolId/families/:familyId/members
   */
  @Post(':familyId/members')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  async addMember(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @Body() dto: AddFamilyMemberDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<FamilyMemberDto> {
    this.logger.log(
      `POST /academics/schools/${schoolId}/families/${familyId}/members — studentId=${dto.studentId}`,
    );
    const context = buildContext(tenant, req);
    return this.familiesService.addMember(familyId, schoolId, dto, context);
  }

  /**
   * DELETE /academics/schools/:schoolId/families/:familyId/members/:studentId
   * Idempotent unlink.
   */
  @Delete(':familyId/members/:studentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(
      `DELETE /academics/schools/${schoolId}/families/${familyId}/members/${studentId}`,
    );
    const context = buildContext(tenant, req);
    await this.familiesService.removeMember(familyId, schoolId, studentId, context);
  }
}

@Controller('academics/students/:studentId/family')
@UseGuards(JwtAuthGuard, FamilyGroupsFlagGuard)
export class StudentFamilyController {
  private readonly logger = new Logger(StudentFamilyController.name);

  constructor(private readonly familiesService: FamiliesService) {}

  /**
   * GET /academics/students/:studentId/family?schoolId=…
   *
   * 200-with-null contract: unlinked students get
   * `{ family: null, siblings: [] }`, never 404 (FB-1.5).
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async getStudentFamily(
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentFamilyViewDto> {
    this.logger.log(`GET /academics/students/${studentId}/family — schoolId=${schoolId}`);
    if (!schoolId) {
      // PermissionGuard already 400s for non-TenantAdmin; this covers the
      // TenantAdmin bypass path so the view is always school-bounded.
      throw new BadRequestException('Missing required parameter: schoolId');
    }
    const context = buildContext(tenant, req);
    return this.familiesService.getStudentFamily(studentId, schoolId, context);
  }
}

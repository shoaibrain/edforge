import {
  Controller,
  Get, Post, Patch, Delete,
  Body, Param, Query,
  UseGuards, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { FeeStructuresService } from './fee-structures.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateFeeStructureDtoZ, UpdateFeeStructureDtoZ } from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities/base.entity';
import type { FeeStructure } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/fee-structures')
@UseGuards(JwtAuthGuard)
export class FeeStructuresController {
  constructor(private readonly feeStructuresService: FeeStructuresService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async create(
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateFeeStructureDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<FeeStructure> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.feeStructuresService.create(schoolId, dto, context);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('feeType') feeType: string,
    @Query('academicYear') academicYear: string,
    @Query('isActive') isActive: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: FeeStructure[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.feeStructuresService.list(schoolId, context, {
      feeType,
      academicYear,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('id') feeStructureId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<FeeStructure> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.feeStructuresService.get(schoolId, feeStructureId, context);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async update(
    @Param('schoolId') schoolId: string,
    @Param('id') feeStructureId: string,
    @Body() dto: UpdateFeeStructureDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<FeeStructure> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.feeStructuresService.update(schoolId, feeStructureId, dto, context);
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'delete', schoolIdParam: 'schoolId' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('schoolId') schoolId: string,
    @Param('id') feeStructureId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<void> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.feeStructuresService.delete(schoolId, feeStructureId, context);
  }

  private buildContext(tenant: any, req: Request, schoolId?: string): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
      schoolId,
    };
  }
}

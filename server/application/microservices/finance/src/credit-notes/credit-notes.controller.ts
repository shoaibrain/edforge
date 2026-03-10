import {
  Controller,
  Get, Post, Delete,
  Body, Param, Query,
  UseGuards, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { CreditNotesService } from './credit-notes.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateCreditNoteDtoZ, ApplyCreditNoteDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import type { CreditNote } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/credit-notes')
@UseGuards(JwtAuthGuard)
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async create(
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateCreditNoteDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<CreditNote> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.creditNotesService.create(schoolId, dto, context);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('status') status: string,
    @Query('type') type: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: CreditNote[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.creditNotesService.list(schoolId, context, {
      status,
      type,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('id') creditNoteId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<CreditNote> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.creditNotesService.get(schoolId, creditNoteId, context);
  }

  @Post(':id/apply')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async apply(
    @Param('schoolId') schoolId: string,
    @Param('id') creditNoteId: string,
    @Body() dto: ApplyCreditNoteDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<CreditNote> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.creditNotesService.apply(schoolId, creditNoteId, dto, context);
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'delete', schoolIdParam: 'schoolId' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @Param('schoolId') schoolId: string,
    @Param('id') creditNoteId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<void> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.creditNotesService.cancel(schoolId, creditNoteId, context);
  }
}

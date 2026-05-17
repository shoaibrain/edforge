/**
 * Calendar Block Controller — Sprint C4.3 (Multi-Day Event Blocks)
 *
 * REST routes:
 *   POST   /calendar-blocks             — create block + N child dates atomically
 *   GET    /calendar-blocks             — list (filterable by school/AY/descriptor/window)
 *   GET    /calendar-blocks/:blockId    — single-block detail
 *   PATCH  /calendar-blocks/:blockId    — update block metadata; per-day overrides survive
 *   DELETE /calendar-blocks/:blockId    — cascade-delete block + child dates via GSI9
 *
 * Auth: JwtAuthGuard suffices — operator-only via standard tenant scope.
 * No per-school RBAC carve-outs (matches the existing calendar-date controller pattern).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CalendarBlockService } from './calendar-block.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateCalendarBlockDtoZ,
  UpdateCalendarBlockDtoZ,
} from '../common/dto/zod-dtos';
import {
  calendarBlockFilterSchema,
  type CalendarBlockResponseDto,
  type CalendarBlockListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('calendar-blocks')
@UseGuards(JwtAuthGuard)
export class CalendarBlockController {
  constructor(private readonly service: CalendarBlockService) {}

  /** POST /calendar-blocks */
  @Post()
  async create(
    @Body() dto: CreateCalendarBlockDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CalendarBlockResponseDto> {
    return this.service.createBlock(dto, this.buildContext(tenant, req));
  }

  /** GET /calendar-blocks (LIST) */
  @Get()
  async list(
    @Query() rawQuery: Record<string, string>,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CalendarBlockListResponseDto> {
    // Parse + coerce via the Zod schema rather than per-param annotations
    // so `limit`/`cursor`/optional `from`/`to` get the same validation
    // surface as a Zod-validated body.
    const filter = calendarBlockFilterSchema.parse(rawQuery);
    return this.service.listBlocks(filter, this.buildContext(tenant, req));
  }

  /** GET /calendar-blocks/:blockId */
  @Get(':blockId')
  async getOne(
    @Param('blockId') blockId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CalendarBlockResponseDto> {
    return this.service.getBlock(schoolId, blockId, this.buildContext(tenant, req));
  }

  /** PATCH /calendar-blocks/:blockId */
  @Patch(':blockId')
  async update(
    @Param('blockId') blockId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateCalendarBlockDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<CalendarBlockResponseDto> {
    return this.service.updateBlock(schoolId, blockId, dto, this.buildContext(tenant, req));
  }

  /** DELETE /calendar-blocks/:blockId */
  @Delete(':blockId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('blockId') blockId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{ deletedChildren: number }> {
    return this.service.deleteBlock(schoolId, blockId, this.buildContext(tenant, req));
  }

  // ---- helpers ----

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    };
  }
}

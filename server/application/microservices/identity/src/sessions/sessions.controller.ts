/**
 * Sessions Controller - Session Management Endpoints
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  RevokeAllSessionsDtoZ,
} from '../common/dto/zod-dtos';
import type {
  SessionResponseDto,
  SessionListResponseDto,
} from '@edforge/shared-types';
import { RequestContext } from '../common/entities';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /**
   * List all active sessions for current user
   * GET /sessions
   */
  @Get()
  async listSessions(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SessionListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sessionsService.listSessions(context);
  }

  /**
   * Get session by ID
   * GET /sessions/:id
   */
  @Get(':id')
  async getSession(
    @Param('id') sessionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SessionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sessionsService.getSession(sessionId, context);
  }

  /**
   * Revoke a specific session
   * DELETE /sessions/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('id') sessionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.sessionsService.revokeSession({ sessionId }, context);
  }

  /**
   * Revoke all sessions (optionally except current)
   * POST /sessions/revoke-all
   */
  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(
    @Body() revokeAllDto: RevokeAllSessionsDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ revokedCount: number }> {
    const context = this.buildContext(tenant, req);
    return this.sessionsService.revokeAllSessions(revokeAllDto, context);
  }

  /**
   * Admin: List sessions for a specific user
   * GET /sessions/user/:userId
   */
  @Get('user/:userId')
  async listUserSessions(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SessionListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sessionsService.listUserSessions(userId, context);
  }

  /**
   * Admin: Revoke all sessions for a user
   * POST /sessions/user/:userId/revoke-all
   */
  @Post('user/:userId/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeUserSessions(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ revokedCount: number }> {
    const context = this.buildContext(tenant, req);
    return this.sessionsService.revokeUserSessions(userId, context);
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

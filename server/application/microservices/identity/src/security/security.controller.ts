/**
 * Security Controller - User security management endpoints
 * 
 * All endpoints are mounted under /users/{userId}/security/*
 * Handles password changes, MFA, session management, and login history.
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
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { SecurityService } from './security.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  ChangePasswordDtoZ,
  MfaVerifyDtoZ,
  MfaDisableDtoZ,
} from '../common/dto/zod-dtos';
import type {
  SecurityOverviewDto,
  ChangePasswordResponseDto,
  MfaSetupResponseDto,
  MfaVerifyResponseDto,
  MfaDisableResponseDto,
  SecuritySessionDto,
  SecuritySessionsListDto,
  RevokeSessionResponseDto,
  RevokeAllSessionsResponseDto,
  LoginHistoryResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('users/:userId/security')
@UseGuards(JwtAuthGuard)
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  /**
   * Get security overview
   * GET /users/{userId}/security
   */
  @Get()
  async getSecurityOverview(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SecurityOverviewDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.getSecurityOverview(userId, context);
  }

  /**
   * Change password
   * POST /users/{userId}/security/change-password
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Param('userId') userId: string,
    @Body() changePasswordDto: ChangePasswordDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<ChangePasswordResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.changePassword(userId, changePasswordDto, context);
  }

  // ============================================
  // MFA Endpoints
  // ============================================

  /**
   * Initiate MFA setup
   * POST /users/{userId}/security/mfa/setup
   */
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  async initiateMfaSetup(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<MfaSetupResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.initiateMfaSetup(userId, context);
  }

  /**
   * Verify and enable MFA
   * POST /users/{userId}/security/mfa/verify
   */
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyAndEnableMfa(
    @Param('userId') userId: string,
    @Body() verifyDto: MfaVerifyDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<MfaVerifyResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.verifyAndEnableMfa(userId, verifyDto, context);
  }

  /**
   * Disable MFA
   * POST /users/{userId}/security/mfa/disable
   */
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  async disableMfa(
    @Param('userId') userId: string,
    @Body() disableDto: MfaDisableDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<MfaDisableResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.disableMfa(userId, disableDto, context);
  }

  // ============================================
  // Session Management Endpoints
  // ============================================

  /**
   * Get active sessions
   * GET /users/{userId}/security/sessions
   */
  @Get('sessions')
  async getActiveSessions(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SecuritySessionsListDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.getActiveSessions(userId, context);
  }

  /**
   * Register (or refresh) the caller's own session — the seam that lets
   * Amplify-direct logins populate the session store. The frontend calls this
   * right after Cognito sign-in. The FE call is best-effort: it must never
   * block or fail the login on this endpoint.
   * POST /users/{userId}/security/sessions
   */
  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  async registerSession(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SecuritySessionDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.registerSession(userId, context, {
      ipAddress: this.extractIpAddress(req),
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * Heartbeat — rebind the caller's session to its current access token and
   * extend its idle window (called after Amplify rotates the access token).
   * PATCH /users/{userId}/security/sessions/{sessionId}
   */
  @Patch('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async touchSession(
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SecuritySessionDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.touchSession(userId, sessionId, context);
  }

  /**
   * Revoke a specific session
   * DELETE /users/{userId}/security/sessions/{sessionId}
   */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RevokeSessionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.revokeSession(userId, sessionId, context);
  }

  /**
   * Revoke all sessions
   * POST /users/{userId}/security/sessions/revoke-all
   */
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(
    @Param('userId') userId: string,
    @Query('exceptCurrent') exceptCurrent: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RevokeAllSessionsResponseDto> {
    const context = this.buildContext(tenant, req);
    const exceptCurrentSession = exceptCurrent === 'true';
    return this.securityService.revokeAllSessions(userId, exceptCurrentSession, context);
  }

  // ============================================
  // Login History Endpoints
  // ============================================

  /**
   * Get login history
   * GET /users/{userId}/security/login-history
   */
  @Get('login-history')
  async getLoginHistory(
    @Param('userId') userId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LoginHistoryResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.getLoginHistory(
      userId,
      context,
      this.parseLoginHistoryLimit(limit),
      cursor || undefined
    );
  }

  /**
   * Parse + bound the login-history page size. Absent → default 20. A
   * non-integer or < 1 value is a 400: a NaN (`?limit=abc`) or 0 would
   * otherwise fall through the `limit ? ...` guard and drop the DynamoDB Limit
   * entirely, letting one request scan the whole login-history partition.
   * Oversized values are clamped to 100.
   */
  private parseLoginHistoryLimit(raw?: string): number {
    if (raw === undefined || raw === '') return 20;
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const parsed = parseInt(raw, 10);
    if (parsed < 1) {
      throw new BadRequestException('limit must be >= 1');
    }
    return Math.min(parsed, 100);
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

  /** Client IP for session device info — trusts the first x-forwarded-for hop. */
  private extractIpAddress(req: Request): string | undefined {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      return ips.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress;
  }
}

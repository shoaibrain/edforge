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
import { SecurityService } from './security.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  SecurityOverviewDto,
  ChangePasswordDto,
  ChangePasswordResponseDto,
  MfaSetupResponseDto,
  MfaVerifyDto,
  MfaVerifyResponseDto,
  MfaDisableDto,
  MfaDisableResponseDto,
  SecuritySessionsListDto,
  RevokeSessionResponseDto,
  RevokeAllSessionsResponseDto,
  LoginHistoryResponseDto,
} from '../common/dto/security.dto';
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
    @Body() changePasswordDto: ChangePasswordDto,
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
    @Body() verifyDto: MfaVerifyDto,
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
    @Body() disableDto: MfaDisableDto,
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
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LoginHistoryResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.securityService.getLoginHistory(
      userId,
      context,
      limit ? parseInt(limit, 10) : 20
    );
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


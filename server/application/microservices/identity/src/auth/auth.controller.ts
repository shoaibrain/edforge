/**
 * Auth Controller - Authentication endpoints
 * 
 * @module AuthController
 * @description Provides authentication endpoints including login, logout, refresh, and user info
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RefreshTokenResponseDto,
  LogoutDto,
  CurrentUserResponseDto,
} from '../common/dto/auth.dto';
import { DeviceInfo } from '../common/entities/session.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login with email and password
   * POST /auth/login
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request
  ): Promise<LoginResponseDto> {
    const deviceInfo = this.extractDeviceInfo(req);
    const ipAddress = this.extractIpAddress(req);
    const userAgent = req.headers['user-agent'];

    return this.authService.login(loginDto, deviceInfo, ipAddress, userAgent);
  }

  /**
   * Refresh access token
   * POST /auth/refresh
   */
  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @TenantCredentials() tenant: TenantContext
  ): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshToken(
      refreshTokenDto,
      tenant.tenantId,
      tenant.userId
    );
  }

  /**
   * Logout - invalidate session(s)
   * POST /auth/logout
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() logoutDto: LogoutDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
    };

    return this.authService.logout(logoutDto, context);
  }

  /**
   * Get current authenticated user
   * GET /auth/me
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CurrentUserResponseDto> {
    const context = {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };

    return this.authService.getCurrentUser(context);
  }

  /**
   * Health check endpoint (public)
   * GET /auth/health
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Extract device info from request
   */
  private extractDeviceInfo(req: Request): DeviceInfo {
    const userAgent = req.headers['user-agent'] || '';
    
    let deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown' = 'unknown';
    if (/mobile/i.test(userAgent)) {
      deviceType = 'mobile';
    } else if (/tablet|ipad/i.test(userAgent)) {
      deviceType = 'tablet';
    } else if (/windows|macintosh|linux/i.test(userAgent)) {
      deviceType = 'desktop';
    }

    let os: string | undefined;
    if (/windows/i.test(userAgent)) os = 'Windows';
    else if (/macintosh|mac os x/i.test(userAgent)) os = 'macOS';
    else if (/linux/i.test(userAgent)) os = 'Linux';
    else if (/android/i.test(userAgent)) os = 'Android';
    else if (/iphone|ipad/i.test(userAgent)) os = 'iOS';

    let browser: string | undefined;
    if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) browser = 'Chrome';
    else if (/firefox/i.test(userAgent)) browser = 'Firefox';
    else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari';
    else if (/edge/i.test(userAgent)) browser = 'Edge';

    return { deviceType, os, browser };
  }

  /**
   * Extract IP address from request
   */
  private extractIpAddress(req: Request): string | undefined {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      return ips.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress;
  }
}


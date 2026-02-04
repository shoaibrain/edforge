/**
 * Credentials Controller - Identity Service
 * 
 * REST API endpoints for staff credential management.
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
import { CredentialsService } from './credentials.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities/base.entity';
import type {
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialResponseDto,
  CredentialFilterDto,
  VerifyCredentialDto,
  CredentialListResponseDto,
} from '@edforge/shared-types';

@Controller('staff/:staffId/credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  // ============================================
  // Create Credential
  // ============================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCredential(
    @Param('staffId') staffId: string,
    @Body() createDto: CreateCredentialDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CredentialResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.credentialsService.createCredential(staffId, createDto, context);
  }

  // ============================================
  // Get Credential
  // ============================================

  @Get(':credentialId')
  async getCredential(
    @Param('staffId') staffId: string,
    @Param('credentialId') credentialId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CredentialResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.credentialsService.getCredential(staffId, credentialId, context);
  }

  // ============================================
  // List Credentials
  // ============================================

  @Get()
  async listCredentials(
    @Param('staffId') staffId: string,
    @Query() filter: CredentialFilterDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CredentialListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.credentialsService.listCredentials(staffId, context, filter);
  }

  // ============================================
  // Update Credential
  // ============================================

  @Patch(':credentialId')
  async updateCredential(
    @Param('staffId') staffId: string,
    @Param('credentialId') credentialId: string,
    @Body() updateDto: UpdateCredentialDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CredentialResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.credentialsService.updateCredential(staffId, credentialId, updateDto, context);
  }

  // ============================================
  // Verify Credential
  // ============================================

  @Patch(':credentialId/verify')
  async verifyCredential(
    @Param('staffId') staffId: string,
    @Param('credentialId') credentialId: string,
    @Body() verifyDto: VerifyCredentialDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CredentialResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.credentialsService.verifyCredential(staffId, credentialId, verifyDto, context);
  }

  // ============================================
  // Delete Credential
  // ============================================

  @Delete(':credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCredential(
    @Param('staffId') staffId: string,
    @Param('credentialId') credentialId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.credentialsService.deleteCredential(staffId, credentialId, context);
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

// ============================================
// Expiring Credentials Controller (Admin)
// ============================================

@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class ExpiringCredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get('expiring')
  async getExpiringCredentials(
    @Query('days') days: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CredentialResponseDto[]> {
    const context: RequestContext = {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
    return this.credentialsService.getExpiringCredentials(
      days ? parseInt(days, 10) : 90,
      context
    );
  }
}

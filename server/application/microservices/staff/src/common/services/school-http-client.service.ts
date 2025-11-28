/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * School HTTP Client - HTTP client for calling school-service
 * 
 * Uses @app/http-client library with circuit breaker and retry logic
 */

import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService, RequestContext as HttpClientRequestContext } from '@app/http-client';

export interface Department {
  departmentId: string;
  schoolId: string;
  name: string;
  description?: string;
  headOfDepartment?: string;
  status: 'active' | 'inactive';
}

@Injectable()
export class SchoolHttpClientService {
  private readonly logger = new Logger(SchoolHttpClientService.name);
  private readonly schoolServiceBaseUrl: string;

  constructor(
    private readonly httpClient: HttpClientService,
    private readonly configService: ConfigService
  ) {
    this.schoolServiceBaseUrl = this.configService.get<string>('SCHOOL_SERVICE_URL') || 'http://school-service:3001';
  }

  /**
   * Get Department from school-service
   * GET /schools/:schoolId/departments/:departmentId
   */
  async getDepartment(
    tenantId: string,
    schoolId: string,
    departmentId: string
  ): Promise<Department> {
    try {
      const url = `/schools/${encodeURIComponent(schoolId)}/departments/${encodeURIComponent(departmentId)}`;
      const context: HttpClientRequestContext = {
        tenantId,
        userId: 'system', // System call, no user context
        jwtToken: undefined
      };

      const response = await this.httpClient.get<Department>(
        url,
        {
          baseURL: this.schoolServiceBaseUrl
        },
        context
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get department: ${error.message}`, error.stack);
      
      if (error.response?.status === 404) {
        throw new NotFoundException(`Department ${departmentId} not found for school ${schoolId}`);
      }
      
      if (error.response?.status === 503 || error.isCircuitBreakerOpen) {
        throw new ServiceUnavailableException(`School service is currently unavailable`);
      }
      
      if (error.response?.status === 400) {
        throw new BadRequestException(`Invalid request: ${error.response?.data?.message || error.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Validate department exists and is active
   * Throws NotFoundException if department doesn't exist or is inactive
   */
  async validateDepartment(
    tenantId: string,
    schoolId: string,
    departmentId: string
  ): Promise<void> {
    try {
      const department = await this.getDepartment(tenantId, schoolId, departmentId);
      
      if (department.status !== 'active') {
        throw new BadRequestException(`Department ${departmentId} is not active`);
      }
      
      this.logger.debug(`Department ${departmentId} validated successfully`);
    } catch (error: any) {
      this.logger.error(`Department validation failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}


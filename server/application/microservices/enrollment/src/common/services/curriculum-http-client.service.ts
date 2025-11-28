/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Curriculum HTTP Client - HTTP client for calling curriculum-service
 * 
 * Uses @app/http-client library with circuit breaker and retry logic
 */

import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService, RequestContext as HttpClientRequestContext } from '@app/http-client';
import type { Classroom } from '@edforge/shared-types';

@Injectable()
export class CurriculumHttpClientService {
  private readonly logger = new Logger(CurriculumHttpClientService.name);
  private readonly curriculumServiceBaseUrl: string;

  constructor(
    private readonly httpClient: HttpClientService,
    private readonly configService: ConfigService
  ) {
    this.curriculumServiceBaseUrl = this.configService.get<string>('CURRICULUM_SERVICE_URL') || 'http://curriculum-service:3003';
  }

  /**
   * Get Classroom from curriculum-service
   * GET /curriculum/classrooms/:classroomId?schoolId={schoolId}&academicYearId={academicYearId}
   */
  async getClassroom(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<Classroom> {
    try {
      const url = `/curriculum/classrooms/${encodeURIComponent(classroomId)}?schoolId=${encodeURIComponent(schoolId)}&academicYearId=${encodeURIComponent(academicYearId)}`;
      const context: HttpClientRequestContext = {
        tenantId,
        userId: 'system', // System call, no user context
        jwtToken: undefined
      };

      const response = await this.httpClient.get<Classroom>(
        url,
        {
          baseURL: this.curriculumServiceBaseUrl
        },
        context
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get classroom: ${error.message}`, error.stack);
      
      if (error.response?.status === 404) {
        throw new NotFoundException(`Classroom ${classroomId} not found for school ${schoolId} and academic year ${academicYearId}`);
      }
      
      if (error.response?.status === 503 || error.isCircuitBreakerOpen) {
        throw new ServiceUnavailableException(`Curriculum service is currently unavailable`);
      }
      
      if (error.response?.status === 400) {
        throw new BadRequestException(`Invalid request: ${error.response?.data?.message || error.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Validate classroom capacity
   * Checks if classroom has available capacity for enrollment
   */
  async validateClassroomCapacity(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<{ hasCapacity: boolean; currentEnrollment: number; maxCapacity: number }> {
    try {
      const classroom = await this.getClassroom(tenantId, schoolId, academicYearId, classroomId);
      
      const currentEnrollment = classroom.enrollmentCount || 0;
      const maxCapacity = classroom.capacity || 0;
      const hasCapacity = maxCapacity > 0 && currentEnrollment < maxCapacity;

      return {
        hasCapacity,
        currentEnrollment,
        maxCapacity
      };
    } catch (error: any) {
      this.logger.error(`Failed to validate classroom capacity: ${error.message}`, error.stack);
      throw error;
    }
  }
}


/**
 * Health Check Controller
 * 
 * Kubernetes/ECS-compatible health endpoints:
 * - GET /health       - Comprehensive health status
 * - GET /health/ready - Readiness probe
 * - GET /health/live  - Liveness probe
 */

import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService, HealthCheckResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Comprehensive health check
   * Returns detailed status of service and all dependencies
   * 
   * Response codes:
   * - 200: Service is healthy
   * - 503: Service is unhealthy or degraded
   */
  @Get()
  async health(@Res() res: Response): Promise<void> {
    const result = await this.healthService.getHealthStatus();
    const statusCode = result.status === 'healthy' 
      ? HttpStatus.OK 
      : HttpStatus.SERVICE_UNAVAILABLE;
    
    res.status(statusCode).json(result);
  }

  /**
   * Readiness probe - can this service accept traffic?
   * Used by load balancers to determine if requests should be routed here.
   * 
   * Response codes:
   * - 200: Ready to accept traffic
   * - 503: Not ready
   */
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const result = await this.healthService.isReady();
    const statusCode = result.ready 
      ? HttpStatus.OK 
      : HttpStatus.SERVICE_UNAVAILABLE;
    
    res.status(statusCode).json(result);
  }

  /**
   * Liveness probe - is this service running?
   * Used by orchestrators to determine if the container should be restarted.
   * 
   * Response codes:
   * - 200: Service is alive
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { alive: boolean; timestamp: string } {
    return this.healthService.isAlive();
  }
}


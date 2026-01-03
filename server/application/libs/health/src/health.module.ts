/**
 * Health Check Module
 * 
 * Provides Kubernetes-compatible health endpoints for ECS services:
 * - /health       - Overall health status with dependency checks
 * - /health/ready - Readiness probe (service can accept traffic)
 * - /health/live  - Liveness probe (service is running)
 * 
 * @see https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
 */

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}


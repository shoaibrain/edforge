/**
 * Health Check Service
 * 
 * Provides health check functionality for ECS services with 
 * dependency verification (DynamoDB, EventBridge, etc.)
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, DescribeEventBusCommand } from '@aws-sdk/client-eventbridge';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  checks: {
    [key: string]: {
      status: 'up' | 'down';
      latency?: number;
      message?: string;
    };
  };
}

export interface DependencyConfig {
  name: string;
  type: 'dynamodb' | 'eventbridge' | 'http' | 'custom';
  endpoint?: string;
  tableName?: string;
  eventBusName?: string;
  check?: () => Promise<boolean>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private readonly serviceName: string;
  private readonly serviceVersion: string;
  private dependencies: DependencyConfig[] = [];

  constructor() {
    this.serviceName = process.env.SERVICE_NAME || 'unknown-service';
    this.serviceVersion = process.env.npm_package_version || '0.0.0';
  }

  /**
   * Register dependencies to check during health probes
   */
  registerDependencies(dependencies: DependencyConfig[]): void {
    this.dependencies = dependencies;
    this.logger.log(`Registered ${dependencies.length} health check dependencies`);
  }

  /**
   * Get comprehensive health status including all dependency checks
   */
  async getHealthStatus(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    let allHealthy = true;
    let anyDown = false;

    // Check each registered dependency
    for (const dep of this.dependencies) {
      const startTime = Date.now();
      try {
        const isUp = await this.checkDependency(dep);
        checks[dep.name] = {
          status: isUp ? 'up' : 'down',
          latency: Date.now() - startTime,
        };
        if (!isUp) {
          allHealthy = false;
          anyDown = true;
        }
      } catch (error) {
        checks[dep.name] = {
          status: 'down',
          latency: Date.now() - startTime,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
        allHealthy = false;
        anyDown = true;
      }
    }

    let status: HealthCheckResult['status'];
    if (anyDown) {
      status = 'unhealthy';
    } else if (!allHealthy) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      service: this.serviceName,
      version: this.serviceVersion,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks,
    };
  }

  /**
   * Simple liveness check - is the service running?
   */
  isAlive(): { alive: boolean; timestamp: string } {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness check - can the service accept traffic?
   */
  async isReady(): Promise<{ ready: boolean; timestamp: string; message?: string }> {
    try {
      // Check if all critical dependencies are available
      const health = await this.getHealthStatus();
      const ready = health.status !== 'unhealthy';
      
      return {
        ready,
        timestamp: new Date().toISOString(),
        message: ready ? undefined : 'One or more dependencies are down',
      };
    } catch (error) {
      return {
        ready: false,
        timestamp: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Health check failed',
      };
    }
  }

  /**
   * Check a single dependency
   */
  private async checkDependency(dep: DependencyConfig): Promise<boolean> {
    switch (dep.type) {
      case 'dynamodb':
        return this.checkDynamoDB(dep);
      case 'eventbridge':
        return this.checkEventBridge(dep);
      case 'http':
        return this.checkHttp(dep);
      case 'custom':
        return dep.check ? dep.check() : true;
      default:
        return true;
    }
  }

  /**
   * Check DynamoDB table availability
   */
  private async checkDynamoDB(dep: DependencyConfig): Promise<boolean> {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.DYNAMODB_ENDPOINT,
    });

    try {
      const tableName = dep.tableName || process.env.TABLE_NAME;
      if (!tableName) {
        this.logger.warn('No table name configured for DynamoDB health check');
        return true;
      }

      const response = await client.send(
        new DescribeTableCommand({ TableName: tableName })
      );
      
      return response.Table?.TableStatus === 'ACTIVE';
    } catch (error) {
      this.logger.error(`DynamoDB health check failed: ${error}`);
      return false;
    } finally {
      client.destroy();
    }
  }

  /**
   * Check EventBridge bus availability
   */
  private async checkEventBridge(dep: DependencyConfig): Promise<boolean> {
    const client = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.EVENTBRIDGE_ENDPOINT,
    });

    try {
      const busName = dep.eventBusName || process.env.EVENT_BUS_NAME;
      if (!busName) {
        this.logger.warn('No event bus name configured for EventBridge health check');
        return true;
      }

      await client.send(
        new DescribeEventBusCommand({ Name: busName })
      );
      
      return true;
    } catch (error) {
      // EventBridge might not exist in local dev, treat as non-critical
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn(`EventBridge health check skipped in dev: ${error}`);
        return true;
      }
      this.logger.error(`EventBridge health check failed: ${error}`);
      return false;
    } finally {
      client.destroy();
    }
  }

  /**
   * Check HTTP endpoint availability
   */
  private async checkHttp(dep: DependencyConfig): Promise<boolean> {
    if (!dep.endpoint) {
      return true;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(dep.endpoint, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      this.logger.error(`HTTP health check failed for ${dep.endpoint}: ${error}`);
      return false;
    }
  }
}


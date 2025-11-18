/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Assessment Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Assessment & Evaluation bounded context
 * - Assignment and Grading modules
 * - Shared DynamoDB table with School Service
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssignmentModule } from './assignment/assignment.module';
import { GradingModule } from './grading/grading.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('assessment')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'assessment-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['assignment', 'grading']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    AssignmentModule,
    GradingModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}


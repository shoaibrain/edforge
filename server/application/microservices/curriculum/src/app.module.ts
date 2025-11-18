/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Curriculum Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Curriculum & Instruction bounded context
 * - Classroom and Stream modules
 * - Shared DynamoDB table with School Service
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClassroomModule } from './classroom/classroom.module';
import { StreamModule } from './stream/stream.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('curriculum')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'curriculum-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['classroom', 'stream']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    ClassroomModule,
    StreamModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}


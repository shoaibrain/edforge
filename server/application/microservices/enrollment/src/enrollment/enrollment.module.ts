/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Module
 */

import { Module } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service';
import { EnrollmentController } from './enrollment.controller';
import { StudentModule } from '../student/student.module';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { ValidationService } from '../common/services/validation.service';
import { FinanceHttpClientService } from '../common/services/finance-http-client.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    StudentModule
  ],
  controllers: [EnrollmentController],
  providers: [
    EnrollmentService,
    DynamoDBClientService,
    ValidationService,
    FinanceHttpClientService
  ],
  exports: [EnrollmentService]
})
export class EnrollmentModule {}


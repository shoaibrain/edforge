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
import { CurriculumHttpClientService } from '../common/services/curriculum-http-client.service';
import { EnrollmentEventsService } from '../common/services/enrollment-events.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';
import { HttpClientModule } from '@app/http-client';
import { CsvParserModule } from '@app/csv-parser';
import { CacheModule } from '@app/cache';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    HttpClientModule, // Import HTTP client module for Finance Service calls
    CsvParserModule, // Import CSV parser for export functionality
    CacheModule, // Import cache module for performance optimization
    StudentModule
  ],
  controllers: [EnrollmentController],
  providers: [
    EnrollmentService,
    DynamoDBClientService,
    ValidationService,
    FinanceHttpClientService,
    CurriculumHttpClientService,
    EnrollmentEventsService
  ],
  exports: [EnrollmentService]
})
export class EnrollmentModule {}


/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Module
 */

import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { ValidationService } from '../common/services/validation.service';
import { StaffEventsService } from '../common/services/staff-events.service';
import { SchoolHttpClientService } from '../common/services/school-http-client.service';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    HttpClientModule,
    ConfigModule.forRoot({ isGlobal: true })
  ],
  controllers: [StaffController],
  providers: [
    StaffService,
    DynamoDBClientService,
    ValidationService,
    StaffEventsService,
    SchoolHttpClientService
  ],
  exports: [StaffService]
})
export class StaffModule {}


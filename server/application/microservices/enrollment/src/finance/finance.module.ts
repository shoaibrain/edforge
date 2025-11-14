/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Module
 */

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { FinanceSchedulerService } from './finance-scheduler.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { ValidationService } from '../common/services/validation.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true })
  ],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FinanceSchedulerService,
    DynamoDBClientService,
    ValidationService
  ],
  exports: [FinanceService]
})
export class FinanceModule {}


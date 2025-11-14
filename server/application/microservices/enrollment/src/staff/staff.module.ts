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
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true })
  ],
  controllers: [StaffController],
  providers: [
    StaffService,
    DynamoDBClientService,
    ValidationService
  ],
  exports: [StaffService]
})
export class StaffModule {}


/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Module
 */

import { Module } from '@nestjs/common';
import { ParentService } from './parent.service';
import { ParentController } from './parent.controller';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { ValidationService } from '../common/services/validation.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true })
  ],
  controllers: [ParentController],
  providers: [
    ParentService,
    DynamoDBClientService,
    ValidationService
  ],
  exports: [ParentService]
})
export class ParentModule {}


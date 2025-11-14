/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Student Module
 */

import { Module } from '@nestjs/common';
import { StudentService } from './student.service';
import { StudentController } from './student.controller';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { ValidationService } from '../common/services/validation.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true })
  ],
  controllers: [StudentController],
  providers: [
    StudentService,
    DynamoDBClientService,
    ValidationService
  ],
  exports: [StudentService]
})
export class StudentModule {}


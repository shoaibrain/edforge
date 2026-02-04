/**
 * Academic Years Module - Academic year management for Identity Service
 */

import { Module } from '@nestjs/common';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

@Module({
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService, DynamoDBClientService],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}


/**
 * School Years Module - Tenant-level school year aggregation
 */

import { Module } from '@nestjs/common';
import { SchoolYearsController } from './school-years.controller';
import { SchoolYearsService } from './school-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

@Module({
  controllers: [SchoolYearsController],
  providers: [SchoolYearsService, DynamoDBClientService],
  exports: [SchoolYearsService],
})
export class SchoolYearsModule {}


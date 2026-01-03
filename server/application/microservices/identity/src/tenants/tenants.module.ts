/**
 * Tenants Module for Identity Service
 */

import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [TenantsService, DynamoDBClientService],
  exports: [TenantsService],
})
export class TenantsModule {}


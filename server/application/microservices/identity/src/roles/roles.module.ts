/**
 * Roles Module
 */

import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [RolesService, DynamoDBClientService],
  exports: [RolesService],
})
export class RolesModule {}


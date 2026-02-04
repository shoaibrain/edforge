/**
 * Sessions Module
 */

import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [SessionsController],
  providers: [SessionsService, DynamoDBClientService],
  exports: [SessionsService],
})
export class SessionsModule {}


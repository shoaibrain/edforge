/**
 * Auth Module
 */

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule as SharedAuthModule } from '@app/auth';
import { IdentityAnalyticsEventsModule } from '../common/services/identity-analytics-events.module';

@Module({
  imports: [SharedAuthModule, IdentityAnalyticsEventsModule],
  controllers: [AuthController],
  providers: [AuthService, DynamoDBClientService],
  exports: [AuthService],
})
export class AuthModule {}


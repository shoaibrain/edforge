/**
 * Auth Module
 */

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule as SharedAuthModule } from '@app/auth';
import { IdentityAnalyticsEventsModule } from '../common/services/identity-analytics-events.module';
import { SecurityModule } from '../security/security.module';

@Module({
  // SecurityModule exports SecurityService, which AuthService uses to persist
  // login-history rows (success + failed attempts). SecurityModule imports
  // nothing that leads back to AuthModule, so there is no circular dependency.
  imports: [SharedAuthModule, IdentityAnalyticsEventsModule, SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, DynamoDBClientService],
  exports: [AuthService],
})
export class AuthModule {}


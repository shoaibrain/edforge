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
  // SecurityModule (exports SecurityService) is imported so AuthService can
  // record login attempts into the user-facing login-history. No cycle:
  // SecurityService depends only on DynamoDBClientService.
  imports: [SharedAuthModule, IdentityAnalyticsEventsModule, SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, DynamoDBClientService],
  exports: [AuthService],
})
export class AuthModule {}


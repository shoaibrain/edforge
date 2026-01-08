/**
 * Security Module - User security management
 * 
 * Provides endpoints under /users/{userId}/security/* for:
 * - Security overview
 * - Password management
 * - MFA setup/verification/disable
 * - Session management
 * - Login history
 */

import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

@Module({
  controllers: [SecurityController],
  providers: [SecurityService, DynamoDBClientService],
  exports: [SecurityService],
})
export class SecurityModule {}


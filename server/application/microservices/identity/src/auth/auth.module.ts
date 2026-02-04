/**
 * Auth Module
 */

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule as SharedAuthModule } from '@app/auth';

@Module({
  imports: [SharedAuthModule],
  controllers: [AuthController],
  providers: [AuthService, DynamoDBClientService],
  exports: [AuthService],
})
export class AuthModule {}


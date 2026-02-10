/**
 * Users Module
 * 
 * Provides user management functionality with Cognito integration
 * and event publishing for cross-service communication.
 */

import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthModule } from '@app/auth';
import { AuthModule as LocalAuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [AuthModule, LocalAuthModule, RolesModule, forwardRef(() => StaffModule)],
  controllers: [UsersController],
  providers: [UsersService, DynamoDBClientService, IdentityEventsService],
  exports: [UsersService],
})
export class UsersModule {}

/**
 * Schools Module for Identity Service
 * 
 * Provides school management, configuration, and department functionality
 * with event publishing for cross-service communication.
 */

import { Module, forwardRef } from '@nestjs/common';
import { SchoolsController } from './schools.controller';
import { SchoolUsersController } from './school-users.controller';
import { SchoolsService } from './schools.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthModule } from '@app/auth';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuthModule, RolesModule, forwardRef(() => UsersModule)],
  controllers: [SchoolsController, SchoolUsersController],
  providers: [SchoolsService, DynamoDBClientService, IdentityEventsService],
  exports: [SchoolsService],
})
export class SchoolsModule {}

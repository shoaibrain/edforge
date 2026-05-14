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
import { AuditedWriteService } from '../common/services/audited-write.service';
import { AuthModule } from '@app/auth';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuthModule, RolesModule, forwardRef(() => UsersModule)],
  controllers: [SchoolsController, SchoolUsersController],
  // S0.8 hotfix: AuditedWriteService is injected by SchoolsService for
  // status_change and config-update audit emission. NestJS scopes providers
  // per module — must be declared here even though IdentityModule also
  // provides it (children don't inherit root providers). Same prod-down
  // incident as AcademicYearsModule 2026-05-14.
  providers: [SchoolsService, DynamoDBClientService, IdentityEventsService, AuditedWriteService],
  exports: [SchoolsService],
})
export class SchoolsModule {}

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
import { MasterScheduleModule } from './master-schedule.module';

@Module({
  // C.3 — import MasterScheduleModule so SchoolsService can call
  // BellScheduleService.applyPreset() to seed the archetype default at
  // school-create. MasterScheduleModule has no back-import on SchoolsModule,
  // so no circular dependency.
  imports: [AuthModule, RolesModule, forwardRef(() => UsersModule), MasterScheduleModule],
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

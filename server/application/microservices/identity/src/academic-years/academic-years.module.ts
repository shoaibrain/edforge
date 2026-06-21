/**
 * Academic Years Module - Academic year management for Identity Service
 */

import { Module, forwardRef } from '@nestjs/common';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RolesService } from '../roles/roles.service';
import { CalendarModule } from '../schools/calendar.module';

@Module({
  imports: [
    forwardRef(() => CalendarModule),  // AcademicSessionService for grading period validation
  ],
  controllers: [AcademicYearsController],
  // S0.8 hotfix: common services injected by AcademicYearsService MUST be
  // declared on THIS module's providers array. The root IdentityModule's
  // `providers + exports` only propagates to modules that explicitly import
  // IdentityModule — which child modules do not. This is the same pattern
  // already used for DynamoDBClientService below.
  // Prod-down incident 2026-05-14: NestJS DI failed at bootstrap because
  // AuditedWriteService was only on IdentityModule, not here.
  providers: [
    AcademicYearsService,
    DynamoDBClientService,
    AuditedWriteService,
    // P0 authz — AcademicYearsController gated by PermissionGuard + `scheduling:*`.
    // RolesService injects DynamoDBClientService (above) + IdentityEventsService.
    IdentityEventsService,
    PermissionGuard,
    RolesService,
  ],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}


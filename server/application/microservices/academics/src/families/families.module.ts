/**
 * FamiliesModule — EPIC-FB Sprint FB-1.6
 *
 * **Module-wiring discipline (per [[feedback_module_wiring_invariant]]):**
 * Every academics module that uses `PermissionGuard` MUST also declare
 * `IdentityClientService` in providers (root-module exports do NOT
 * propagate). The academics module-wiring spec
 * (`__tests__/module-wiring.spec.ts`) is extended in the SAME PR to
 * register this module.
 *
 * No AcademicsEventsService: family EventBridge events were dropped as
 * consumer-less by the epic's adversarial review (Appendix B #9) — audit
 * is structured logger lines in FamiliesService.
 */

import { Module } from '@nestjs/common';
import { FamiliesController, StudentFamilyController } from './families.controller';
import { FamiliesService } from './families.service';
import { FamilyGroupsFlagGuard } from './family-groups-flag.guard';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [FamiliesController, StudentFamilyController],
  providers: [
    FamiliesService,
    FamilyGroupsFlagGuard,
    DynamoDBClientService,
    // PermissionGuard injects IdentityClientService — must be declared here
    // (not inherited from root). See module-wiring.spec.ts.
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [FamiliesService],
})
export class FamiliesModule {}

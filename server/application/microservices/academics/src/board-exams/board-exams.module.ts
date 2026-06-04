/**
 * BoardExamsModule — Sprint GB2.
 *
 * **Module-wiring discipline (per [[feedback_module_wiring_invariant]]):**
 * `BoardExamsService` injects `IdentityClientService` (for `getSchool` grade-
 * gating), which in turn needs `HttpClientModule`/`AuthModule`. Root-module
 * exports do NOT propagate, so `IdentityClientService` + `DynamoDBClientService`
 * are declared here, and this module is registered in
 * `__tests__/module-wiring.spec.ts` in the same PR. The controller (GB2.3)
 * adds `PermissionGuard` + `DataScopeService` when it lands.
 */

import { Module } from '@nestjs/common';
import { BoardExamsService } from './board-exams.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, HttpClientModule],
  providers: [BoardExamsService, DynamoDBClientService, IdentityClientService],
  exports: [BoardExamsService],
})
export class BoardExamsModule {}

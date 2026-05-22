/**
 * ReportingSnapshot Module — Sprint E.1 (V1 Master EPIC Breakdown).
 *
 * CEHRD IEMIS Flash I/II + future external-authority report submission.
 *
 * Self-contained providers per the module-wiring invariant
 * (memory `feedback_module_wiring_invariant`): module declares its own
 * DynamoDBClientService + AuditedWriteService + IdentityEventsService
 * dependencies rather than relying on root-module export propagation.
 */

import { Module } from '@nestjs/common';
import { ReportingSnapshotController } from './reporting-snapshot.controller';
import { ReportingSnapshotService } from './reporting-snapshot.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { IdentityEventsService } from '../common/services/identity-events.service';

@Module({
  controllers: [ReportingSnapshotController],
  providers: [
    ReportingSnapshotService,
    // Required dependencies declared here so feature module's DI graph
    // doesn't depend on root IdentityModule's exports (per the
    // module-wiring invariant; prod-down twice without this).
    DynamoDBClientService,
    AuditedWriteService,
    IdentityEventsService,
  ],
  exports: [ReportingSnapshotService],
})
export class ReportingSnapshotModule {}

import { forwardRef, Module } from '@nestjs/common';
import { CalendarBlockController } from './calendar-block.controller';
import { CalendarBlockService } from './calendar-block.service';
import { AcademicYearsModule } from '../academic-years/academic-years.module';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuditedWriteService } from '../common/services/audited-write.service';

/**
 * Sprint C4 — Multi-Day Event Blocks. Block CRUD + cascade-delete +
 * audit. Reads AY metadata via AcademicYearsService for range validation.
 *
 * **Common services must be declared on this module's `providers` list**,
 * not inherited from root IdentityModule. Per the S0 retro hotfix lesson
 * (PR #59, mirrored in calendar.module.ts:40-44): root IdentityModule's
 * exports do NOT propagate to child modules that don't explicitly import
 * IdentityModule. The C4 deploy-day incident on 2026-05-17 hit this
 * exactly — identity tasks crash-looped with
 *   "Nest can't resolve dependencies of the CalendarBlockService (?, …).
 *    Please make sure that the argument DynamoDBClientService at index [0]
 *    is available in the CalendarBlockModule context."
 * because the original module only imported AcademicYearsModule.
 *
 * AcademicYearsModule's `forwardRef` provides AcademicYearsService;
 * everything else (DDB client, audit emitter) is re-declared here.
 */
@Module({
  imports: [forwardRef(() => AcademicYearsModule)],
  controllers: [CalendarBlockController],
  providers: [
    CalendarBlockService,
    DynamoDBClientService,
    AuditedWriteService,
  ],
  exports: [CalendarBlockService],
})
export class CalendarBlockModule {}

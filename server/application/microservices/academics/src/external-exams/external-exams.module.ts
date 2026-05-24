/**
 * ExternalExamsModule — Sprint D.3.6
 *
 * Module shell for the D.3 ExternalAssessment foundation. D.3 ships no
 * providers / controllers; they land in:
 *   - D.4 (BLE Grade 8)        — BleRegistrationController, BleResultsController, etc.
 *   - D.5 (SEE Grade 10)       — SeeRegistrationController, SeeResultsController
 *   - D.6 (NEB Grade 11/12)    — NebRegistrationController, NebResultsController
 *
 * The shell is registered NOW in `academics.module.ts.imports[]` so the
 * post-A.4 module-wiring invariant ([[feedback-module-wiring-invariant]])
 * is honored at the moment the module is introduced, not retrofitted
 * later.
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.6
 */

import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class ExternalExamsModule {}

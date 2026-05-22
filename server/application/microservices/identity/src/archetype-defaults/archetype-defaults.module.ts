import { Module } from '@nestjs/common';
import { ArchetypeDefaultsController } from './archetype-defaults.controller';
import { ArchetypeDefaultsService } from './archetype-defaults.service';

/**
 * Archetype defaults module — Sprint 0.4 (V1 Master EPIC Breakdown).
 *
 * Static data lookup over the shared-types ARCHETYPE_DEFAULTS_TABLE.
 * No DDB, no per-tenant state, no audit writes. Follows the
 * HolidaySeedModule precedent (C3.3).
 *
 * Service is exported so EPIC-D feature modules (academics + identity
 * GradingPolicy, PromotionRule, ExternalAssessment) can inject it.
 */
@Module({
  controllers: [ArchetypeDefaultsController],
  providers: [ArchetypeDefaultsService],
  exports: [ArchetypeDefaultsService],
})
export class ArchetypeDefaultsModule {}

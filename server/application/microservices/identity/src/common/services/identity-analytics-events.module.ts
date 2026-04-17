/**
 * Small module exposing `IdentityAnalyticsEventsService` to identity
 * submodules (auth, sessions, users, staff). The underlying
 * `AnalyticsEventsService` comes from the @Global()
 * `AnalyticsEventsModule`, so this just wraps + re-exports the identity
 * adapter.
 */

import { Module } from '@nestjs/common';
import { AnalyticsEventsModule } from '@app/analytics-events';
import { IdentityAnalyticsEventsService } from './identity-analytics-events.service';

@Module({
  imports: [AnalyticsEventsModule],
  providers: [IdentityAnalyticsEventsService],
  exports: [IdentityAnalyticsEventsService],
})
export class IdentityAnalyticsEventsModule {}

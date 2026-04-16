/**
 * AnalyticsEventsModule — global NestJS module that exposes
 * `AnalyticsEventsService` to every microservice that imports it.
 *
 * Layer 4 consumers (identity auth/sessions, feature-usage interceptor,
 * audit-logger bridge) will import this module and inject the service.
 * Flag-gated: the service respects `ANALYTICS_ENABLED` internally, so
 * consumers never need to gate their call sites themselves.
 */

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsEventsService } from './analytics-events.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [AnalyticsEventsService],
  exports: [AnalyticsEventsService],
})
export class AnalyticsEventsModule {}

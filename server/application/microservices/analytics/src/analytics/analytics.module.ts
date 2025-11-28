import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';
import { AthenaQueryService } from '../common/services/athena-query.service';

@Module({
  imports: [AuthModule, ClientFactoryModule, ConfigModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AthenaQueryService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}


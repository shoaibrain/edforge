import { Module } from '@nestjs/common';
import { HolidaySeedController } from './holiday-seed.controller';

/**
 * Holiday seed lookup — static data table backed by `HOLIDAY_SEEDS`
 * in shared-types. No service layer (pure resolver), no DDB.
 */
@Module({
  controllers: [HolidaySeedController],
  providers: [],
  exports: [],
})
export class HolidaySeedModule {}

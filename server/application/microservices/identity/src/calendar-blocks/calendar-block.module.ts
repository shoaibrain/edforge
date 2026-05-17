import { forwardRef, Module } from '@nestjs/common';
import { CalendarBlockController } from './calendar-block.controller';
import { CalendarBlockService } from './calendar-block.service';
import { AcademicYearsModule } from '../academic-years/academic-years.module';

/**
 * Sprint C4 — Multi-Day Event Blocks. Block CRUD + cascade-delete +
 * audit. Reads AY metadata via AcademicYearsService for range validation.
 */
@Module({
  imports: [forwardRef(() => AcademicYearsModule)],
  controllers: [CalendarBlockController],
  providers: [CalendarBlockService],
  exports: [CalendarBlockService],
})
export class CalendarBlockModule {}

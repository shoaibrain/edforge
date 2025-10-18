import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { ValidationService } from './services/validation.service';
import { CalculationService } from './services/calculation.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [GradingController],
  providers: [GradingService, ValidationService, CalculationService],
  exports: [GradingService, CalculationService],
})
export class GradingModule {}


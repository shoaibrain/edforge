import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { ValidationService } from './services/validation.service';
import { CalculationService } from './services/calculation.service';
import { GPACalculationService } from './services/gpa-calculation.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';
import { DynamoDBClientService } from '../common/dynamodb-client.service';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [GradingController],
  providers: [
    GradingService, 
    ValidationService, 
    CalculationService, 
    GPACalculationService,
    DynamoDBClientService
  ],
  exports: [GradingService, CalculationService, GPACalculationService],
})
export class GradingModule {}


import { Module } from '@nestjs/common';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { ValidationService } from './services/validation.service';
import { AssessmentEventsService } from '../common/services/assessment-events.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';
import { DynamoDBClientService } from '../common/dynamodb-client.service';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [AssignmentController],
  providers: [AssignmentService, ValidationService, AssessmentEventsService, DynamoDBClientService],
  exports: [AssignmentService],
})
export class AssignmentModule {}


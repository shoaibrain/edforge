/**
 * StaffTrainings Module — Identity Service (Sprint B.5)
 *
 * Provides staff professional development / training CRUD with IEMIS audit
 * emit on every write. Imports IemisModule (S4.7) so the service can emit
 * `staff.training.{created,edited,deleted}` events without re-instantiating
 * the logger.
 *
 * Routes are registered under `/staff/:staffId/trainings` and depend on the
 * StaffModule's existing JwtAuthGuard + tenant context decorators.
 */

import { Module } from '@nestjs/common';
import { StaffTrainingsService } from './staff-trainings.service';
import { StaffTrainingsController } from './staff-trainings.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IemisModule } from '../iemis/iemis.module';

@Module({
  imports: [IemisModule],
  controllers: [StaffTrainingsController],
  providers: [StaffTrainingsService, DynamoDBClientService],
  exports: [StaffTrainingsService],
})
export class StaffTrainingsModule {}

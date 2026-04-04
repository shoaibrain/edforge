import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { FeeStructuresController } from './fee-structures.controller';
import { FeeStructuresService } from './fee-structures.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [FeeStructuresController],
  providers: [
    FeeStructuresService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [FeeStructuresService],
})
export class FeeStructuresModule {}

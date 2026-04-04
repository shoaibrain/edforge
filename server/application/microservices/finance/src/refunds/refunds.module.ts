import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [RefundsController],
  providers: [
    RefundsService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [RefundsService],
})
export class RefundsModule {}

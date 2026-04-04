import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { DiscountRulesController } from './discount-rules.controller';
import { DiscountRulesService } from './discount-rules.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [DiscountRulesController],
  providers: [
    DiscountRulesService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [DiscountRulesService],
})
export class DiscountRulesModule {}

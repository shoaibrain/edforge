import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [CreditNotesController],
  providers: [
    CreditNotesService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}

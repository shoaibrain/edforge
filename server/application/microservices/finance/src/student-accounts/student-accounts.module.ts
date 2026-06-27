import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { StudentAccountsController } from './student-accounts.controller';
import { StudentAccountsService } from './student-accounts.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [StudentAccountsController],
  providers: [
    StudentAccountsService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    // Pilot Onboarding Hardening Sprint PD.1.4 — StudentAccountsService.setOpeningBalance
    // emits `finance.opening_balance.set` + `finance.opening_balance.revised`.
    // Declared locally (NOT relying on FinanceAuditModule's export) because
    // root-module exports do not propagate to child modules per the
    // CLAUDE.md `feedback_module_wiring_invariant`.
    FinanceAuditService,
    PermissionGuard,
  ],
  exports: [StudentAccountsService],
})
export class StudentAccountsModule {}

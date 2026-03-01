import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DynamoDBClientService,
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}

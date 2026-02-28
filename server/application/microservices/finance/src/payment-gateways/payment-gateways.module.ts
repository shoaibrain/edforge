import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { PaymentGatewaysController } from './payment-gateways.controller';
import { PaymentGatewaysService } from './payment-gateways.service';
import { EsewaAdapter } from './adapters/esewa.adapter';
import { KhaltiAdapter } from './adapters/khalti.adapter';
import { GatewayAdapterRegistryService } from './adapters/gateway-adapter-registry.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [PaymentGatewaysController],
  providers: [
    PaymentGatewaysService,
    EsewaAdapter,
    KhaltiAdapter,
    GatewayAdapterRegistryService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    PermissionGuard,
  ],
  exports: [PaymentGatewaysService, GatewayAdapterRegistryService],
})
export class PaymentGatewaysModule {}

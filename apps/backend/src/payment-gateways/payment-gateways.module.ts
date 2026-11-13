import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../modules/orders/orders.module';
import {
  GatewayPaymentsController,
  GatewayPaymentsPublicController,
} from './gateway-payments.controller';
import { GatewayPaymentsService } from './gateway-payments.service';
import { PaymentGatewaysController } from './payment-gateways.controller';
import { PaymentGatewaysService } from './payment-gateways.service';

@Module({
  imports: [AuditModule, OrdersModule],
  controllers: [
    PaymentGatewaysController,
    GatewayPaymentsController,
    GatewayPaymentsPublicController,
  ],
  providers: [PaymentGatewaysService, GatewayPaymentsService],
  exports: [PaymentGatewaysService, GatewayPaymentsService],
})
export class PaymentGatewaysModule {}

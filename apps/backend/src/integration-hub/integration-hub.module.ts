import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../modules/orders/orders.module';
import { AggregatorOrdersService } from './aggregator-orders.service';
import { IntegrationHubWebhookController } from './integration-hub.webhook.controller';
import { IntegrationHubController } from './integration-hub.controller';
import { IntegrationHubService } from './integration-hub.service';

@Module({
  imports: [AuditModule, OrdersModule],
  controllers: [IntegrationHubController, IntegrationHubWebhookController],
  providers: [IntegrationHubService, AggregatorOrdersService],
  exports: [IntegrationHubService],
})
export class IntegrationHubModule {}

import { Module } from '@nestjs/common';
import { BranchAccessService } from '../common/services/branch-access.service';
import { IntegrationApiKeyGuard } from '../common/guards/integration-api-key.guard';
import { OrdersModule } from '../modules/orders/orders.module';
import { ReservationsModule } from '../modules/reservations/reservations.module';
import { IntegrationApiKeysController } from './integration-api-keys.controller';
import { IntegrationApiKeysService } from './integration-api-keys.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { StaffApiKeysController } from './staff-api-keys.controller';
import { StaffApiKeysService } from './staff-api-keys.service';

@Module({
  imports: [OrdersModule, ReservationsModule],
  controllers: [IntegrationsController, IntegrationApiKeysController, StaffApiKeysController],
  providers: [
    IntegrationsService,
    IntegrationApiKeysService,
    StaffApiKeysService,
    IntegrationApiKeyGuard,
    BranchAccessService,
  ],
})
export class IntegrationsModule {}

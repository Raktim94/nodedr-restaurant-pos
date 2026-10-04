import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MarketingModule } from '../marketing/marketing.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ScheduledOrdersService } from './scheduled-orders.service';

@Module({
  imports: [
    GiftCardsModule,
    InventoryModule,
    AuditModule,
    NotificationsModule,
    MarketingModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, ScheduledOrdersService, BranchAccessService],
  exports: [OrdersService],
})
export class OrdersModule {}

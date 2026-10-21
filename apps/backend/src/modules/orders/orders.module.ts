import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MarketingModule } from '../marketing/marketing.module';
import { VerifactuModule } from '../verifactu/verifactu.module';
import { KotPrintService } from './kot-print.service';
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
    VerifactuModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    KotPrintService,
    ScheduledOrdersService,
    BranchAccessService,
  ],
  exports: [OrdersService, KotPrintService],
})
export class OrdersModule {}

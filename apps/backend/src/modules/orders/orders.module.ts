import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [GiftCardsModule, InventoryModule, AuditModule],
  controllers: [OrdersController],
  providers: [OrdersService, BranchAccessService],
  exports: [OrdersService],
})
export class OrdersModule {}

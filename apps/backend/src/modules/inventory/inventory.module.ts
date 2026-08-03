import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockService } from './stock.service';
import { WasteService } from './waste.service';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    WasteService,
    StockService,
    BranchAccessService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}

import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { StockService } from './stock.service';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierQuotationsService } from './supplier-quotations.service';
import { WasteService } from './waste.service';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    WasteService,
    StockService,
    PurchaseRequestsService,
    SupplierQuotationsService,
    SupplierInvoicesService,
    BranchAccessService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}

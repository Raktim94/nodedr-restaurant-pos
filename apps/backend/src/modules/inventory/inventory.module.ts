import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { StockService } from './stock.service';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierQuotationsService } from './supplier-quotations.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { ProductionService } from './production.service';
import { ManufacturingService } from './manufacturing.service';
import { StockLocationsService } from './stock-locations.service';
import { StockJournalController } from './stock-journal.controller';
import { StockJournalService } from './stock-journal.service';
import { WasteEntriesService } from './waste-entries.service';
import { WasteService } from './waste.service';

@Module({
  imports: [AuditModule],
  controllers: [InventoryController, TransfersController, StockJournalController],
  providers: [
    InventoryService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    WasteService,
    ProductionService,
    StockJournalService,
    StockLocationsService,
    ManufacturingService,
    WasteEntriesService,
    StockService,
    TransfersService,
    PurchaseRequestsService,
    SupplierQuotationsService,
    SupplierInvoicesService,
    BranchAccessService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}

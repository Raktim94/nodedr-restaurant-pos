import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  goodsReceiptSchema,
  ingredientSchema,
  purchaseOrderSchema,
  setRecipeSchema,
  stockAdjustmentSchema,
  supplierSchema,
  wasteLogSchema,
  type PurchaseOrderStatus,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { InventoryService } from './inventory.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockService } from './stock.service';
import { WasteService } from './waste.service';

@ApiTags('inventory')
@Controller('v1/inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly goodsReceiptsService: GoodsReceiptsService,
    private readonly wasteService: WasteService,
    private readonly stockService: StockService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // --- Ingredients ------------------------------------------------------------

  @Auth('inventory.manage')
  @Get('ingredients')
  async listIngredients(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.listIngredients(branchId);
  }

  @Auth('inventory.manage')
  @Get('ingredients/low-stock')
  async lowStockIngredients(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.lowStockIngredients(branchId);
  }

  @Auth('inventory.manage')
  @Get('ingredients/:id')
  async getIngredient(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.getIngredient(branchId, id);
  }

  @Auth('inventory.manage')
  @Post('ingredients')
  @UsePipes(new ZodValidationPipe(ingredientSchema))
  async createIngredient(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.createIngredient(branchId, body as never);
  }

  @Auth('inventory.manage')
  @Patch('ingredients/:id')
  async updateIngredient(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.updateIngredient(branchId, id, body as never);
  }

  @Auth('inventory.manage')
  @Delete('ingredients/:id')
  async deleteIngredient(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.deleteIngredient(branchId, id);
  }

  @Auth('inventory.manage')
  @Post('ingredients/:id/adjust')
  @UsePipes(new ZodValidationPipe(stockAdjustmentSchema))
  async adjustStock(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.stockService.adjustStock(branchId, user.id, id, body as never);
  }

  @Auth('inventory.manage')
  @Get('ingredients/:id/movements')
  async listMovements(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.stockService.listMovements(branchId, id);
  }

  @Auth('inventory.manage')
  @Get('ingredients/:id/batches')
  async listBatches(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.stockService.listBatches(branchId, id);
  }

  // --- Recipe costing -----------------------------------------------------------

  @Auth('inventory.manage')
  @Get('menu-items/:id/recipe')
  async getRecipe(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.getRecipe(branchId, id);
  }

  @Auth('inventory.manage')
  @Patch('menu-items/:id/recipe')
  @UsePipes(new ZodValidationPipe(setRecipeSchema))
  async setRecipe(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { lines } = body as {
      lines: { ingredientId: string; quantity: number }[];
    };
    return this.inventoryService.setRecipe(branchId, id, lines);
  }

  // --- Suppliers ----------------------------------------------------------------

  @Auth('inventory.manage')
  @Get('suppliers')
  async listSuppliers(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.listSuppliers(branchId);
  }

  @Auth('inventory.manage')
  @Get('suppliers/:id')
  async getSupplier(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.getSupplier(branchId, id);
  }

  @Auth('inventory.manage')
  @Post('suppliers')
  @UsePipes(new ZodValidationPipe(supplierSchema))
  async createSupplier(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.createSupplier(branchId, body as never);
  }

  @Auth('inventory.manage')
  @Patch('suppliers/:id')
  async updateSupplier(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.updateSupplier(branchId, id, body as never);
  }

  @Auth('inventory.manage')
  @Delete('suppliers/:id')
  async deleteSupplier(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.inventoryService.deleteSupplier(branchId, id);
  }

  // --- Purchase orders ------------------------------------------------------------

  @Auth('inventory.manage')
  @Get('purchase-orders')
  async listPurchaseOrders(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('status') status?: PurchaseOrderStatus,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.purchaseOrdersService.listPurchaseOrders(branchId, status);
  }

  @Auth('inventory.manage')
  @Get('purchase-orders/:id')
  async getPurchaseOrder(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.purchaseOrdersService.getPurchaseOrder(branchId, id);
  }

  @Auth('inventory.manage')
  @Post('purchase-orders')
  @UsePipes(new ZodValidationPipe(purchaseOrderSchema))
  async createPurchaseOrder(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.purchaseOrdersService.createPurchaseOrder(
      branchId,
      user.id,
      body as never,
    );
  }

  @Auth('inventory.manage')
  @Patch('purchase-orders/:id/status')
  async updatePurchaseOrderStatus(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { status: PurchaseOrderStatus },
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.purchaseOrdersService.updateStatus(branchId, id, body.status);
  }

  // --- Goods receipts (GRN) -----------------------------------------------------

  @Auth('inventory.manage')
  @Get('goods-receipts')
  async listGoodsReceipts(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.goodsReceiptsService.listGoodsReceipts(branchId);
  }

  @Auth('inventory.manage')
  @Get('goods-receipts/:id')
  async getGoodsReceipt(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.goodsReceiptsService.getGoodsReceipt(branchId, id);
  }

  @Auth('inventory.manage')
  @Post('goods-receipts')
  @UsePipes(new ZodValidationPipe(goodsReceiptSchema))
  async createGoodsReceipt(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.goodsReceiptsService.createGoodsReceipt(
      branchId,
      user.id,
      body as never,
    );
  }

  // --- Waste -----------------------------------------------------------------------

  @Auth('inventory.manage')
  @Get('waste')
  async listWasteLogs(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.wasteService.listWasteLogs(branchId);
  }

  @Auth('inventory.manage')
  @Post('waste')
  @UsePipes(new ZodValidationPipe(wasteLogSchema))
  async logWaste(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.wasteService.logWaste(branchId, user.id, body as never);
  }
}

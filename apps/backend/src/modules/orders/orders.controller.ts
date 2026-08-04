import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  addOrderItemsSchema,
  checkoutSchema,
  createOrderSchema,
  mergeOrdersSchema,
  refundSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { OrdersService } from './orders.service';
import { buildReceiptHtml } from './receipt.html';

@ApiTags('orders')
@Controller('v1/orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('orders.create')
  @Get()
  async listOpen(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('tableId') tableId?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.listOpen(branchId, tableId);
  }

  @Auth('orders.create')
  @Get(':id')
  async getOrder(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.getOrder(branchId, id);
  }

  @Auth('orders.create')
  @Post()
  @UsePipes(new ZodValidationPipe(createOrderSchema))
  async createOrder(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.createOrder(branchId, user.id, body as never);
  }

  @Auth('orders.edit')
  @Post(':id/items')
  @UsePipes(new ZodValidationPipe(addOrderItemsSchema))
  async addItems(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { items } = body as { items: never };
    return this.ordersService.addItems(branchId, id, items);
  }

  @Auth('bills.print')
  @Post(':id/checkout')
  @UsePipes(new ZodValidationPipe(checkoutSchema))
  async checkout(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.checkout(branchId, id, user.id, body as never);
  }

  @Auth('bills.print')
  @Get(':id/receipt')
  async receipt(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const order = await this.ordersService.getReceiptData(branchId, id);
    const html = buildReceiptHtml({
      restaurantName: order.branch.restaurant.name,
      currency: order.branch.restaurant.currency,
      branch: {
        name: order.branch.name,
        address: order.branch.address,
        phone: order.branch.phone,
        gstNumber: order.branch.gstNumber,
      },
      order: {
        orderNumber: order.orderNumber,
        type: order.type,
        createdAt: order.createdAt,
        table: order.table
          ? { label: order.table.name ?? `#${order.table.number}` }
          : null,
        customer: order.customer
          ? {
              name: order.customer.name ?? 'Guest',
              phone: order.customer.phone,
            }
          : null,
        subtotal: Number(order.subtotal),
        discountAmount: Number(order.discountAmount),
        taxAmount: Number(order.taxAmount),
        tipAmount: Number(order.tipAmount),
        loyaltyPointsRedeemed: order.loyaltyPointsRedeemed,
        loyaltyDiscountAmount: Number(order.loyaltyDiscountAmount),
        totalAmount: Number(order.totalAmount),
        items: order.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          unitPriceSnapshot: Number(item.unitPriceSnapshot),
          lineTotal: Number(item.lineTotal),
          taxRateSnapshot: Number(item.taxRateSnapshot),
          modifiers: item.modifiers.map((m) => ({
            nameSnapshot: m.nameSnapshot,
            priceAdjSnapshot: Number(m.priceAdjSnapshot),
          })),
        })),
        payments: order.payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
        })),
      },
    });
    res.type('html').send(html);
  }

  @Auth('refunds.process')
  @Post(':id/refund')
  @UsePipes(new ZodValidationPipe(refundSchema))
  async refund(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.refund(branchId, id, user.id, body as never);
  }

  @Auth('orders.edit')
  @Post(':id/merge')
  @UsePipes(new ZodValidationPipe(mergeOrdersSchema))
  async merge(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { sourceOrderId } = body as { sourceOrderId: string };
    return this.ordersService.mergeOrders(branchId, id, sourceOrderId);
  }
}

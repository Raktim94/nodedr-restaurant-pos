import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
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
  type CheckoutDto,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import {
  buildReceiptEscPos,
  buildTestSlip,
  type EscposReceiptOrder,
} from './escpos-receipt';
import {
  PrinterNotFoundError,
  findPrinterDescriptor,
  probeCharDevices,
  sendRaw,
} from './escpos-usb';
import { OrdersService } from './orders.service';
import { buildKotHtml } from './kot.html';
import { buildReceiptHtml } from './receipt.html';

type ReceiptData = Awaited<ReturnType<OrdersService['getReceiptData']>>;

function toEscposOrder(order: ReceiptData): EscposReceiptOrder {
  return {
    orderNumber: order.orderNumber,
    type: order.type,
    createdAt: order.createdAt,
    table: order.table
      ? { label: order.table.name ?? `#${order.table.number}` }
      : null,
    customer: order.customer
      ? { name: order.customer.name ?? 'Guest', phone: order.customer.phone }
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
  };
}

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

  @Auth('orders.cancel')
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.cancelOrder(branchId, id, user.id);
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
    const dto = body as CheckoutDto;
    // `bills.print` (required above) only covers settling a bill at its
    // already-priced total — discounting it further is a distinct,
    // separately-grantable permission (see packages/types/src/permissions.ts;
    // WAITER holds bills.print but not discounts.apply by default). Without
    // this check, any role that can checkout could zero out a bill via
    // discountPercent=100, bypassing the manager/cashier-only control.
    if (
      ((dto.discountPercent ?? 0) > 0 || (dto.discountFlat ?? 0) > 0) &&
      !user.permissions.includes('discounts.apply')
    ) {
      throw new ForbiddenException(
        'Missing permission to apply a discount at checkout',
      );
    }
    return this.ordersService.checkout(branchId, id, user.id, dto);
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
      order: toEscposOrder(order),
    });
    res.type('html').send(html);
  }

  @Auth('orders.create')
  @Get(':id/kot')
  async kot(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const order = await this.ordersService.getReceiptData(branchId, id);
    const html = buildKotHtml({
      branchName: order.branch.name,
      order: {
        orderNumber: order.orderNumber,
        type: order.type,
        createdAt: order.createdAt,
        table: order.table
          ? { label: order.table.name ?? `#${order.table.number}` }
          : null,
        customer: order.customer ? { name: order.customer.name ?? 'Guest' } : null,
        items: order.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          kitchenNote: item.kitchenNote,
          modifiers: item.modifiers.map((m) => ({ nameSnapshot: m.nameSnapshot })),
        })),
      },
    });
    res.type('html').send(html);
  }

  // --- Direct-USB thermal printing (ESC/POS) ---------------------------------
  // Ported from nodedr-pos, which has real hardware to verify against; this
  // app's transport/byte-building code is identical in structure (see
  // escpos-usb.ts/escpos-receipt.ts file comments) but has only been
  // structurally verified here (module loads, correct 503 with no printer
  // attached) — no physical thermal printer in this dev environment.

  @Auth('bills.print')
  @Get('print/diagnostics')
  async printDiagnostics() {
    const lpDevices = await probeCharDevices();
    const libusbPrinter = findPrinterDescriptor();
    const canPrint = lpDevices.length > 0 || libusbPrinter !== null;
    return {
      lpDevices,
      libusbPrinter,
      canPrint,
      notes: canPrint
        ? []
        : [
            'No printer detected. On the till, check `lsusb` lists it and `ls -l /dev/usb/lp0` exists; the backend container needs the USB passthrough from docker-compose.yml (Linux host only).',
          ],
    };
  }

  @Auth('bills.print')
  @Post('print/test')
  async printTest() {
    try {
      await sendRaw(buildTestSlip());
      return { ok: true };
    } catch (err) {
      if (err instanceof PrinterNotFoundError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
  }

  @Auth('bills.print')
  @Post(':id/print/usb')
  async printUsb(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Query('width') width?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const order = await this.ordersService.getReceiptData(branchId, id);
    const buffer = buildReceiptEscPos({
      restaurantName: order.branch.restaurant.name,
      currency: order.branch.restaurant.currency,
      branch: {
        name: order.branch.name,
        address: order.branch.address,
        phone: order.branch.phone,
        gstNumber: order.branch.gstNumber,
      },
      order: toEscposOrder(order),
      width: width === '58' ? 32 : 42,
    });
    try {
      await sendRaw(buffer);
      return { ok: true };
    } catch (err) {
      if (err instanceof PrinterNotFoundError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
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

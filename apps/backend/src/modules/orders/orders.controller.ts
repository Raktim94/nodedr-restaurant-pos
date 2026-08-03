import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
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
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.ordersService.listOpen(branchId);
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

import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../common/services/branch-access.service';
import { Throttle } from '@nestjs/throttler';
import { StandaloneReservationsService } from './standalone-reservations.service';
import { StandaloneService } from './standalone.service';
import { StandaloneBooksService } from './standalone-books.service';
import {
  offlineSalesSchema,
  phoneCollectionSchema,
  phoneExpenseSchema,
  phoneRefundSchema,
  phoneTillClosingSchema,
  reservationSyncSchema,
  type OfflineSalesDto,
  type PhoneCollectionDto,
  type PhoneExpenseDto,
  type PhoneRefundDto,
  type PhoneTillClosingDto,
  type ReservationSyncDto,
} from './standalone.schema';

/**
 * Standalone mode of the phone app: the phone keeps a copy of the menu and
 * tables (snapshot), sells with no connection, and sends the sales back here
 * when it is online again. Each sale carries the phone's own id, so sending a
 * sale twice never records it twice.
 */
@ApiTags('mobile')
@Controller('v1/mobile/standalone')
export class StandaloneController {
  constructor(
    private readonly standalone: StandaloneService,
    private readonly bookings: StandaloneReservationsService,
    private readonly branchAccess: BranchAccessService,
    private readonly books: StandaloneBooksService,
  ) {}

  // Everything the phone needs to sell without the server.
  @Auth('orders.create')
  @Get('snapshot')
  async snapshot(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.standalone.snapshot(user, branchId);
  }

  // Sales taken offline. One result per sale: created, duplicate or refused.
  @Auth('orders.create', 'bills.print')
  @Post('sales')
  @UsePipes(new ZodValidationPipe(offlineSalesSchema))
  async sales(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.standalone.syncSales(user, branchId, body as OfflineSalesDto);
  }

  // Two-way bookings: the phone sends what it made or changed; each result
  // carries the server's copy, which the phone then keeps.
  @Auth('reservations.manage')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('reservations')
  @UsePipes(new ZodValidationPipe(reservationSyncSchema))
  async reservations(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.bookings.sync(branchId, body as ReservationSyncDto);
  }

  // ------------------------------------------------------------ phone books ---
  // Each takes the phone's event id (idempotencyKey); a repeat returns the first result.

  @Auth('refunds.process')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('refunds')
  @UsePipes(new ZodValidationPipe(phoneRefundSchema))
  async refund(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.books.refund(user, branchId, body as PhoneRefundDto);
  }

  @Auth('accounting.manage')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('expenses')
  @UsePipes(new ZodValidationPipe(phoneExpenseSchema))
  async expense(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.books.expense(user, branchId, body as PhoneExpenseDto);
  }

  // Money taken later on a bill the guest left due.
  @Auth('bills.print')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('collections')
  @UsePipes(new ZodValidationPipe(phoneCollectionSchema))
  async collect(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.books.collect(user, branchId, body as PhoneCollectionDto);
  }

  // A phone's own cash drawer counted at the end of its day.
  @Auth('bills.print')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('till-closings')
  @UsePipes(new ZodValidationPipe(phoneTillClosingSchema))
  async tillClosing(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.books.tillClosing(user, branchId, body as PhoneTillClosingDto);
  }

  @Auth('accounting.manage')
  @Get('till-closings')
  async tillClosings(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.books.listTillClosings(branchId);
  }
}

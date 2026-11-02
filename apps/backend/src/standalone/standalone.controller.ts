import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../common/services/branch-access.service';
import { StandaloneService } from './standalone.service';
import { offlineSalesSchema, type OfflineSalesDto } from './standalone.schema';

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
    private readonly branchAccess: BranchAccessService,
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
}

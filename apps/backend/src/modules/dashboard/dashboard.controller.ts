import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { TREND_DAYS } from './dashboard-prefs';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('v1/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('dashboard.sales.view')
  @Get('summary')
  async getSummary(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.dashboardService.getSummary(branchId, user.permissions);
  }

  @Auth('dashboard.sales.view')
  @Get('trends')
  async getTrends(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('days') days?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const n = days === undefined ? 14 : Number(days);
    if (!(TREND_DAYS as readonly number[]).includes(n)) {
      throw new BadRequestException(
        `days must be one of ${TREND_DAYS.join(', ')}`,
      );
    }
    return this.dashboardService.getTrends(branchId, n);
  }

  // Each person's own layout; any signed-in user who can open the dashboard.
  @Auth('dashboard.sales.view')
  @Get('preferences')
  getPreferences(@CurrentUser() user: SessionUser) {
    return this.dashboardService.getPreferences(user.id);
  }

  @Auth('dashboard.sales.view')
  @Put('preferences')
  setPreferences(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.dashboardService.setPreferences(user.id, body);
  }
}

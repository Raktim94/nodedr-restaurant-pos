import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiGatewayService } from './ai-gateway.service';

@ApiTags('ai')
@Controller('v1/ai')
export class AiController {
  constructor(
    private readonly analytics: AiAnalyticsService,
    private readonly gateway: AiGatewayService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private async branch(user: SessionUser, branchId: string) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
  }

  @Auth('ai.analytics')
  @Get('demand-forecast')
  async demand(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branch(user, branchId);
    return this.analytics.demandForecast(branchId);
  }

  @Auth('ai.analytics')
  @Get('inventory-forecast')
  async inventory(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branch(user, branchId);
    return this.analytics.inventoryForecast(branchId);
  }

  @Auth('ai.analytics')
  @Get('waste-prediction')
  async waste(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branch(user, branchId);
    return this.analytics.wastePrediction(branchId);
  }

  @Auth('ai.analytics')
  @Get('menu-analysis')
  async menu(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branch(user, branchId);
    return this.analytics.menuAnalysis(branchId);
  }

  @Auth('ai.analytics')
  @Get('customer-churn')
  async churn(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branch(user, branchId);
    return this.analytics.customerChurn(branchId);
  }

  @Auth('ai.reports')
  @Post('ask-report')
  async askReport(
    @CurrentUser() user: SessionUser,
    @Body() body: { branchId: string; question: string },
  ) {
    await this.branch(user, body.branchId);
    return this.analytics.askReport(body.branchId, body.question);
  }

  @Auth('ai.ocr')
  @Post('invoice-ocr')
  async invoiceOcr(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      branchId: string;
      text?: string;
      imageBase64?: string;
      mimeType?: string;
    },
  ) {
    await this.branch(user, body.branchId);
    return this.gateway.extractInvoice(user, body);
  }
}

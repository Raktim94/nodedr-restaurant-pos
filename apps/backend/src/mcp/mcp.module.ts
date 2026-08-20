import { Module } from '@nestjs/common';
import { BranchAccessService } from '../common/services/branch-access.service';
import { StaffApiKeyGuard } from '../common/guards/staff-api-key.guard';
import { OrdersModule } from '../modules/orders/orders.module';
import { ReservationsModule } from '../modules/reservations/reservations.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { McpController } from './mcp.controller';
import { McpToolsBuilder } from './mcp-tools.builder';

@Module({
  imports: [OrdersModule, ReservationsModule, DashboardModule],
  controllers: [McpController],
  providers: [McpToolsBuilder, StaffApiKeyGuard, BranchAccessService],
})
export class McpModule {}

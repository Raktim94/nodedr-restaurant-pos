import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { AiController } from './ai.controller';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiGatewayService } from './ai-gateway.service';

@Module({
  controllers: [AiController],
  providers: [AiAnalyticsService, AiGatewayService, BranchAccessService],
})
export class AiModule {}

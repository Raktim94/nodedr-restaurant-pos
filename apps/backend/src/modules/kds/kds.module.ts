import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { OrdersModule } from '../orders/orders.module';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';

@Module({
  imports: [OrdersModule],
  controllers: [KdsController],
  providers: [KdsService, BranchAccessService],
})
export class KdsModule {}

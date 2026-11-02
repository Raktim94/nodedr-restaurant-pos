import { Module } from '@nestjs/common';
import { BranchAccessService } from '../common/services/branch-access.service';
import { OrdersModule } from '../modules/orders/orders.module';
import { StandaloneController } from './standalone.controller';
import { StandaloneService } from './standalone.service';

@Module({
  imports: [OrdersModule],
  controllers: [StandaloneController],
  providers: [StandaloneService, BranchAccessService],
})
export class StandaloneModule {}

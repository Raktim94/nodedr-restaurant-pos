import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [GiftCardsModule],
  controllers: [OrdersController],
  providers: [OrdersService, BranchAccessService],
  exports: [OrdersService],
})
export class OrdersModule {}

import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [OrdersModule],
  controllers: [PublicMenuController],
  providers: [PublicMenuService],
})
export class PublicModule {}

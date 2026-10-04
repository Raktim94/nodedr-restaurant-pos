import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [OrdersModule, NotificationsModule],
  controllers: [PublicMenuController],
  providers: [PublicMenuService],
})
export class PublicModule {}

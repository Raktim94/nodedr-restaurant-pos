import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PaymentGatewaysModule } from '../../payment-gateways/payment-gateways.module';
import { OrdersModule } from '../orders/orders.module';
import { RatingsModule } from '../ratings/ratings.module';
import { TablesModule } from '../tables/tables.module';
import { PublicKioskController } from './public-kiosk.controller';
import { PublicKioskService } from './public-kiosk.service';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [
    OrdersModule,
    NotificationsModule,
    PaymentGatewaysModule,
    TablesModule,
    RatingsModule,
  ],
  controllers: [PublicMenuController, PublicKioskController],
  providers: [PublicMenuService, PublicKioskService],
})
export class PublicModule {}

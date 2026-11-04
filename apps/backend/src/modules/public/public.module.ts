import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { BillShareModule } from '../bill-share/bill-share.module';
import { OrdersModule } from '../orders/orders.module';
import { PublicBillController } from './public-bill.controller';
import { PublicBillService } from './public-bill.service';
import { PublicKioskController } from './public-kiosk.controller';
import { PublicKioskService } from './public-kiosk.service';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [OrdersModule, NotificationsModule, BillShareModule],
  controllers: [
    PublicMenuController,
    PublicKioskController,
    PublicBillController,
  ],
  providers: [PublicMenuService, PublicKioskService, PublicBillService],
})
export class PublicModule {}

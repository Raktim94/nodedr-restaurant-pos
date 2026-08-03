import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MenuModule } from './modules/menu/menu.module';
import { TablesModule } from './modules/tables/tables.module';
import { OrdersModule } from './modules/orders/orders.module';
import { KdsModule } from './modules/kds/kds.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { PublicModule } from './modules/public/public.module';
import { CustomersModule } from './modules/customers/customers.module';
import { GiftCardsModule } from './modules/gift-cards/gift-cards.module';
import { InventoryModule } from './modules/inventory/inventory.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    MenuModule,
    TablesModule,
    OrdersModule,
    KdsModule,
    DashboardModule,
    RestaurantsModule,
    ReservationsModule,
    WaitlistModule,
    PublicModule,
    CustomersModule,
    GiftCardsModule,
    InventoryModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

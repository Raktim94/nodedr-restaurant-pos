import { Module } from '@nestjs/common';
import { BranchAccessService } from '../common/services/branch-access.service';
import { OrdersModule } from '../modules/orders/orders.module';
import { StandaloneController } from './standalone.controller';
import { StandaloneReservationsService } from './standalone-reservations.service';
import { StandaloneService } from './standalone.service';

@Module({
  imports: [OrdersModule],
  controllers: [StandaloneController],
  providers: [StandaloneService, StandaloneReservationsService, BranchAccessService],
})
export class StandaloneModule {}

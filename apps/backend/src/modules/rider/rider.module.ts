import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { RiderController } from './rider.controller';
import { RiderService } from './rider.service';

@Module({
  imports: [DeliveryModule],
  controllers: [RiderController],
  providers: [RiderService],
})
export class RiderModule {}

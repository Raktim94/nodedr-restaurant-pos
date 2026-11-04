import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicBillService } from './public-bill.service';

// Unauthenticated by design: the guest bill QR. Reachable only with the
// short-lived signed token OrdersController.createBillShare issues.
@ApiTags('public')
@Controller('v1/public/bill')
export class PublicBillController {
  constructor(private readonly publicBill: PublicBillService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  getBill(@Param('token') token: string) {
    return this.publicBill.getByToken(token);
  }
}

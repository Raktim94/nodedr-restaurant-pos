import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicBillService } from './public-bill.service';

// Deliberately unauthenticated — the customer-facing bill QR/link (see
// OrdersController.createBillShare). Reachable only by the opaque,
// short-lived signed token BillShareService issues; the token itself
// encodes which order/branch it is good for, so there is nothing here to
// enumerate.
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

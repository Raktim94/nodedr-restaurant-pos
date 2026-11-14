import { Body, Controller, Get, Headers, Param, Post, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  publicOrderSchema,
  publicRequestSchema,
} from '@nodedr-restaurant/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PublicMenuService } from './public-menu.service';

// Deliberately unauthenticated — this is the customer-facing table-QR menu
// and ordering flow. No @Auth() here on purpose: a guest scanning a table's
// QR code has no account. Only reachable by the opaque per-table qrToken,
// never by a guessable id — see TablesService.rotateQrToken.
@ApiTags('public')
@Controller('v1/public')
export class PublicMenuController {
  constructor(private readonly publicMenuService: PublicMenuService) {}

  @Get('menu/:qrToken')
  getMenu(@Param('qrToken') qrToken: string) {
    return this.publicMenuService.getMenuByQrToken(qrToken);
  }

  // Tighter than the app-wide default (300/min) — this is unauthenticated
  // and directly creates kitchen tickets, so it's a more attractive abuse
  // target than an authenticated staff endpoint.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('menu/:qrToken/order')
  @UsePipes(new ZodValidationPipe(publicOrderSchema))
  createOrder(@Param('qrToken') qrToken: string, @Body() body: unknown, @Headers('x-table-session') sessionToken?: string) {
    const { items, guestName, payment, idempotencyKey } = body as { items: never; guestName: string; payment?: 'CASH' | 'ONLINE'; idempotencyKey?: string };
    return this.publicMenuService.createOrder(qrToken, items, guestName, { payment, idempotencyKey, sessionToken });
  }

  // Starts the guest's online payment (Stripe or whichever gateway is on). The amount is the server's bill.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('menu/:qrToken/orders/:orderId/pay-online')
  payOnline(@Param('qrToken') qrToken: string, @Param('orderId') orderId: string, @Body() body: { origin?: string }, @Headers('x-table-session') sessionToken?: string) {
    return this.publicMenuService.payOnline(qrToken, orderId, typeof body?.origin === 'string' ? body.origin.slice(0, 200) : undefined, sessionToken);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('menu/:qrToken/orders/:orderId/pay-cash')
  payCash(@Param('qrToken') qrToken: string, @Param('orderId') orderId: string, @Headers('x-table-session') sessionToken?: string) {
    return this.publicMenuService.switchToCash(qrToken, orderId, sessionToken);
  }

  // Wrong codes are also counted per session on the server (locks after 8); this is the outer rate limit.
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('menu/:qrToken/session')
  joinSession(@Param('qrToken') qrToken: string, @Body() body: { code?: string }) {
    return this.publicMenuService.joinSession(qrToken, typeof body?.code === 'string' ? body.code.slice(0, 20) : '');
  }

  @Get('menu/:qrToken/session')
  sessionState(@Param('qrToken') qrToken: string, @Headers('x-table-session') sessionToken?: string) {
    return this.publicMenuService.sessionState(qrToken, sessionToken);
  }

  @Get('menu/:qrToken/status')
  getStatus(@Param('qrToken') qrToken: string) {
    return this.publicMenuService.getStatus(qrToken);
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('menu/:qrToken/request')
  @UsePipes(new ZodValidationPipe(publicRequestSchema))
  createRequest(@Param('qrToken') qrToken: string, @Body() body: unknown, @Headers('x-table-session') sessionToken?: string) {
    return this.publicMenuService.createRequest(
      qrToken,
      (body as { type: 'WAITER' | 'BILL' }).type,
      sessionToken,
    );
  }
}

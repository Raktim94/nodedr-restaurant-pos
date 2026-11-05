import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditAction } from '../audit/audit-action';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  GatewayPaymentsService,
  WebhookRejected,
} from './gateway-payments.service';

const createSchema = z.object({
  customerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/)
    .optional(),
  customerName: z.string().trim().max(80).optional(),
  // Only honoured if it is one of the server's own CORS origins.
  origin: z.string().url().max(200).optional(),
});

const refundSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().trim().max(200).optional(),
  returnedItems: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .max(100)
    .optional(),
});

// Taking payment is what checkout already needs: bills.print. Refunds need refunds.process.
@ApiTags('payment-gateways')
@Controller('v1')
export class GatewayPaymentsController {
  constructor(private readonly svc: GatewayPaymentsService) {}

  @Auth('bills.print')
  @AuditAction('gateway_payment.created', 'GatewayPayment')
  @Post('orders/:orderId/gateway-payments')
  @UsePipes(new ZodValidationPipe(createSchema))
  create(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body() body: z.infer<typeof createSchema>,
  ) {
    return this.svc.create(u.restaurantId, branchId, orderId, u.id, body);
  }

  @Auth('bills.print')
  @Get('orders/:orderId/gateway-payments')
  list(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.svc.forOrder(u.restaurantId, branchId, orderId);
  }

  @Auth('bills.print')
  @Get('payment-gateways/active')
  active(@CurrentUser() u: SessionUser) {
    return this.svc.activeSummary(u.restaurantId);
  }

  @Auth('settings.manage')
  @Get('payment-gateways/payments')
  recent(@CurrentUser() u: SessionUser) {
    return this.svc.recent(u.restaurantId);
  }

  @Auth('settings.manage')
  @Get('payment-gateways/refunds-to-review')
  refundsToReview(@CurrentUser() u: SessionUser) {
    return this.svc.refundsNeedingReview(u.restaurantId);
  }

  @Auth('refunds.process')
  @AuditAction('gateway_payment.refunded', 'GatewayPayment')
  @Post('gateway-payments/:id/refund')
  @UsePipes(new ZodValidationPipe(refundSchema))
  refund(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: z.infer<typeof refundSchema>,
  ) {
    return this.svc.refund(u.restaurantId, branchId, id, u.id, body);
  }

  @Auth('bills.print')
  @Post('gateway-payments/:id/refresh')
  refresh(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.svc.refresh(id, { restaurantId: u.restaurantId, branchId });
  }
}

// Unauthenticated on purpose: the provider (and the paying customer's browser)
// have no session. A webhook is trusted only after its signature checks out
// over the exact bytes received; the return page learns a status word only.
@ApiTags('payment-gateways')
@Controller('v1/payment-gateways')
export class GatewayPaymentsPublicController {
  constructor(private readonly svc: GatewayPaymentsService) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('webhook/:restaurantId/:provider/:mode')
  async webhook(
    @Param('restaurantId') restaurantId: string,
    @Param('provider') provider: string,
    @Param('mode') mode: string,
    @Headers() headers: Record<string, string | undefined>,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const m = mode.toUpperCase();
    if ((m !== 'TEST' && m !== 'LIVE') || !req.rawBody) {
      throw new BadRequestException('Bad request');
    }
    try {
      return await this.svc.webhook(
        restaurantId,
        provider,
        m,
        headers,
        req.rawBody.toString('utf8'),
      );
    } catch (e) {
      if (e instanceof WebhookRejected) throw new UnauthorizedException();
      throw e;
    }
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('return-status/:id')
  status(@Param('id') id: string) {
    return this.svc.publicStatus(id);
  }
}

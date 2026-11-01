import {
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AggregatorOrdersService } from './aggregator-orders.service';

// Deliberately unauthenticated: the caller is an aggregator or a platform's
// merchant webhook, which has no session. Trust comes from an HMAC signature
// over the exact bytes received, a 5 minute timestamp window, and per-order
// idempotency (see docs/INTEGRATIONS.md).
@ApiTags('integration-hub')
@Controller('v1/integration-hub/webhook')
export class IntegrationHubWebhookController {
  constructor(private readonly svc: AggregatorOrdersService) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':restaurantId/:provider')
  receive(
    @Param('restaurantId') restaurantId: string,
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string>,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    if (!req.rawBody) throw new BadRequestException('Empty body');
    return this.svc.receive(
      restaurantId,
      provider,
      headers,
      req.rawBody.toString('utf8'),
    );
  }
}

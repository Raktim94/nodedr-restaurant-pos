import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createIntegrationOrderSchema,
  createIntegrationReservationSchema,
  integrationIdempotencyKeySchema,
} from '@nodedr-restaurant/types';
import { z } from 'zod';
import { CurrentIntegrationKey } from '../common/decorators/current-integration-key.decorator';
import { RequireScope } from '../common/decorators/require-scope.decorator';
import { IntegrationApiKeyGuard } from '../common/guards/integration-api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { IntegrationKeyContext } from './integrations.service';
import { IntegrationsService } from './integrations.service';

// The public REST API an external website's own backend calls as a
// back end for OrderRestro — list locations, browse a location's menu,
// place an order, book a table, check status. Authenticated by
// Authorization: Bearer <integration api key>, never cookies — see
// docs/integrations-api.md for the full reference and IntegrationApiKeyGuard
// for the auth/scope model. Deliberately NOT behind CORS-any-origin: this
// is meant for server-to-server calls (the partner site's own backend),
// not embedding the raw key in browser JS.
@ApiTags('integrations')
@ApiBearerAuth('integration-key')
@UseGuards(IntegrationApiKeyGuard)
@Controller('v1/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @ApiOperation({ summary: 'List the locations this key can use' })
  @RequireScope('locations:read')
  @Get('locations')
  listLocations(@CurrentIntegrationKey() key: IntegrationKeyContext) {
    return this.integrations.listLocations(key);
  }

  @ApiOperation({
    summary: 'Public menu with modifier groups and availability window',
  })
  @RequireScope('menu:read')
  @Get('locations/:branchId/menu')
  getMenu(
    @CurrentIntegrationKey() key: IntegrationKeyContext,
    @Param('branchId') branchId: string,
  ) {
    return this.integrations.getMenu(key, branchId);
  }

  @RequireScope('menu:read')
  @Get('locations/:branchId/delivery-quote')
  deliveryQuote(
    @CurrentIntegrationKey() key: IntegrationKeyContext,
    @Param('branchId') branchId: string,
    @Query('pincode') pincode: string,
  ) {
    return this.integrations.deliveryQuote(key, branchId, pincode ?? '');
  }

  @ApiOperation({
    summary: 'Place a takeaway or delivery order',
    description:
      'Prices, tax and the delivery fee are calculated by the server; any amounts sent are ignored. Send an Idempotency-Key so a retry returns the original order instead of creating a second one.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '8-64 characters of A-Z a-z 0-9 _ -',
  })
  @ApiBody({ schema: z.toJSONSchema(createIntegrationOrderSchema) as never })
  @RequireScope('orders:write')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('locations/:branchId/orders')
  @UsePipes(new ZodValidationPipe(createIntegrationOrderSchema))
  createOrder(
    @CurrentIntegrationKey() key: IntegrationKeyContext,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey !== undefined) {
      const parsed = integrationIdempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsed.success) {
        throw new BadRequestException(parsed.error.issues[0].message);
      }
    }
    return this.integrations.createOrder(
      key,
      branchId,
      body as never,
      idempotencyKey,
    );
  }

  @ApiOperation({
    summary: 'Status, items and totals of an order this key placed',
    description:
      'Add ?include=customer to also receive the customer name, mobile number, email and delivery address. That needs the orders:read_customer scope; without it the request is rejected with 403.',
  })
  @ApiQuery({ name: 'include', required: false, enum: ['customer'] })
  @RequireScope('orders:read')
  @Get('locations/:branchId/orders/:orderId')
  getOrder(
    @CurrentIntegrationKey() key: IntegrationKeyContext,
    @Param('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Query('include') include?: string,
  ) {
    if (include !== undefined && include !== 'customer') {
      throw new BadRequestException('include must be "customer"');
    }
    return this.integrations.getOrder(
      key,
      branchId,
      orderId,
      include === 'customer',
    );
  }

  @RequireScope('reservations:write')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('locations/:branchId/reservations')
  @UsePipes(new ZodValidationPipe(createIntegrationReservationSchema))
  createReservation(
    @CurrentIntegrationKey() key: IntegrationKeyContext,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    return this.integrations.createReservation(key, branchId, body as never);
  }

  @RequireScope('reservations:read')
  @Get('locations/:branchId/reservations/:reservationId')
  getReservation(
    @CurrentIntegrationKey() key: IntegrationKeyContext,
    @Param('branchId') branchId: string,
    @Param('reservationId') reservationId: string,
  ) {
    return this.integrations.getReservation(key, branchId, reservationId);
  }
}

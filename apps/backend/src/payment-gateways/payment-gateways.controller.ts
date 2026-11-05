import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { AuditAction } from '../audit/audit-action';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PaymentGatewaysService } from './payment-gateways.service';

const mode = z.enum(['TEST', 'LIVE']);
const saveSchema = z.object({
  country: z.string().length(2),
  mode,
  credentials: z.record(z.string().max(60), z.string().max(600)).default({}),
});
const modeSchema = z.object({ mode, confirm: z.string().max(60).optional() });
const enabledSchema = z.object({ enabled: z.boolean() });
const testSchema = z.object({ mode: mode.optional() });
const customSchema = z.object({
  name: z.string().trim().min(2).max(80),
  countries: z.array(z.string().length(2)).min(1).max(20),
  docsUrl: z
    .string()
    .url()
    .max(300)
    .refine((u) => u.startsWith('https://'), 'Use an https:// link'),
  integration: z.string().trim().max(80).optional(),
  adapter: z.string().max(40).nullable().optional(),
  notes: z.string().trim().max(300).optional(),
});

// Setting up how the business gets paid is an owner/admin job: settings.manage.
// The restaurant always comes from the session.
@ApiTags('payment-gateways')
@Controller('v1/payment-gateways')
export class PaymentGatewaysController {
  constructor(private readonly svc: PaymentGatewaysService) {}

  @Auth('settings.manage')
  @Get('countries')
  countries(@CurrentUser() u: SessionUser) {
    return this.svc.countries(u.restaurantId);
  }

  @Auth('settings.manage')
  @Get('catalog')
  catalog(@CurrentUser() u: SessionUser, @Query('country') country = '') {
    return this.svc.catalog(u.restaurantId, country);
  }

  @Auth('settings.manage')
  @Get('connections')
  connections(@CurrentUser() u: SessionUser) {
    return this.svc.connections(u.restaurantId);
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.custom_saved', 'PaymentGatewayCatalogEntry')
  @Put('custom/:key')
  @UsePipes(new ZodValidationPipe(customSchema))
  saveCustom(
    @CurrentUser() u: SessionUser,
    @Param('key') key: string,
    @Body() body: z.infer<typeof customSchema>,
  ) {
    return this.svc.upsertCustomEntry(u.restaurantId, {
      ...body,
      key: key.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'custom',
    });
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.custom_removed', 'PaymentGatewayCatalogEntry')
  @Delete('custom/:key')
  removeCustom(@CurrentUser() u: SessionUser, @Param('key') key: string) {
    return this.svc.deleteCustomEntry(u.restaurantId, key);
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.credentials_saved', 'PaymentGatewayConnection')
  @Put(':provider')
  @UsePipes(new ZodValidationPipe(saveSchema))
  save(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Body() body: z.infer<typeof saveSchema>,
  ) {
    return this.svc.saveCredentials(u.restaurantId, provider, body);
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.tested', 'PaymentGatewayConnection')
  @Post(':provider/test')
  @UsePipes(new ZodValidationPipe(testSchema))
  test(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Body() body: z.infer<typeof testSchema>,
  ) {
    return this.svc.test(u.restaurantId, provider, body.mode);
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.mode_changed', 'PaymentGatewayConnection')
  @Post(':provider/mode')
  @UsePipes(new ZodValidationPipe(modeSchema))
  setMode(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Body() body: z.infer<typeof modeSchema>,
  ) {
    return this.svc.setMode(
      u.restaurantId,
      u.id,
      provider,
      body.mode,
      body.confirm,
    );
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.toggled', 'PaymentGatewayConnection')
  @Post(':provider/enabled')
  @UsePipes(new ZodValidationPipe(enabledSchema))
  setEnabled(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Body() body: z.infer<typeof enabledSchema>,
  ) {
    return this.svc.setEnabled(u.restaurantId, provider, body.enabled);
  }

  @Auth('settings.manage')
  @AuditAction(
    'payment_gateway.credentials_removed',
    'PaymentGatewayConnection',
  )
  @Delete(':provider/credentials/:mode')
  removeCredentials(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Param('mode') m: string,
  ) {
    return this.svc.removeCredentials(
      u.restaurantId,
      provider,
      mode.parse(m.toUpperCase()),
    );
  }

  @Auth('settings.manage')
  @AuditAction('payment_gateway.removed', 'PaymentGatewayConnection')
  @Delete(':provider')
  remove(@CurrentUser() u: SessionUser, @Param('provider') provider: string) {
    return this.svc.removeConnection(u.restaurantId, provider);
  }
}

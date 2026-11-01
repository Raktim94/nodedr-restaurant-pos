import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { AuditAction } from '../audit/audit-action';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { IntegrationHubService } from './integration-hub.service';

const connectSchema = z.object({
  externalAccountId: z.string().trim().max(120).optional(),
  credentials: z.record(z.string().max(60), z.string().max(500)).default({}),
});
const enabledSchema = z.object({ enabled: z.boolean() });

// Managing outside connections is an owner/admin job: settings.manage. The
// restaurant always comes from the session, never from the request.
@ApiTags('integration-hub')
@Controller('v1/integration-hub')
export class IntegrationHubController {
  constructor(private readonly hub: IntegrationHubService) {}

  @Auth('settings.manage')
  @Get()
  list(@CurrentUser() u: SessionUser) {
    return this.hub.list(u.restaurantId);
  }

  @Auth('settings.manage')
  @AuditAction('integration.saved', 'IntegrationConnection')
  @Put(':provider')
  @UsePipes(new ZodValidationPipe(connectSchema))
  connect(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Body() body: z.infer<typeof connectSchema>,
  ) {
    return this.hub.connect(u.restaurantId, u.id, provider, body);
  }

  @Auth('settings.manage')
  @AuditAction('integration.tested', 'IntegrationConnection')
  @Post(':provider/test')
  test(@CurrentUser() u: SessionUser, @Param('provider') provider: string) {
    return this.hub.test(u.restaurantId, provider);
  }

  @Auth('settings.manage')
  @AuditAction('integration.toggled', 'IntegrationConnection')
  @Post(':provider/enabled')
  setEnabled(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(enabledSchema))
    body: z.infer<typeof enabledSchema>,
  ) {
    return this.hub.setEnabled(u.restaurantId, provider, body.enabled);
  }

  @Auth('settings.manage')
  @Get(':provider/logs')
  logs(@CurrentUser() u: SessionUser, @Param('provider') provider: string) {
    return this.hub.logs(u.restaurantId, provider);
  }

  @Auth('settings.manage')
  @AuditAction('integration.disconnected', 'IntegrationConnection')
  @Delete(':provider')
  disconnect(
    @CurrentUser() u: SessionUser,
    @Param('provider') provider: string,
  ) {
    return this.hub.disconnect(u.restaurantId, provider);
  }
}

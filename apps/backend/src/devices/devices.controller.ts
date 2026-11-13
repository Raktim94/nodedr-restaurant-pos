import { Body, Controller, Get, Param, Post, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DevicesService, heartbeatSchema, type Heartbeat } from './devices.service';

@ApiTags('devices')
@Controller('v1/pos-devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  // The phone calls this after each sync with its own counts. Needs only a signed-in order taker.
  @Auth('orders.create')
  @Post('heartbeat')
  @UsePipes(new ZodValidationPipe(heartbeatSchema))
  heartbeat(@CurrentUser() u: SessionUser, @Body() body: Heartbeat) {
    return this.devices.heartbeat(u, body);
  }

  @Auth('users.manage')
  @Get()
  list(@CurrentUser() u: SessionUser) {
    return this.devices.list(u.restaurantId);
  }

  @Auth('users.manage')
  @Post(':id/revoke')
  revoke(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    return this.devices.setRevoked(u.restaurantId, u.id, id, true);
  }

  @Auth('users.manage')
  @Post(':id/restore')
  restore(@CurrentUser() u: SessionUser, @Param('id') id: string) {
    return this.devices.setRevoked(u.restaurantId, u.id, id, false);
  }
}

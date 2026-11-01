import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RiderService } from './rider.service';

const dutySchema = z.object({ online: z.boolean() });
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const statusSchema = z.object({
  status: z.enum(['PICKED_UP', 'DELIVERED', 'FAILED']),
  reason: z.string().trim().max(200).optional(),
});

// The rider app. Every route is scoped to the signed-in rider's own deliveries;
// nothing here takes a rider or restaurant id from the request.
@ApiTags('rider')
@Controller('v1/rider')
export class RiderController {
  constructor(private readonly rider: RiderService) {}

  @Auth('delivery.rider')
  @Get('me')
  me(@CurrentUser() u: SessionUser) {
    return this.rider.me(u.id);
  }

  @Auth('delivery.rider')
  @Post('duty')
  @UsePipes(new ZodValidationPipe(dutySchema))
  duty(@CurrentUser() u: SessionUser, @Body() b: z.infer<typeof dutySchema>) {
    return this.rider.setDuty(u.id, b.online);
  }

  @Auth('delivery.rider')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('location')
  @UsePipes(new ZodValidationPipe(locationSchema))
  location(
    @CurrentUser() u: SessionUser,
    @Body() b: z.infer<typeof locationSchema>,
  ) {
    return this.rider.setLocation(u.id, b.lat, b.lng);
  }

  @Auth('delivery.rider')
  @Get('deliveries')
  deliveries(@CurrentUser() u: SessionUser) {
    return this.rider.deliveries(u.id);
  }

  @Auth('delivery.rider')
  @Patch('deliveries/:id/status')
  @UsePipes(new ZodValidationPipe(statusSchema))
  status(
    @CurrentUser() u: SessionUser,
    @Param('id') id: string,
    @Body() b: z.infer<typeof statusSchema>,
  ) {
    return this.rider.setStatus(u.id, id, b.status, b.reason);
  }
}

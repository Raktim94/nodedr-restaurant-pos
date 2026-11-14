import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { PagingService, type BuzzerInput } from './paging.service';

const buzzerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  number: z.string().trim().max(20).nullable().optional(),
  tableId: z.string().nullable().optional(),
  driver: z.enum(['SIMULATED', 'WEBHOOK']).optional(),
  webhookUrl: z.string().trim().max(300).nullable().optional(),
  webhookSecret: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});
const callSchema = z.object({ repeat: z.boolean().optional() });

@ApiTags('paging')
@Controller('v1')
export class PagingController {
  constructor(
    private readonly paging: PagingService,
    private readonly branchAccess: BranchAccessService,
  ) {}
  private access(u: SessionUser, branchId: string) {
    return this.branchAccess.assertAccess(u.restaurantId, branchId);
  }

  @Auth('settings.manage')
  @Get('paging/buzzers')
  async list(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.paging.list(branchId);
  }

  @Auth('settings.manage')
  @Post('paging/buzzers')
  @UsePipes(new ZodValidationPipe(buzzerSchema))
  async create(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.access(u, branchId);
    return this.paging.create(branchId, body as BuzzerInput);
  }

  @Auth('settings.manage')
  @Patch('paging/buzzers/:id')
  async update(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(buzzerSchema.partial()))
    body: Partial<BuzzerInput>,
  ) {
    await this.access(u, branchId);
    return this.paging.update(branchId, id, body);
  }

  @Auth('settings.manage')
  @Delete('paging/buzzers/:id')
  async remove(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.paging.remove(branchId, id);
  }

  @Auth('settings.manage')
  @Post('paging/buzzers/:id/test')
  async test(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.paging.testCall(branchId, u.id, id);
  }

  // The kitchen: "this order is ready, page the table".
  @Auth('kds.manage')
  @Post('paging/orders/:orderId/call')
  async call(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(callSchema)) body: z.infer<typeof callSchema>,
  ) {
    await this.access(u, branchId);
    return this.paging.callForOrder(branchId, u.id, orderId, body.repeat);
  }

  @Auth('kds.manage')
  @Get('paging/orders/:orderId/calls')
  async calls(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('orderId') orderId: string,
  ) {
    await this.access(u, branchId);
    return this.paging.callsForOrder(branchId, orderId);
  }

  @Auth('kds.manage')
  @Post('paging/calls/:id/ack')
  async ack(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.paging.ackByStaff(branchId, id);
  }

  // The buzzer itself (or the simulator page). No login; the token identifies the device.
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Get('public/buzzer/:token/poll')
  poll(@Param('token') token: string) {
    return this.paging.poll(token);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('public/buzzer/:token/ack')
  ack2(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(z.object({ callId: z.string().min(1) })))
    body: { callId: string },
  ) {
    return this.paging.ack(token, body.callId);
  }
}

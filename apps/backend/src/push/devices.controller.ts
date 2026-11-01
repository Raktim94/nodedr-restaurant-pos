import { Body, Controller, Delete, Get, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

const registerSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['ANDROID', 'IOS']),
  appVersion: z.string().max(40).optional(),
});

/** Phones register for push after sign-in and unregister at sign-out. */
@ApiTags('mobile')
@Controller('v1')
export class DevicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // Public: the app asks this before sign-in to decide whether it must update.
  @Get('mobile/config')
  config() {
    return {
      minVersion: process.env.MOBILE_MIN_VERSION ?? '1.0.0',
      latestVersion: process.env.MOBILE_LATEST_VERSION ?? '1.0.0',
      push: this.push.enabled,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('devices')
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @CurrentUser() user: { id: string },
    @Body() body: z.infer<typeof registerSchema>,
  ) {
    // A phone belongs to whoever signed in last on it.
    await this.prisma.deviceToken.upsert({
      where: { token: body.token },
      create: { userId: user.id, token: body.token, platform: body.platform, appVersion: body.appVersion },
      update: { userId: user.id, platform: body.platform, appVersion: body.appVersion, lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('devices/:token')
  async unregister(@CurrentUser() user: { id: string }, @Param('token') token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId: user.id } });
    return { ok: true };
  }
}

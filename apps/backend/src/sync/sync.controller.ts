import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { SyncKeyGuard } from './sync-key.guard';
import { SyncChange, SyncService } from './sync.service';

/** Called by other installs (key-authenticated). */
@ApiTags('sync')
@Controller('v1/sync-peer')
@UseGuards(SyncKeyGuard)
export class SyncPeerController {
  constructor(private readonly sync: SyncService) {}

  @Get('ping')
  async ping() {
    return {
      ok: true,
      role: 'server',
      schema: await this.sync.schemaVersion(),
    };
  }

  @Get('pull')
  pull(@Query('since') since = '0', @Query('device') device = '') {
    if (!/^\d+$/.test(since) || !device)
      throw new BadRequestException('since and device are required');
    return this.sync.pull(BigInt(since), device);
  }

  @Post('push')
  push(@Body() body: { device?: string; changes?: SyncChange[] }) {
    if (!body?.device || !Array.isArray(body.changes))
      throw new BadRequestException('device and changes are required');
    return this.sync.push(body.device, body.changes);
  }
}

/** Used by the settings page on this install. */
@ApiTags('sync')
@Controller('v1/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Auth('settings.manage')
  @Get('status')
  status() {
    return this.sync.publicStatus();
  }

  @Auth('settings.manage')
  @Post('test')
  async test(@Body() body: { serverUrl?: string; apiKey?: string }) {
    try {
      return await this.sync.testConnection(this.url(body), this.key(body));
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Connection failed',
      );
    }
  }

  @Auth('settings.manage')
  @Put('settings')
  async enable(
    @Body() body: { serverUrl?: string; apiKey?: string; mode?: string },
  ) {
    if (body.mode !== 'adopt' && body.mode !== 'merge')
      throw new BadRequestException('mode must be adopt or merge');
    try {
      await this.sync.enable(this.url(body), this.key(body), body.mode);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Sync failed',
      );
    }
    return this.sync.publicStatus();
  }

  @Auth('settings.manage')
  @Post('run')
  async run() {
    try {
      const r = await this.sync.runOnce();
      return { ...r, ...(await this.sync.publicStatus()) };
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Sync failed',
      );
    }
  }

  @Auth('settings.manage')
  @Post('disable')
  async disable() {
    await this.sync.disable();
    return this.sync.publicStatus();
  }

  private url(b: { serverUrl?: string }) {
    const u = (b.serverUrl ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u))
      throw new BadRequestException(
        'Enter the server address, e.g. https://orders.example.com',
      );
    return u;
  }

  private key(b: { apiKey?: string }) {
    const k = (b.apiKey ?? '').trim();
    if (k.length < 16)
      throw new BadRequestException('Sync key must be at least 16 characters');
    return k;
  }
}

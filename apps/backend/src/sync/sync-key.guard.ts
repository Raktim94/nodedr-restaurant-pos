import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { SyncService } from './sync.service';

/** Machine-to-machine auth for /v1/sync-peer/*: shared SYNC_API_KEY. */
@Injectable()
export class SyncKeyGuard implements CanActivate {
  constructor(private readonly sync: SyncService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const given = String(req.headers['x-sync-key'] ?? '');
    const s = await this.sync.state();
    if (s.role !== 'server' || !s.apiKey || !given)
      throw new UnauthorizedException();
    const a = Buffer.from(given);
    const b = Buffer.from(s.apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new UnauthorizedException();
    return true;
  }
}

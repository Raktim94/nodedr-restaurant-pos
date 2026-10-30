import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { INTEGRATION_SCOPES_KEY } from '../decorators/require-scope.decorator';
import { envLimit, KeyRateLimiter } from './key-rate-limiter';

// Authenticates every route on IntegrationsController — the public REST API
// external websites use as a backend (see docs/integrations-api.md). A
// deliberately separate credential from staff sessions/StaffApiKey: this
// key carries no employee identity, just an explicit `scopes` list and an
// optional branch scope, so a leaked integration key can only do exactly
// what it was issued for, never anything a staff login could.
@Injectable()
export class IntegrationApiKeyGuard implements CanActivate {
  // Per key, separately for writes (placing orders/bookings) and reads.
  private readonly limiter = new KeyRateLimiter();
  private readonly writeLimit = envLimit('INTEGRATION_WRITE_LIMIT_PER_MIN', 30);
  private readonly readLimit = envLimit('INTEGRATION_READ_LIMIT_PER_MIN', 300);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const header = request.headers.authorization;
    const rawToken = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : null;
    if (!rawToken) {
      throw new UnauthorizedException(
        'Missing Authorization: Bearer <api key> header',
      );
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const key = await this.prisma.integrationApiKey.findUnique({
      where: { tokenHash },
    });
    if (
      !key ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt.getTime() <= Date.now())
    ) {
      throw new UnauthorizedException('Invalid, expired or revoked API key');
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      INTEGRATION_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required?.length) {
      const missing = required.filter((scope) => !key.scopes.includes(scope));
      if (missing.length > 0) {
        throw new ForbiddenException(
          `This API key is missing required scope(s): ${missing.join(', ')}`,
        );
      }
    }

    const isWrite = request.method !== 'GET';
    const retryAfter = this.limiter.hit(
      `${key.id}:${isWrite ? 'w' : 'r'}`,
      isWrite ? this.writeLimit : this.readLimit,
    );
    if (retryAfter > 0) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        'Too many requests for this API key — slow down and retry later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    request.integrationKey = {
      id: key.id,
      restaurantId: key.restaurantId,
      branchId: key.branchId,
      scopes: key.scopes,
    };

    // Best-effort — must never block an already-authenticated request.
    this.prisma.integrationApiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}

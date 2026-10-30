/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- hand-built request/context fakes */
import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { IntegrationApiKeyGuard } from './integration-api-key.guard';
import { KeyRateLimiter } from './key-rate-limiter';

const RAW = 'ordr_ext_test-token';
const hash = createHash('sha256').update(RAW).digest('hex');

function setup(
  keyRow: Record<string, unknown> | null,
  scopes: string[] = [],
  method = 'GET',
) {
  const prisma: any = {
    integrationApiKey: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.tokenHash === hash ? keyRow : null,
      ),
      update: jest.fn(async () => ({})),
    },
  };
  const reflector = { getAllAndOverride: jest.fn(() => scopes) };
  const guard = new IntegrationApiKeyGuard(
    prisma,
    reflector as unknown as Reflector,
  );
  const request: any = { headers: {}, method };
  const response = { setHeader: jest.fn() };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { guard, request, response, ctx, prisma };
}

const activeKey = {
  id: 'k1',
  restaurantId: 'r1',
  branchId: 'b1',
  scopes: ['orders:read'],
  revokedAt: null,
};

describe('IntegrationApiKeyGuard', () => {
  it('rejects a missing, unknown or revoked key with 401', async () => {
    const a = setup(activeKey);
    await expect(a.guard.canActivate(a.ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const b = setup(activeKey);
    b.request.headers.authorization = 'Bearer ordr_ext_wrong';
    await expect(b.guard.canActivate(b.ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const c = setup({ ...activeKey, revokedAt: new Date() });
    c.request.headers.authorization = `Bearer ${RAW}`;
    await expect(c.guard.canActivate(c.ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired key with 401', async () => {
    const s = setup({ ...activeKey, expiresAt: new Date(Date.now() - 1000) });
    s.request.headers.authorization = `Bearer ${RAW}`;
    await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const ok = setup({ ...activeKey, expiresAt: new Date(Date.now() + 60000) });
    ok.request.headers.authorization = `Bearer ${RAW}`;
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);
  });

  it('403s when the key lacks the required scope', async () => {
    const s = setup(activeKey, ['orders:read_customer']);
    s.request.headers.authorization = `Bearer ${RAW}`;
    await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('attaches the key context (never the token hash) on success', async () => {
    const s = setup(activeKey, ['orders:read']);
    s.request.headers.authorization = `Bearer ${RAW}`;
    await expect(s.guard.canActivate(s.ctx)).resolves.toBe(true);
    expect(s.request.integrationKey).toEqual({
      id: 'k1',
      restaurantId: 'r1',
      branchId: 'b1',
      scopes: ['orders:read'],
    });
  });

  it('rate limits writes per key with 429 and Retry-After', async () => {
    process.env.INTEGRATION_WRITE_LIMIT_PER_MIN = '2';
    try {
      const s = setup(activeKey, [], 'POST');
      s.request.headers.authorization = `Bearer ${RAW}`;
      // limits are read when the guard is built; rebuild with the env set
      const guard = new IntegrationApiKeyGuard(s.prisma, {
        getAllAndOverride: () => [],
      } as unknown as Reflector);
      await guard.canActivate(s.ctx);
      await guard.canActivate(s.ctx);
      const err = await guard.canActivate(s.ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(s.response.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(String),
      );
      // reads are a separate bucket and unaffected
      const r = setup(activeKey, [], 'GET');
      r.request.headers.authorization = `Bearer ${RAW}`;
      await expect(guard.canActivate(r.ctx)).resolves.toBe(true);
    } finally {
      delete process.env.INTEGRATION_WRITE_LIMIT_PER_MIN;
    }
  });
});

describe('KeyRateLimiter', () => {
  it('counts per bucket and resets after the window', () => {
    const l = new KeyRateLimiter(1000);
    expect(l.hit('a', 2, 0)).toBe(0);
    expect(l.hit('a', 2, 10)).toBe(0);
    expect(l.hit('a', 2, 20)).toBeGreaterThan(0);
    expect(l.hit('b', 2, 20)).toBe(0);
    expect(l.hit('a', 2, 1500)).toBe(0);
  });
});

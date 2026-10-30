import { randomBytes, createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateIntegrationApiKeyDto,
  SessionUser,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../prisma/prisma.service';
import { BranchAccessService } from '../common/services/branch-access.service';

const TOKEN_PREFIX = 'ordr_ext_';
const MAX_ACTIVE_KEYS_PER_RESTAURANT = 20;

// Restaurant-wide credentials for EXTERNAL systems (a partner website's own
// backend, an aggregator, a booking widget) to call the public integrations
// API as (see IntegrationsController/docs/integrations-api.md). Gated to
// settings.manage — issuing one of these is an admin-level action, not
// something every staff member should be able to do.
@Injectable()
export class IntegrationApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private generateToken(): { raw: string; hash: string; lastFour: string } {
    const raw = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    return {
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
      lastFour: raw.slice(-4),
    };
  }

  async create(actor: SessionUser, dto: CreateIntegrationApiKeyDto) {
    if (dto.branchId) {
      await this.branchAccess.assertAccess(actor.restaurantId, dto.branchId);
    }

    const activeCount = await this.prisma.integrationApiKey.count({
      where: { restaurantId: actor.restaurantId, revokedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_KEYS_PER_RESTAURANT) {
      throw new BadRequestException(
        `This restaurant already has ${MAX_ACTIVE_KEYS_PER_RESTAURANT} active integration keys — revoke one before creating another.`,
      );
    }

    const { raw, hash, lastFour } = this.generateToken();
    const key = await this.prisma.integrationApiKey.create({
      data: {
        restaurantId: actor.restaurantId,
        branchId: dto.branchId ?? null,
        name: dto.name,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        tokenHash: hash,
        lastFour,
        createdById: actor.id,
      },
    });

    // The only point in this key's lifetime the raw token is ever
    // available — every other read returns the masked summary below.
    return {
      id: key.id,
      name: key.name,
      token: raw,
      lastFour: key.lastFour,
      branchId: key.branchId,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    };
  }

  async list(actor: SessionUser) {
    const keys = await this.prisma.integrationApiKey.findMany({
      where: { restaurantId: actor.restaurantId },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      lastFour: key.lastFour,
      branch: key.branch,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    }));
  }

  async revoke(actor: SessionUser, id: string) {
    const key = await this.prisma.integrationApiKey.findFirst({
      where: { id, restaurantId: actor.restaurantId },
    });
    if (!key) throw new NotFoundException('API key not found');
    if (!key.revokedAt) {
      await this.prisma.integrationApiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  /**
   * Replaces a key with a fresh secret carrying the same name, scopes and
   * location. Orders the old key placed move to the new one (so status polling
   * and customer lookups keep working) and the old key is revoked in the same
   * transaction. Returns the new token once.
   */
  async rotate(actor: SessionUser, id: string) {
    const old = await this.prisma.integrationApiKey.findFirst({
      where: { id, restaurantId: actor.restaurantId, revokedAt: null },
    });
    if (!old) throw new NotFoundException('API key not found');
    const { raw, hash, lastFour } = this.generateToken();
    const created = await this.prisma.$transaction(async (tx) => {
      const next = await tx.integrationApiKey.create({
        data: {
          restaurantId: old.restaurantId,
          branchId: old.branchId,
          name: old.name,
          scopes: old.scopes,
          expiresAt: old.expiresAt,
          tokenHash: hash,
          lastFour,
          createdById: actor.id,
        },
      });
      await tx.order.updateMany({
        where: { integrationKeyId: old.id },
        data: { integrationKeyId: next.id },
      });
      await tx.integrationApiKey.update({
        where: { id: old.id },
        data: { revokedAt: new Date() },
      });
      return next;
    });
    return {
      id: created.id,
      name: created.name,
      token: raw,
      lastFour: created.lastFour,
      branchId: created.branchId,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
    };
  }
}

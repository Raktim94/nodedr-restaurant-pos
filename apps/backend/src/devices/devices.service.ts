import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export const heartbeatSchema = z.object({
  deviceId: z.string().trim().min(8).max(120),
  name: z.string().trim().min(1).max(80).default('Phone'),
  platform: z.string().trim().max(20).optional(),
  appVersion: z.string().trim().max(40).optional(),
  pending: z.coerce.number().int().min(0).max(1_000_000).default(0),
  failed: z.coerce.number().int().min(0).max(1_000_000).default(0),
  lastError: z.string().trim().max(300).optional(),
  synced: z.boolean().default(false),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

// Phones that take orders are listed here so an owner can see when each last synced, how many sales are
// stuck on it, and switch one off (a lost or stolen phone). A revoked phone is refused on every request
// (see DeviceRevocationMiddleware), and cannot enrol again until the owner restores it.
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Enrol or refresh. Throws if the device was revoked, so the phone can tell its user. */
  async heartbeat(user: SessionUser, dto: Heartbeat) {
    const existing = await this.prisma.posDevice.findUnique({
      where: { restaurantId_deviceId: { restaurantId: user.restaurantId, deviceId: dto.deviceId } },
    });
    if (existing?.revokedAt) {
      throw new ForbiddenException({ message: 'This phone was removed by the owner.', code: 'DEVICE_REVOKED' });
    }
    const data = {
      userId: user.id,
      name: dto.name,
      platform: dto.platform,
      appVersion: dto.appVersion,
      lastSeenAt: new Date(),
      pendingCount: dto.pending,
      failedCount: dto.failed,
      lastError: dto.lastError ?? null,
      ...(dto.synced ? { lastSyncAt: new Date() } : {}),
    };
    return this.prisma.posDevice.upsert({
      where: { restaurantId_deviceId: { restaurantId: user.restaurantId, deviceId: dto.deviceId } },
      create: { restaurantId: user.restaurantId, deviceId: dto.deviceId, ...data },
      update: data,
      select: { id: true, name: true, enrolledAt: true },
    });
  }

  list(restaurantId: string) {
    return this.prisma.posDevice.findMany({
      where: { restaurantId },
      orderBy: { lastSeenAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async setRevoked(restaurantId: string, actorId: string, id: string, revoked: boolean) {
    const d = await this.prisma.posDevice.findFirst({ where: { id, restaurantId } });
    if (!d) throw new NotFoundException('Device not found');
    const out = await this.prisma.posDevice.update({
      where: { id },
      data: revoked ? { revokedAt: new Date(), revokedById: actorId } : { revokedAt: null, revokedById: null },
    });
    await this.audit.record({
      userId: actorId,
      action: revoked ? 'device.revoked' : 'device.restored',
      entity: 'PosDevice',
      entityId: id,
      metadata: { name: d.name, deviceId: d.deviceId },
    });
    return out;
  }

  /** Used by the middleware: is this device id switched off on any restaurant? */
  isRevoked(deviceId: string) {
    return this.prisma.posDevice
      .findFirst({ where: { deviceId, revokedAt: { not: null } }, select: { id: true } })
      .then((r) => !!r);
  }
}

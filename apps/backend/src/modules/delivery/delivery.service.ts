import { PushService } from '../../push/push.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeliveryStatusDto,
  DeliveryZoneDto,
  DeliveryZoneUpdateDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { WebhooksService } from '../webhooks/webhooks.service';

// Forward-only lifecycle; FAILED is reachable from any open state.
const NEXT: Record<DeliveryStatusDto, DeliveryStatusDto[]> = {
  UNASSIGNED: ['ASSIGNED', 'FAILED'],
  ASSIGNED: ['PICKED_UP', 'UNASSIGNED', 'FAILED'],
  PICKED_UP: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['UNASSIGNED'],
};

const ORDER_INCLUDE = {
  driver: { select: { id: true, name: true } },
  deliveryZone: { select: { id: true, name: true } },
} as const;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly webhooks: WebhooksService,
    private readonly push: PushService,
  ) {}

  // --- Zones ---------------------------------------------------------------

  listZones(branchId: string) {
    return this.prisma.deliveryZone.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async createZone(branchId: string, dto: DeliveryZoneDto) {
    await this.assertPincodesFree(branchId, dto.pincodes);
    return this.prisma.deliveryZone.create({ data: { ...dto, branchId } });
  }

  async updateZone(branchId: string, id: string, dto: DeliveryZoneUpdateDto) {
    await this.getZone(branchId, id);
    if (dto.pincodes) await this.assertPincodesFree(branchId, dto.pincodes, id);
    return this.prisma.deliveryZone.update({ where: { id }, data: dto });
  }

  async deleteZone(branchId: string, id: string) {
    await this.getZone(branchId, id);
    // Orders keep their snapshotted fee; the zone link is set null.
    await this.prisma.deliveryZone.delete({ where: { id } });
    return { ok: true };
  }

  private async getZone(branchId: string, id: string) {
    const zone = await this.prisma.deliveryZone.findFirst({
      where: { id, branchId },
    });
    if (!zone) throw new NotFoundException('Delivery zone not found');
    return zone;
  }

  /** A pincode may belong to only one active zone, or quotes would be ambiguous. */
  private async assertPincodesFree(
    branchId: string,
    pincodes: string[],
    exceptId?: string,
  ) {
    const clash = await this.prisma.deliveryZone.findFirst({
      where: {
        branchId,
        isActive: true,
        pincodes: { hasSome: pincodes },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    });
    if (clash)
      throw new BadRequestException(
        `A pincode is already covered by the zone "${clash.name}"`,
      );
  }

  /** Public-safe quote: fee/ETA for a pincode, no zone internals. */
  async quote(branchId: string, pincode: string) {
    const zone = await this.prisma.deliveryZone.findFirst({
      where: { branchId, isActive: true, pincodes: { has: pincode } },
    });
    if (!zone) return { deliverable: false as const };
    return {
      deliverable: true as const,
      zoneName: zone.name,
      fee: Number(zone.fee),
      minOrderAmount: Number(zone.minOrderAmount),
      etaMinutes: zone.etaMinutes,
    };
  }

  // --- Deliveries ----------------------------------------------------------

  /** Active deliveries, or history (DELIVERED/FAILED) when history=true. */
  list(branchId: string, history = false) {
    return this.prisma.order.findMany({
      where: {
        branchId,
        type: 'DELIVERY',
        status: { not: 'CANCELLED' },
        deliveryStatus: history
          ? { in: ['DELIVERED', 'FAILED'] }
          : { in: ['UNASSIGNED', 'ASSIGNED', 'PICKED_UP'] },
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: history ? 'desc' : 'asc' },
      take: 200,
    });
  }

  /** Staff who can be assigned: active users with access to this branch. */
  async listDrivers(branchId: string) {
    const drivers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        branches: { some: { branchId } },
        role: { name: 'DELIVERY_STAFF' },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        riderOnline: true,
        riderLat: true,
        riderLng: true,
        riderLocationAt: true,
      },
      orderBy: { name: 'asc' },
    });
    const active = await this.prisma.order.groupBy({
      by: ['driverId'],
      where: {
        branchId,
        driverId: { in: drivers.map((d) => d.id) },
        deliveryStatus: { in: ['ASSIGNED', 'PICKED_UP'] },
      },
      _count: { _all: true },
    });
    const byDriver = new Map(active.map((a) => [a.driverId, a._count._all]));
    return drivers.map((d) => ({
      ...d,
      activeDeliveries: byDriver.get(d.id) ?? 0,
    }));
  }

  async assignDriver(branchId: string, orderId: string, driverId: string) {
    const order = await this.getDelivery(branchId, orderId);
    if (!['UNASSIGNED', 'ASSIGNED'].includes(order.deliveryStatus ?? ''))
      throw new BadRequestException(
        'This delivery can no longer be reassigned',
      );
    const driver = await this.prisma.user.findFirst({
      where: { id: driverId, isActive: true, branches: { some: { branchId } } },
      select: { id: true },
    });
    if (!driver)
      throw new BadRequestException('Driver not found for this branch');
    const saved = await this.save(branchId, orderId, {
      driverId,
      deliveryStatus: 'ASSIGNED',
      assignedAt: new Date(),
    });
    // Tell the rider's phone straight away.
    this.realtime.emitToUsers([driverId], 'rider.assigned', {
      orderId,
      orderNumber: saved.orderNumber,
    });
    this.push.sendToUsers([driverId], {
      title: 'New delivery',
      body: `Order ${saved.orderNumber} is assigned to you`,
      path: '/my-deliveries',
      data: { type: 'rider.assigned' },
    });
    return saved;
  }

  async setStatus(
    branchId: string,
    orderId: string,
    status: DeliveryStatusDto,
    reason?: string,
  ) {
    const order = await this.getDelivery(branchId, orderId);
    const current: DeliveryStatusDto = order.deliveryStatus ?? 'UNASSIGNED';
    if (!NEXT[current].includes(status))
      throw new BadRequestException(`Cannot move from ${current} to ${status}`);
    if (status === 'PICKED_UP' && !order.driverId)
      throw new BadRequestException('Assign a driver first');
    return this.save(branchId, orderId, {
      deliveryStatus: status,
      ...(status === 'UNASSIGNED' ? { driverId: null } : {}),
      ...(status === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}),
      ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      ...(status === 'FAILED'
        ? { deliveryFailedReason: reason?.slice(0, 200) ?? null }
        : {}),
    });
  }

  private async getDelivery(branchId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId, type: 'DELIVERY' },
    });
    if (!order) throw new NotFoundException('Delivery order not found');
    return order;
  }

  private async save(
    branchId: string,
    orderId: string,
    data: Record<string, unknown>,
  ) {
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data,
      include: ORDER_INCLUDE,
    });
    this.realtime.emitToBranch(branchId, 'order.updated', { id: orderId });
    void this.webhooks.emitForBranch(branchId, 'delivery.updated', {
      orderId,
      orderNumber: updated.orderNumber,
      status: updated.deliveryStatus,
      driver: updated.driver?.name ?? null,
      address: updated.deliveryAddress,
    });
    return updated;
  }
}

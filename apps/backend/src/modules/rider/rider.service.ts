import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryService } from '../delivery/delivery.service';

const ACTIVE = ['ASSIGNED', 'PICKED_UP'] as const;

const CARD_INCLUDE = {
  items: { select: { nameSnapshot: true, quantity: true } },
  customer: { select: { name: true, phone: true } },
  payments: { select: { amount: true } },
  kots: { select: { status: true } },
  branch: { select: { name: true, address: true, phone: true } },
} satisfies Prisma.OrderInclude;

type Card = Prisma.OrderGetPayload<{ include: typeof CARD_INCLUDE }>;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Everything the rider app may see: an allow-list, never the raw order row. */
function present(o: Card) {
  const total = Number(o.totalAmount);
  const paid = o.payments.reduce((s, p) => s + Number(p.amount), 0);
  const kitchen = o.kots.map((k) => k.status);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.deliveryStatus,
    assignedAt: o.assignedAt,
    pickedUpAt: o.pickedUpAt,
    deliveredAt: o.deliveredAt,
    failedReason: o.deliveryFailedReason,
    etaAt: o.deliveryEtaAt,
    pickup: {
      name: o.branch.name,
      address: o.branch.address,
      phone: o.branch.phone,
    },
    customer: {
      name: o.guestName ?? o.customer?.name ?? null,
      phone: o.deliveryPhone ?? o.customer?.phone ?? null,
    },
    address: o.deliveryAddress,
    pincode: o.deliveryPincode,
    // Where the customer asked to be met: exact GPS fix (if they shared it) and/or a named place.
    location: {
      lat: o.deliveryLat,
      lng: o.deliveryLng,
      place: o.deliveryPlace,
      mapsUrl:
        o.deliveryLat != null && o.deliveryLng != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${o.deliveryLat},${o.deliveryLng}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              [o.deliveryPlace, o.deliveryAddress, o.deliveryPincode]
                .filter(Boolean)
                .join(', '),
            )}`,
    },
    notes: o.notes,
    items: o.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity })),
    // What to collect at the door; 0 when the order is already paid.
    amountToCollect: Math.max(Math.round((total - paid) * 100) / 100, 0),
    orderTotal: total,
    foodReady:
      kitchen.length > 0 &&
      kitchen.every((k) => ['READY', 'SERVED'].includes(k)),
  };
}

@Injectable()
export class RiderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
  ) {}

  private async branchOf(userId: string) {
    const ub = await this.prisma.userBranch.findFirst({
      where: { userId },
      include: { branch: { select: { id: true, name: true, address: true } } },
      orderBy: { branchId: 'asc' },
    });
    if (!ub)
      throw new NotFoundException('No location is linked to this account');
    return ub.branch;
  }

  async me(userId: string) {
    const [user, branch] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true, phone: true, riderOnline: true },
      }),
      this.branchOf(userId),
    ]);
    const [active, delivered, failed] = await Promise.all([
      this.prisma.order.count({
        where: { driverId: userId, deliveryStatus: { in: [...ACTIVE] } },
      }),
      this.prisma.order.count({
        where: {
          driverId: userId,
          deliveryStatus: 'DELIVERED',
          deliveredAt: { gte: startOfToday() },
        },
      }),
      this.prisma.order.count({
        where: {
          driverId: userId,
          deliveryStatus: 'FAILED',
          updatedAt: { gte: startOfToday() },
        },
      }),
    ]);
    return {
      name: user.name,
      phone: user.phone,
      online: user.riderOnline,
      location: branch,
      today: { active, delivered, failed },
    };
  }

  async setDuty(userId: string, online: boolean) {
    if (!online) {
      const active = await this.prisma.order.count({
        where: { driverId: userId, deliveryStatus: { in: [...ACTIVE] } },
      });
      if (active > 0) {
        throw new ConflictException(
          'Finish your active deliveries before going offline',
        );
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: online ? { riderOnline: true } : { riderOnline: false },
    });
    return { online };
  }

  async setLocation(userId: string, lat: number, lng: number) {
    // Only an on-duty rider shares a position.
    const r = await this.prisma.user.updateMany({
      where: { id: userId, riderOnline: true },
      data: { riderLat: lat, riderLng: lng, riderLocationAt: new Date() },
    });
    return { saved: r.count === 1 };
  }

  async deliveries(userId: string) {
    const [active, done] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          driverId: userId,
          type: 'DELIVERY',
          deliveryStatus: { in: [...ACTIVE] },
        },
        include: CARD_INCLUDE,
        orderBy: { assignedAt: 'asc' },
        take: 50,
      }),
      this.prisma.order.findMany({
        where: {
          driverId: userId,
          type: 'DELIVERY',
          deliveryStatus: { in: ['DELIVERED', 'FAILED'] },
          updatedAt: { gte: startOfToday() },
        },
        include: CARD_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
    ]);
    return { active: active.map(present), done: done.map(present) };
  }

  async setStatus(
    userId: string,
    orderId: string,
    status: 'PICKED_UP' | 'DELIVERED' | 'FAILED',
    reason?: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, type: 'DELIVERY', driverId: userId },
      select: { id: true, branchId: true },
    });
    // The same answer for "not yours" and "does not exist".
    if (!order) throw new NotFoundException('Delivery not found');
    if (status === 'FAILED' && !reason?.trim()) {
      throw new BadRequestException(
        'Say why the delivery could not be completed',
      );
    }
    await this.delivery.setStatus(
      order.branchId,
      orderId,
      status,
      reason?.trim(),
    );
    const card = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: CARD_INCLUDE,
    });
    return present(card);
  }
}

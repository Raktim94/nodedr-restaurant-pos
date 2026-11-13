import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const VALID_FOR_MS = 14 * 86_400_000;

/** Free text from a stranger: trimmed, control characters and tags removed, whitespace collapsed, capped. Stored as text, rendered escaped. */
export function cleanComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return s.length ? s : null;
}

// Ratings. A guest can rate only the order they placed, and only once it is PAID. The right to rate is a signed token
// made when the order is placed: orderId + expiry + HMAC (server secret). It reveals nothing but an opaque id, cannot be
// forged or moved to another order, expires, and is useless without a completed order. One rating per order (database
// unique). A static menu QR alone gives no way to rate.
@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private sign(payload: string) {
    return createHmac('sha256', `${this.config.getOrThrow<string>('JWT_SECRET')}:order-rating`).update(payload).digest('base64url');
  }

  issue(orderId: string): string {
    const payload = Buffer.from(`${orderId}.${Date.now() + VALID_FOR_MS}`).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private open(token: string): string {
    const [payload, sig] = (token ?? '').split('.');
    if (!payload || !sig) throw new ForbiddenException('This rating link is not valid');
    const want = this.sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('This rating link is not valid');
    const [orderId, exp] = Buffer.from(payload, 'base64url').toString().split('.');
    if (!orderId || !(Number(exp) > Date.now())) throw new ForbiddenException('This rating link has expired');
    return orderId;
  }

  async status(token: string) {
    const orderId = this.open(token);
    const [order, rated] = await Promise.all([
      this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }),
      this.prisma.orderRating.findUnique({ where: { orderId }, select: { id: true } }),
    ]);
    if (!order) throw new NotFoundException('Order not found');
    return { eligible: order.status === 'PAID' && !rated, rated: !!rated, paid: order.status === 'PAID' };
  }

  async submit(token: string, stars: number, comment: unknown) {
    const orderId = this.open(token);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new BadRequestException('Choose 1 to 5 stars');
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, branchId: true, status: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PAID') throw new BadRequestException('You can rate once your order is complete and paid');
    try {
      await this.prisma.orderRating.create({ data: { branchId: order.branchId, orderId, stars, comment: cleanComment(comment) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Thank you, this order was already rated');
      throw e;
    }
    return { ok: true };
  }

  async list(branchId: string, f: { from?: Date; to?: Date }) {
    const where: Prisma.OrderRatingWhereInput = { branchId, ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) };
    const rows = await this.prisma.orderRating.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
    const orders = await this.prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, orderNumber: true, guestName: true, type: true } });
    const dist = [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: rows.filter((r) => r.stars === s).length }));
    const avg = rows.length ? Math.round((rows.reduce((a, r) => a + r.stars, 0) / rows.length) * 100) / 100 : null;
    return {
      count: rows.length,
      average: avg,
      distribution: dist,
      items: rows.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, createdAt: r.createdAt, order: orders.find((o) => o.id === r.orderId) ?? null })),
    };
  }
}

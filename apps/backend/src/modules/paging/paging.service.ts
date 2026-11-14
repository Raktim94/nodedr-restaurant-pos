import { createHmac, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

export interface BuzzerInput {
  name: string;
  number?: string | null;
  tableId?: string | null;
  driver?: 'SIMULATED' | 'WEBHOOK';
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  isActive?: boolean;
}

const OFFLINE_AFTER_MS = 45_000; // a polling device that has not been heard for this long is "offline"
const CALL_LIFETIME_MS = 10 * 60_000; // a call nobody collected is dropped after ten minutes
const REPEAT_WINDOW_MS = 20_000; // pressing Call twice within this returns the same call instead of buzzing again

// Paging: one buzzer per table. A call is created for an order, delivered by the buzzer's driver, and
// acknowledged by the device. SIMULATED devices (and the simulator page) poll with their token; WEBHOOK
// buzzers are pushed to a base station at webhookUrl with an HMAC-signed JSON body. Which real buzzer
// hardware speaks to which driver is NOT decided yet; nothing here claims compatibility with any product.
/** 169.254.0.0/16 and fe80::/10, including the IPv4-mapped IPv6 spellings of the former (`new URL()` writes them as hex). */
export function isLinkLocalHost(host: string): boolean {
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  return !!mapped && parseInt(mapped[1], 16) === 0xa9fe;
}

@Injectable()
export class PagingService {
  private readonly logger = new Logger(PagingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(branchId: string) {
    return this.prisma.buzzer
      .findMany({ where: { branchId }, orderBy: { name: 'asc' } })
      .then(async (rows) => {
        const tables = await this.prisma.table.findMany({
          where: {
            id: {
              in: rows.map((r) => r.tableId).filter((x): x is string => !!x),
            },
          },
          select: { id: true, number: true },
        });
        const active = await this.prisma.buzzerCall.findMany({
          where: {
            buzzerId: { in: rows.map((r) => r.id) },
            state: { in: ['PENDING', 'SENT'] },
            expiresAt: { gt: new Date() },
          },
        });
        return rows.map((r) => ({
          ...r,
          webhookSecret: undefined,
          hasSecret: !!r.webhookSecret,
          table: tables.find((t) => t.id === r.tableId)?.number ?? null,
          online: this.isOnline(r),
          activeCall: active.find((c) => c.buzzerId === r.id) ?? null,
        }));
      });
  }

  private isOnline(b: { driver: string; lastSeenAt: Date | null }) {
    // A webhook buzzer has no heartbeat of its own; its call result says whether the base station answered.
    return b.driver === 'WEBHOOK'
      ? null
      : !!b.lastSeenAt &&
          Date.now() - b.lastSeenAt.getTime() < OFFLINE_AFTER_MS;
  }

  async create(branchId: string, dto: BuzzerInput) {
    await this.checkInput(branchId, dto);
    try {
      return await this.prisma.buzzer.create({
        data: {
          branchId,
          name: dto.name,
          number: dto.number ?? null,
          tableId: dto.tableId ?? null,
          driver: dto.driver ?? 'SIMULATED',
          webhookUrl: dto.webhookUrl ?? null,
          webhookSecret: dto.webhookSecret ?? null,
          deviceToken: randomBytes(18).toString('base64url'),
        },
      });
    } catch (e) {
      throw this.clash(e);
    }
  }

  async update(branchId: string, id: string, dto: Partial<BuzzerInput>) {
    const b = await this.prisma.buzzer.findFirst({ where: { id, branchId } });
    if (!b) throw new NotFoundException('Buzzer not found');
    await this.checkInput(branchId, {
      name: b.name,
      driver: b.driver,
      webhookUrl: b.webhookUrl,
      ...dto,
    });
    try {
      return await this.prisma.buzzer.update({
        where: { id },
        data: {
          ...dto,
          webhookSecret: dto.webhookSecret === '' ? null : dto.webhookSecret,
        },
      });
    } catch (e) {
      throw this.clash(e);
    }
  }

  async remove(branchId: string, id: string) {
    const r = await this.prisma.buzzer.deleteMany({ where: { id, branchId } });
    if (r.count === 0) throw new NotFoundException('Buzzer not found');
    return { ok: true };
  }

  private clash(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      return new ConflictException(
        'That name or table is already used by another buzzer.',
      );
    return e;
  }

  private async checkInput(branchId: string, dto: Partial<BuzzerInput>) {
    // The public demo must never make the server call an address a visitor typed in.
    if (
      process.env.DEMO_MODE === 'true' &&
      (dto.driver ?? 'SIMULATED') === 'WEBHOOK'
    )
      throw new BadRequestException(
        'Webhook buzzers are switched off in the public demo. Use the polling type and the Simulator.',
      );
    if (dto.tableId) {
      const t = await this.prisma.table.findFirst({
        where: { id: dto.tableId, floor: { branchId } },
      });
      if (!t) throw new NotFoundException('Table not found');
    }
    if ((dto.driver ?? 'SIMULATED') === 'WEBHOOK') {
      let u: URL | null = null;
      try {
        u = new URL(dto.webhookUrl ?? '');
      } catch {
        /* handled below */
      }
      if (!u || !['http:', 'https:'].includes(u.protocol))
        throw new BadRequestException(
          'Give the base station address as an http:// or https:// URL',
        );
      // A buzzer base station lives on the restaurant's own network, so private addresses are normal here. Link-local
      // (169.254.0.0/16, fe80::/10) is not: it is where cloud metadata services answer, and no base station is there.
      const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (u.username || u.password || isLinkLocalHost(host))
        throw new BadRequestException(
          'That address cannot be used for a base station',
        );
    }
  }

  // ---- calling ------------------------------------------------------------------------------------

  /** Page the table of an order (kitchen: "this is ready"). */
  async callForOrder(
    branchId: string,
    userId: string,
    orderId: string,
    repeat = false,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      select: { id: true, tableId: true, orderNumber: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLED')
      throw new BadRequestException('That order was cancelled');
    if (!order.tableId)
      throw new BadRequestException(
        'This order has no table, so there is no buzzer to page',
      );
    const buzzer = await this.prisma.buzzer.findFirst({
      where: { branchId, tableId: order.tableId, isActive: true },
    });
    if (!buzzer)
      throw new NotFoundException(
        'No buzzer is assigned to that table. Assign one under Settings > Buzzers.',
      );

    if (!repeat) {
      const recent = await this.prisma.buzzerCall.findFirst({
        where: {
          buzzerId: buzzer.id,
          orderId,
          state: { in: ['PENDING', 'SENT'] },
          createdAt: { gt: new Date(Date.now() - REPEAT_WINDOW_MS) },
        },
      });
      if (recent)
        return {
          call: recent,
          buzzer: this.brief(buzzer),
          duplicate: true,
          deviceOnline: this.isOnline(buzzer),
        };
    }
    const call = await this.prisma.buzzerCall.create({
      data: {
        buzzerId: buzzer.id,
        orderId,
        tableId: order.tableId,
        createdById: userId,
        expiresAt: new Date(Date.now() + CALL_LIFETIME_MS),
      },
    });
    const out =
      buzzer.driver === 'WEBHOOK'
        ? await this.deliverWebhook(buzzer, call.id, order.orderNumber)
        : call;
    this.realtime.emitToBranch(branchId, 'buzzer.called', {
      buzzerId: buzzer.id,
      tableId: order.tableId,
      orderId,
      callId: call.id,
    });
    return {
      call: out,
      buzzer: this.brief(buzzer),
      duplicate: false,
      deviceOnline: this.isOnline(buzzer),
    };
  }

  /** A test call that is not tied to an order. */
  async testCall(branchId: string, userId: string, buzzerId: string) {
    const b = await this.prisma.buzzer.findFirst({
      where: { id: buzzerId, branchId },
    });
    if (!b) throw new NotFoundException('Buzzer not found');
    const call = await this.prisma.buzzerCall.create({
      data: {
        buzzerId: b.id,
        tableId: b.tableId,
        createdById: userId,
        expiresAt: new Date(Date.now() + CALL_LIFETIME_MS),
      },
    });
    const out =
      b.driver === 'WEBHOOK'
        ? await this.deliverWebhook(b, call.id, 'TEST')
        : call;
    return { call: out, deviceOnline: this.isOnline(b) };
  }

  private brief(b: {
    id: string;
    name: string;
    number: string | null;
    driver: string;
  }) {
    return { id: b.id, name: b.name, number: b.number, driver: b.driver };
  }

  private async deliverWebhook(
    b: {
      id: string;
      webhookUrl: string | null;
      webhookSecret: string | null;
      number: string | null;
      tableId: string | null;
    },
    callId: string,
    label: string,
  ) {
    const body = JSON.stringify({
      event: 'page',
      callId,
      buzzerId: b.id,
      buzzerNumber: b.number,
      tableId: b.tableId,
      label,
      sentAt: new Date().toISOString(),
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (b.webhookSecret)
      headers['X-OrderRestro-Signature'] = createHmac('sha256', b.webhookSecret)
        .update(body)
        .digest('hex');
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      // A base station answers directly; following a redirect would let a configured address bounce the call elsewhere.
      const res = await fetch(b.webhookUrl!, {
        method: 'POST',
        headers,
        body,
        signal: ctl.signal,
        redirect: 'error',
      }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`The base station answered ${res.status}`);
      return this.prisma.buzzerCall.update({
        where: { id: callId },
        data: { state: 'SENT', sentAt: new Date() },
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Could not reach the base station';
      this.logger.warn(`Buzzer ${b.id} call failed: ${msg}`);
      return this.prisma.buzzerCall.update({
        where: { id: callId },
        data: { state: 'FAILED', error: msg.slice(0, 200) },
      });
    }
  }

  async callsForOrder(branchId: string, orderId: string) {
    return this.prisma.buzzerCall.findMany({
      where: { orderId, buzzer: { branchId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  /** Staff clears a call (the guest came and the device did not report it). */
  async ackByStaff(branchId: string, callId: string) {
    const r = await this.prisma.buzzerCall.updateMany({
      where: {
        id: callId,
        buzzer: { branchId },
        state: { in: ['PENDING', 'SENT', 'FAILED'] },
      },
      data: { state: 'ACKED', ackedAt: new Date() },
    });
    if (r.count === 0)
      throw new BadRequestException('That call is already finished');
    return { ok: true };
  }

  // ---- the device (no login; its token is the key) -------------------------------------------------

  private async byToken(token: string) {
    const b = await this.prisma.buzzer.findUnique({
      where: { deviceToken: token },
    });
    if (!b || !b.isActive)
      throw new NotFoundException('Unknown or switched-off buzzer');
    return b;
  }

  /** The device asks "is there a page for me?". Also its heartbeat. */
  async poll(token: string) {
    const b = await this.byToken(token);
    await this.prisma.buzzer.update({
      where: { id: b.id },
      data: { lastSeenAt: new Date() },
    });
    await this.prisma.buzzerCall.updateMany({
      where: {
        buzzerId: b.id,
        state: { in: ['PENDING', 'SENT'] },
        expiresAt: { lte: new Date() },
      },
      data: { state: 'EXPIRED' },
    });
    const call = await this.prisma.buzzerCall.findFirst({
      where: { buzzerId: b.id, state: { in: ['PENDING', 'SENT'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (call && call.state === 'PENDING')
      await this.prisma.buzzerCall.update({
        where: { id: call.id },
        data: { state: 'SENT', sentAt: new Date() },
      });
    return {
      buzzer: { id: b.id, name: b.name, number: b.number },
      call: call
        ? { id: call.id, createdAt: call.createdAt, orderId: call.orderId }
        : null,
      serverTime: Date.now(),
    };
  }

  async ack(token: string, callId: string) {
    const b = await this.byToken(token);
    const r = await this.prisma.buzzerCall.updateMany({
      where: { id: callId, buzzerId: b.id, state: { in: ['PENDING', 'SENT'] } },
      data: { state: 'ACKED', ackedAt: new Date() },
    });
    if (r.count > 0)
      this.realtime.emitToBranch(b.branchId, 'buzzer.acked', {
        buzzerId: b.id,
        callId,
      });
    return { ok: true, changed: r.count > 0 };
  }
}

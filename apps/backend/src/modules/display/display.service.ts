import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  playableAds,
  type AdDto,
  type DisplayStateDto,
  type TerminalDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';

const token = () => randomBytes(18).toString('base64url');

// One record per customer screen. The staff screen writes the state; the customer screen only ever reads
// it with its own token, so the token on a shop-window display can show an order total and nothing else.
@Injectable()
export class DisplayService {
  constructor(private readonly prisma: PrismaService) {}

  terminals(branchId: string) {
    return this.prisma.displayTerminal.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async createTerminal(branchId: string, dto: TerminalDto) {
    try {
      return await this.prisma.displayTerminal.create({
        data: { ...dto, branchId, token: token() },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'There is already a screen with that name.',
        );
      throw e;
    }
  }

  async updateTerminal(
    branchId: string,
    id: string,
    dto: Partial<TerminalDto>,
  ) {
    await this.own(branchId, id);
    return this.prisma.displayTerminal.update({ where: { id }, data: dto });
  }

  async rotateToken(branchId: string, id: string) {
    await this.own(branchId, id);
    return this.prisma.displayTerminal.update({
      where: { id },
      data: { token: token() },
    });
  }

  async deleteTerminal(branchId: string, id: string) {
    await this.own(branchId, id);
    await this.prisma.displayTerminal.delete({ where: { id } });
    return { ok: true };
  }

  private async own(branchId: string, id: string) {
    const t = await this.prisma.displayTerminal.findFirst({
      where: { id, branchId },
    });
    if (!t) throw new NotFoundException('Screen not found');
    return t;
  }

  /** The staff screen reports what is on the counter now. */
  async pushState(branchId: string, id: string, state: DisplayStateDto) {
    await this.own(branchId, id);
    await this.prisma.displayTerminal.update({
      where: { id },
      data: { state: state, stateAt: new Date() },
    });
    return { ok: true };
  }

  // ---- adverts ----------------------------------------------------------------------------------

  ads(branchId: string) {
    return this.prisma.displayAd.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createAd(branchId: string, dto: AdDto) {
    if (dto.terminalId) await this.own(branchId, dto.terminalId);
    return this.prisma.displayAd.create({
      data: {
        ...dto,
        branchId,
        terminalId: dto.terminalId ?? null,
        startsOn: dto.startsOn ?? null,
        endsOn: dto.endsOn ?? null,
        durationSec: dto.durationSec ?? null,
      },
    });
  }

  async updateAd(branchId: string, id: string, dto: Partial<AdDto>) {
    const a = await this.prisma.displayAd.findFirst({
      where: { id, branchId },
    });
    if (!a) throw new NotFoundException('Advert not found');
    return this.prisma.displayAd.update({ where: { id }, data: dto });
  }

  async deleteAd(branchId: string, id: string) {
    const r = await this.prisma.displayAd.deleteMany({
      where: { id, branchId },
    });
    if (r.count === 0) throw new NotFoundException('Advert not found');
    return { ok: true };
  }

  // ---- what the customer screen reads (public, by token) ------------------------------------------

  async publicView(tok: string) {
    const t = await this.prisma.displayTerminal.findUnique({
      where: { token: tok },
      include: {
        branch: { select: { restaurant: { select: { currency: true } } } },
      },
    });
    if (!t || !t.isActive)
      throw new NotFoundException(
        'This screen is not set up or has been switched off',
      );
    // lastSeenAt is a heartbeat for the staff list; skip the write if it is fresh to keep the poll cheap.
    if (!t.lastSeenAt || Date.now() - t.lastSeenAt.getTime() > 10_000) {
      await this.prisma.displayTerminal.update({
        where: { id: t.id },
        data: { lastSeenAt: new Date() },
      });
    }
    const all = await this.prisma.displayAd.findMany({
      where: { branchId: t.branchId, isActive: true },
    });
    const ads = playableAds(
      all.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.url,
        title: a.title,
        durationSec: a.durationSec,
        terminalId: a.terminalId,
        isActive: a.isActive,
        startsOn: a.startsOn,
        endsOn: a.endsOn,
        sortOrder: a.sortOrder,
      })),
      t.id,
      new Date(),
    );
    return {
      terminal: {
        id: t.id,
        name: t.name,
        idleSeconds: t.idleSeconds,
        thankYouSeconds: t.thankYouSeconds,
        adSlideSeconds: t.adSlideSeconds,
        adFit: t.adFit,
      },
      state: t.state ?? { kind: 'idle' },
      stateAt: t.stateAt ? t.stateAt.getTime() : null,
      serverTime: Date.now(),
      currency: t.branch.restaurant.currency,
      ads,
    };
  }
}

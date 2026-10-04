import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CampaignDto,
  CouponDto,
  PromotionDto,
} from '@nodedr-restaurant/types';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { localMinuteAndDay } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  discountAmount,
  evaluateCoupon,
  fromMinutes,
  promotionActive,
  round2,
  toMinutes,
} from './discounts';

export interface CheckoutDiscount {
  amount: number;
  couponId?: string;
  couponCode?: string;
  promotionName?: string;
}

const asDate = (s?: string) => (s ? new Date(s) : null);

@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
    private readonly email: EmailService,
    private readonly webhooks: WebhooksService,
  ) {}

  // --- Coupons -------------------------------------------------------------

  listCoupons(branchId: string) {
    return this.prisma.coupon.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCoupon(branchId: string, dto: CouponDto) {
    const code = dto.code.toUpperCase();
    const clash = await this.prisma.coupon.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (clash) throw new BadRequestException('That coupon code already exists');
    return this.prisma.coupon.create({
      data: {
        branchId,
        code,
        kind: dto.kind,
        value: dto.value,
        minOrderAmount: dto.minOrderAmount,
        maxDiscount: dto.maxDiscount,
        validFrom: asDate(dto.validFrom),
        validUntil: asDate(dto.validUntil),
        usageLimit: dto.usageLimit,
        isActive: dto.isActive,
      },
    });
  }

  async setCouponActive(branchId: string, id: string, isActive: boolean) {
    await this.getCoupon(branchId, id);
    return this.prisma.coupon.update({ where: { id }, data: { isActive } });
  }

  async deleteCoupon(branchId: string, id: string) {
    await this.getCoupon(branchId, id);
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  private async getCoupon(branchId: string, id: string) {
    const c = await this.prisma.coupon.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException('Coupon not found');
    return c;
  }

  // --- Promotions (happy hour) --------------------------------------------

  async listPromotions(branchId: string) {
    const rows = await this.prisma.promotion.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((p) => ({
      ...p,
      startTime: fromMinutes(p.startMinute),
      endTime: fromMinutes(p.endMinute),
    }));
  }

  createPromotion(branchId: string, dto: PromotionDto) {
    return this.prisma.promotion.create({
      data: {
        branchId,
        name: dto.name,
        kind: dto.kind,
        value: dto.value,
        daysOfWeek: [...new Set(dto.daysOfWeek)].sort(),
        startMinute: toMinutes(dto.startTime),
        endMinute: toMinutes(dto.endTime),
        isActive: dto.isActive,
      },
    });
  }

  async setPromotionActive(branchId: string, id: string, isActive: boolean) {
    const p = await this.prisma.promotion.findFirst({
      where: { id, branchId },
    });
    if (!p) throw new NotFoundException('Promotion not found');
    return this.prisma.promotion.update({ where: { id }, data: { isActive } });
  }

  async deletePromotion(branchId: string, id: string) {
    const p = await this.prisma.promotion.findFirst({
      where: { id, branchId },
    });
    if (!p) throw new NotFoundException('Promotion not found');
    await this.prisma.promotion.delete({ where: { id } });
    return { ok: true };
  }

  // --- Checkout integration -----------------------------------------------

  /**
   * The automatic discount for a bill: the better of a valid coupon and any
   * active happy-hour promotion (they do not stack). A bad coupon code is an
   * error the cashier should see, not something to silently ignore.
   */
  async resolveCheckoutDiscount(
    branchId: string,
    subtotal: number,
    couponCode: string | undefined,
    now = new Date(),
  ): Promise<CheckoutDiscount> {
    let best: CheckoutDiscount = { amount: 0 };

    const tz = await this.time.tzForBranch(branchId);
    const { day, minute } = localMinuteAndDay(now, tz);
    const promos = await this.prisma.promotion.findMany({
      where: { branchId, isActive: true },
    });
    for (const p of promos) {
      if (!promotionActive({ ...p, value: Number(p.value) }, day, minute))
        continue;
      const amount = discountAmount(p.kind, Number(p.value), subtotal);
      if (amount > best.amount) best = { amount, promotionName: p.name };
    }

    if (couponCode) {
      const coupon = await this.prisma.coupon.findUnique({
        where: {
          branchId_code: { branchId, code: couponCode.trim().toUpperCase() },
        },
      });
      if (!coupon)
        throw new BadRequestException('That coupon code is not valid');
      const result = evaluateCoupon(
        {
          kind: coupon.kind,
          value: Number(coupon.value),
          minOrderAmount: Number(coupon.minOrderAmount),
          maxDiscount:
            coupon.maxDiscount == null ? null : Number(coupon.maxDiscount),
          validFrom: coupon.validFrom,
          validUntil: coupon.validUntil,
          usageLimit: coupon.usageLimit,
          usedCount: coupon.usedCount,
          isActive: coupon.isActive,
        },
        subtotal,
        now,
      );
      if (!result.ok) throw new BadRequestException(result.reason);
      if (result.amount >= best.amount) {
        best = {
          amount: result.amount,
          couponId: coupon.id,
          couponCode: coupon.code,
        };
      }
    }
    return { ...best, amount: round2(best.amount) };
  }

  /** Counts one use, atomically refusing once the limit is reached. */
  async redeemCoupon(tx: Prisma.TransactionClient, couponId: string) {
    const updated = await tx.$executeRaw`
      UPDATE "coupons" SET "usedCount" = "usedCount" + 1
      WHERE "id" = ${couponId}
        AND "isActive" = true
        AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
    if (updated === 0)
      throw new ConflictException('This coupon has just been fully used');
  }

  // --- Campaigns -----------------------------------------------------------

  listCampaigns(branchId: string) {
    return this.prisma.campaign.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createCampaign(branchId: string, dto: CampaignDto) {
    return this.prisma.campaign.create({ data: { branchId, ...dto } });
  }

  async deleteCampaign(branchId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, branchId } });
    if (!c) throw new NotFoundException('Campaign not found');
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }

  /** Customers a campaign would reach, with the contact detail its channel needs. */
  async audience(branchId: string, campaignId: string) {
    const c = await this.prisma.campaign.findFirst({
      where: { id: campaignId, branchId },
    });
    if (!c) throw new NotFoundException('Campaign not found');
    const tz = await this.time.tzForBranch(branchId);
    const customers = await this.prisma.customer.findMany({
      where: {
        branchId,
        marketingOptOut: false,
        ...(c.channel === 'EMAIL'
          ? { email: { not: null } }
          : { phone: { not: null } }),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        birthday: true,
        orders: {
          where: { status: 'PAID' },
          select: { billedAt: true },
          orderBy: { billedAt: 'desc' },
        },
      },
    });
    const now = new Date();
    const month = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        month: 'numeric',
      }).format(now),
    );
    const cutoff = now.getTime() - 60 * 86_400_000;
    const picked = customers.filter((cu) => {
      if (c.segment === 'ALL') return true;
      if (c.segment === 'LOYAL') return cu.orders.length >= 5;
      if (c.segment === 'LAPSED') {
        const last = cu.orders[0]?.billedAt?.getTime();
        return last != null && last < cutoff;
      }
      return cu.birthday != null && cu.birthday.getUTCMonth() + 1 === month;
    });
    return {
      campaign: c,
      recipients: picked.map((cu) => ({
        name: cu.name ?? '',
        contact: (c.channel === 'EMAIL' ? cu.email : cu.phone) ?? '',
      })),
    };
  }

  /**
   * Sends a campaign. Email goes out through the operator's SMTP server. SMS
   * and WhatsApp need a provider, so each message is handed to the
   * restaurant's webhook (`campaign.message`) for an automation service to
   * deliver. A campaign can be sent once an hour, so a double-click or a
   * retry loop cannot spam customers.
   */
  async send(branchId: string, campaignId: string) {
    const { campaign, recipients } = await this.audience(branchId, campaignId);
    if (
      campaign.lastSentAt &&
      Date.now() - campaign.lastSentAt.getTime() < 3600_000
    )
      throw new BadRequestException(
        'This campaign was sent less than an hour ago',
      );
    if (recipients.length === 0)
      throw new BadRequestException('No customers match this campaign yet');
    if (recipients.length > 500)
      throw new BadRequestException(
        'A campaign can reach at most 500 customers at once — narrow the audience',
      );

    // Reserve the send slot first (atomic), so two simultaneous clicks
    // cannot both pass the check above and send twice.
    const reserved = await this.prisma.campaign.updateMany({
      where: {
        id: campaign.id,
        OR: [
          { lastSentAt: null },
          { lastSentAt: { lt: new Date(Date.now() - 3600_000) } },
        ],
      },
      data: { lastSentAt: new Date(), lastSentCount: 0 },
    });
    if (reserved.count === 0)
      throw new BadRequestException('This campaign is already being sent');

    let result: { sent: number; failed: number };
    if (campaign.channel === 'EMAIL') {
      if (!this.email.isConfigured())
        throw await this.releaseAndFail(
          campaign.id,
          'Email is not set up on this server (SMTP_URL / SMTP_FROM)',
        );
      const restaurant = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { restaurant: { select: { name: true } } },
      });
      const footer = `\n\n—\nYou are receiving this because you are a customer of ${restaurant?.restaurant.name ?? 'our restaurant'}. Reply to this email to stop receiving offers.`;
      result = await this.email.sendEach(
        recipients.map((r) => ({
          to: r.contact,
          subject: campaign.name,
          text: campaign.message + footer,
        })),
      );
    } else {
      const hasHook = await this.webhooks.hasSubscriber(
        branchId,
        'campaign.message',
      );
      if (!hasHook)
        throw await this.releaseAndFail(
          campaign.id,
          `Sending ${campaign.channel === 'SMS' ? 'SMS' : 'WhatsApp'} needs a webhook subscribed to "campaign.message" (Settings > Webhooks) connected to your messaging service`,
        );
      for (const r of recipients) {
        await this.webhooks.emitForBranch(branchId, 'campaign.message', {
          campaignId: campaign.id,
          channel: campaign.channel,
          to: r.contact,
          name: r.name,
          message: campaign.message,
        });
      }
      result = { sent: recipients.length, failed: 0 };
    }
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { lastSentCount: result.sent },
    });
    return result;
  }

  private async releaseAndFail(campaignId: string, message: string) {
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { lastSentAt: null, lastSentCount: null },
    });
    return new BadRequestException(message);
  }
}

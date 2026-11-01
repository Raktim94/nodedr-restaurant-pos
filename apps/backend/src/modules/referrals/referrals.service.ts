import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

// Unambiguous characters only (no 0/O, 1/I): codes get read out and typed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-Z0-9]{6,12}$/;

const digits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '');
/** Compare phones by their last 10 digits so +91 / 0 prefixes do not hide a self-referral. */
const samePhone = (a: string | null, b: string | null) => {
  const x = digits(a).slice(-10);
  const y = digits(b).slice(-10);
  return x.length >= 6 && x === y;
};

export type AttachResult =
  | { applied: true; referrerName: string | null }
  | { applied: false; reason: string };

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async config(restaurantId: string) {
    const r = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: {
        referralEnabled: true,
        referralSharerPoints: true,
        referralReferredPoints: true,
        referralMinPurchase: true,
        onlineMinOrderAmount: true,
        loyaltyPointValue: true,
        currency: true,
      },
    });
    return {
      enabled: r.referralEnabled,
      sharerPoints: r.referralSharerPoints,
      referredPoints: r.referralReferredPoints,
      minPurchase: Number(r.referralMinPurchase),
      onlineMinOrder: Number(r.onlineMinOrderAmount),
      pointValue: Number(r.loyaltyPointValue),
      currency: r.currency,
    };
  }

  /** The customer's own code, created on first use. Safe under concurrency. */
  async codeFor(customerId: string): Promise<string> {
    const c = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { referralCode: true },
    });
    if (c.referralCode) return c.referralCode;
    for (let i = 0; i < 6; i++) {
      const bytes = randomBytes(7);
      const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join(
        '',
      );
      try {
        // Only fills an empty slot, so two racing requests keep one code.
        const r = await this.prisma.customer.updateMany({
          where: { id: customerId, referralCode: null },
          data: { referralCode: code },
        });
        if (r.count === 0) break;
        return code;
      } catch (e) {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2002'
        )
          throw e;
      }
    }
    return (
      await this.prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { referralCode: true },
      })
    ).referralCode as string;
  }

  /**
   * Record that `referredId` came through `code`. Attribution only - no points
   * move until the referred customer's first purchase is paid.
   * Refused (quietly, the order still goes ahead) for: referrals switched off,
   * unknown code, a customer referring themselves, a customer who has already
   * ordered or already been referred.
   */
  async attach(
    restaurantId: string,
    referredId: string,
    rawCode: string,
    sharedItemId?: string,
  ): Promise<AttachResult> {
    const no = (reason: string): AttachResult => ({ applied: false, reason });
    const code = rawCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) return no('Invalid referral code');
    const cfg = await this.config(restaurantId);
    if (!cfg.enabled) return no('Referral rewards are not active');

    const referrer = await this.prisma.customer.findFirst({
      where: { referralCode: code, branch: { restaurantId } },
    });
    if (!referrer) return no('Unknown referral code');
    const referred = await this.prisma.customer.findFirst({
      where: { id: referredId, branch: { restaurantId } },
    });
    if (!referred) return no('Unknown customer');

    if (
      referrer.id === referred.id ||
      samePhone(referrer.phone, referred.phone)
    ) {
      return no('You cannot use your own referral code');
    }
    const existing = await this.prisma.referral.findUnique({
      where: { referredId },
    });
    if (existing) return no('This customer was already referred');

    // "New customer": nothing ordered yet apart from what is being placed now.
    const prior = await this.prisma.order.count({
      where: {
        customerId: referredId,
        status: { in: ['PAID', 'BILLED'] },
      },
    });
    if (prior > 0) return no('Referral rewards are for new customers');

    // Also not new if this same person already ordered under another branch's record.
    if (referred.phone) {
      const tail = digits(referred.phone).slice(-10);
      if (tail.length >= 6) {
        const others = await this.prisma.customer.findMany({
          where: {
            branch: { restaurantId },
            id: { not: referred.id },
            phone: { endsWith: tail },
          },
          select: { id: true },
        });
        if (others.length) {
          const paid = await this.prisma.order.count({
            where: {
              customerId: { in: others.map((o) => o.id) },
              status: 'PAID',
            },
          });
          if (paid > 0) return no('Referral rewards are for new customers');
        }
      }
    }

    try {
      await this.prisma.referral.create({
        data: {
          branchId: referred.branchId,
          code,
          referrerId: referrer.id,
          referredId,
          sharedItemId: sharedItemId?.slice(0, 64),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return no('This customer was already referred');
      }
      throw e;
    }
    return { applied: true, referrerName: referrer.name };
  }

  /**
   * Called inside the payment transaction when an order becomes fully PAID.
   * The PENDING -> REWARDED update is the claim: only one caller can win it,
   * so a retried or concurrent checkout can never pay the rewards twice. The
   * ledger rows carry unique keys as a second guard.
   */
  async onOrderPaid(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      branchId: string;
      customerId: string | null;
      totalAmount: number;
      /** Items total before discounts: what the minimum-purchase rule is measured on. */
      foodValue: number;
    },
  ) {
    if (!order.customerId || !(order.totalAmount > 0)) return;
    const referral = await tx.referral.findUnique({
      where: { referredId: order.customerId },
    });
    if (!referral || referral.status !== 'PENDING') return;

    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: order.branchId },
      select: {
        restaurant: {
          select: {
            referralEnabled: true,
            referralSharerPoints: true,
            referralReferredPoints: true,
            referralMinPurchase: true,
          },
        },
      },
    });
    const r = branch.restaurant;
    if (!r.referralEnabled) return; // stays pending; pays if switched back on
    // A small first order does not qualify; the referral stays pending for a later, bigger one.
    if (order.foodValue < Number(r.referralMinPurchase)) return;

    const claim = await tx.referral.updateMany({
      where: { id: referral.id, status: 'PENDING' },
      data: {
        status: 'REWARDED',
        rewardedAt: new Date(),
        qualifyingOrderId: order.id,
        referrerPoints: r.referralSharerPoints,
        referredPoints: r.referralReferredPoints,
      },
    });
    if (claim.count !== 1) return;

    await this.credit(tx, {
      branchId: referral.branchId,
      customerId: referral.referredId,
      points: r.referralReferredPoints,
      reason: 'REFERRAL_REFERRED',
      key: `referral:${referral.id}:referred`,
      referralId: referral.id,
      orderId: order.id,
    });
    await this.credit(tx, {
      branchId: referral.branchId,
      customerId: referral.referrerId,
      points: r.referralSharerPoints,
      reason: 'REFERRAL_REFERRER',
      key: `referral:${referral.id}:referrer`,
      referralId: referral.id,
      orderId: order.id,
    });
  }

  private async credit(
    tx: Prisma.TransactionClient,
    a: {
      branchId: string;
      customerId: string;
      points: number;
      reason: string;
      key: string;
      referralId?: string;
      orderId?: string;
    },
  ) {
    if (a.points <= 0) return;
    await tx.pointsLedger.create({
      data: {
        branchId: a.branchId,
        customerId: a.customerId,
        delta: a.points,
        reason: a.reason,
        referralId: a.referralId,
        orderId: a.orderId,
        idempotencyKey: a.key,
      },
    });
    await tx.customer.update({
      where: { id: a.customerId },
      data: { loyaltyPoints: { increment: a.points } },
    });
  }

  /** Audit rows for ordinary earn / redeem, keyed by order so a replay is a no-op. */
  async recordOrderPoints(
    tx: Prisma.TransactionClient,
    a: {
      branchId: string;
      customerId: string;
      orderId: string;
      earned: number;
      redeemed: number;
    },
  ) {
    const rows: Prisma.PointsLedgerCreateManyInput[] = [];
    if (a.earned > 0) {
      rows.push({
        branchId: a.branchId,
        customerId: a.customerId,
        delta: a.earned,
        reason: 'EARN',
        orderId: a.orderId,
        idempotencyKey: `earn:${a.orderId}`,
      });
    }
    if (a.redeemed > 0) {
      rows.push({
        branchId: a.branchId,
        customerId: a.customerId,
        delta: -a.redeemed,
        reason: 'REDEEM',
        orderId: a.orderId,
        idempotencyKey: `redeem:${a.orderId}`,
      });
    }
    if (rows.length)
      await tx.pointsLedger.createMany({ data: rows, skipDuplicates: true });
  }

  /** Everything a customer-facing screen needs: balance, value, rewards, share link data. */
  async summary(restaurantId: string, customerId: string) {
    const db = this.prisma;
    const cfg = await this.config(restaurantId);
    const c = await db.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true, name: true, phone: true, loyaltyPoints: true },
    });
    const code = cfg.enabled ? await this.codeFor(customerId) : null;
    const [invited, rewarded, earned, ledger] = await Promise.all([
      db.referral.count({ where: { referrerId: customerId } }),
      db.referral.count({
        where: { referrerId: customerId, status: 'REWARDED' },
      }),
      db.pointsLedger.aggregate({
        where: { customerId, reason: 'REFERRAL_REFERRER' },
        _sum: { delta: true },
      }),
      db.pointsLedger.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { delta: true, reason: true, createdAt: true },
      }),
    ]);
    const pts = c.loyaltyPoints;
    const value = cfg.pointValue;
    const round = (n: number) => Math.round(n * 100) / 100;
    // "Available rewards": the discount the balance buys, offered in sensible steps.
    const steps = [100, 250, 500, 1000, 2500, 5000].filter((s) => s <= pts);
    if (pts > 0 && !steps.includes(pts)) steps.push(pts);
    const referred = await db.referral.findUnique({
      where: { referredId: customerId },
      select: { status: true },
    });
    return {
      referralEnabled: cfg.enabled,
      code,
      points: pts,
      pointValue: value,
      currency: cfg.currency,
      balanceValue: round(pts * value),
      sharerPoints: cfg.sharerPoints,
      referredPoints: cfg.referredPoints,
      minPurchase: cfg.minPurchase,
      onlineMinOrder: cfg.onlineMinOrder,
      rewards: steps.map((p) => ({ points: p, discount: round(p * value) })),
      invited,
      rewarded,
      pointsFromReferrals: earned._sum.delta ?? 0,
      referredBy: referred?.status ?? null,
      history: ledger,
    };
  }
}

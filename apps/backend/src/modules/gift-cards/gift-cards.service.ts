import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { IssueGiftCardDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../orders/pricing';

@Injectable()
export class GiftCardsService {
  constructor(private readonly prisma: PrismaService) {}

  list(branchId: string) {
    return this.prisma.giftCard.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    });
  }

  issue(branchId: string, dto: IssueGiftCardDto) {
    const code = randomBytes(6).toString('hex').toUpperCase();
    const value = round2(dto.initialValue);
    return this.prisma.giftCard.create({
      data: {
        branchId,
        code,
        initialValue: value,
        balance: value,
        customerId: dto.customerId,
      },
    });
  }

  async getByCode(branchId: string, code: string) {
    const card = await this.prisma.giftCard.findFirst({
      where: { code: code.toUpperCase(), branchId },
    });
    if (!card) throw new NotFoundException('Gift card not found');
    return card;
  }

  /**
   * Debits up to `maxAmount` from the card (never more than its balance),
   * returns the amount actually applied. Caller runs this inside the same
   * `$transaction` as the order update — read-modify-write with `round2` +
   * `set`, never a DB-side `increment` on this Float balance (see
   * nodedr-pos's float-drift lesson referenced in ARCHITECTURE.md).
   */
  async debit(
    tx: Prisma.TransactionClient,
    branchId: string,
    code: string,
    maxAmount: number,
  ): Promise<{ giftCardId: string; amountApplied: number }> {
    const card = await tx.giftCard.findFirst({
      where: { code: code.toUpperCase(), branchId },
    });
    if (!card || !card.isActive)
      throw new BadRequestException('Gift card not found or inactive');

    const balance = Number(card.balance);
    if (balance <= 0)
      throw new BadRequestException('Gift card has no balance remaining');

    const amountApplied = round2(Math.min(balance, maxAmount));
    await tx.giftCard.update({
      where: { id: card.id },
      data: { balance: round2(balance - amountApplied) },
    });

    return { giftCardId: card.id, amountApplied };
  }
}

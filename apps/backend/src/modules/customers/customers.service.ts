import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomerDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(branchId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        branchId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(branchId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, branchId },
      include: {
        orders: {
          where: { status: 'PAID' },
          orderBy: { billedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            billedAt: true,
          },
        },
        giftCards: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  create(branchId: string, dto: CustomerDto) {
    return this.prisma.customer.create({ data: { ...dto, branchId } });
  }

  async update(branchId: string, id: string, dto: Partial<CustomerDto>) {
    await this.assertInBranch(branchId, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  // Hard delete — Order.customerId and GiftCard.customerId are both
  // optional with onDelete: SetNull (schema.prisma), so this never orphans
  // or blocks on past orders/gift cards; it just detaches them from the
  // profile being removed.
  async remove(branchId: string, id: string) {
    await this.assertInBranch(branchId, id);
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }

  private async assertInBranch(branchId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, branchId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }
}

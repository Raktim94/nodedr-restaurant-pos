import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CustomerAddressDto,
  CustomerAddressUpdateDto,
  CustomerDto,
} from '@nodedr-restaurant/types';
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
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
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

  // ---- Saved delivery addresses -------------------------------------------

  async listAddresses(branchId: string, customerId: string) {
    await this.assertInBranch(branchId, customerId);
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async addAddress(
    branchId: string,
    customerId: string,
    dto: CustomerAddressDto,
  ) {
    await this.assertInBranch(branchId, customerId);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.customerAddress.count({ where: { customerId } });
      // The first address is the default; asking for a new default demotes
      // the old one in the same transaction so there is only ever one.
      const isDefault = count === 0 || dto.isDefault === true;
      if (isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.create({
        data: { ...dto, customerId, isDefault },
      });
    });
  }

  async updateAddress(
    branchId: string,
    customerId: string,
    addressId: string,
    dto: CustomerAddressUpdateDto,
  ) {
    await this.assertInBranch(branchId, customerId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId },
      });
      if (!existing) throw new NotFoundException('Address not found');
      if (dto.isDefault === true) {
        await tx.customerAddress.updateMany({
          where: { customerId, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }
      // Never leave a customer with addresses but no default.
      const data =
        dto.isDefault === false && existing.isDefault
          ? { ...dto, isDefault: true }
          : dto;
      return tx.customerAddress.update({ where: { id: addressId }, data });
    });
  }

  async removeAddress(branchId: string, customerId: string, addressId: string) {
    await this.assertInBranch(branchId, customerId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId },
      });
      if (!existing) throw new NotFoundException('Address not found');
      await tx.customerAddress.delete({ where: { id: addressId } });
      if (existing.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.customerAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
    return { ok: true };
  }

  private async assertInBranch(branchId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, branchId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }
}

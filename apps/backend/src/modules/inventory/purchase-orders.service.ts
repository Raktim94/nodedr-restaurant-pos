import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PurchaseOrderDto,
  PurchaseOrderStatus,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../common/money';

const NEXT_STATUS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['CANCELLED'], // PARTIALLY_RECEIVED/RECEIVED are set by GoodsReceiptsService, not manually
  PARTIALLY_RECEIVED: [],
  RECEIVED: [],
  CANCELLED: [],
};

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  listPurchaseOrders(branchId: string, status?: PurchaseOrderStatus) {
    return this.prisma.purchaseOrder.findMany({
      where: { branchId, ...(status ? { status } : {}) },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPurchaseOrder(branchId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, branchId },
      include: {
        supplier: true,
        createdBy: { select: { id: true, name: true } },
        items: { include: { ingredient: true } },
        goodsReceipts: {
          include: {
            items: true,
            receivedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async createPurchaseOrder(
    branchId: string,
    userId: string,
    dto: PurchaseOrderDto,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, branchId },
    });
    if (!supplier)
      throw new BadRequestException('Supplier not found in this branch');

    const ingredientIds = dto.items.map((i) => i.ingredientId);
    const ingredientCount = await this.prisma.ingredient.count({
      where: { id: { in: ingredientIds }, branchId },
    });
    if (ingredientCount !== new Set(ingredientIds).size) {
      throw new BadRequestException(
        'One or more ingredients not found in this branch',
      );
    }

    const totalAmount = round2(
      dto.items.reduce((sum, i) => sum + i.quantityOrdered * i.unitCost, 0),
    );
    const poNumber = await this.nextPoNumber(branchId);

    return this.prisma.purchaseOrder.create({
      data: {
        branchId,
        supplierId: dto.supplierId,
        poNumber,
        expectedDate: dto.expectedDate,
        notes: dto.notes,
        totalAmount,
        createdById: userId,
        items: {
          create: dto.items.map((i) => ({
            ingredientId: i.ingredientId,
            quantityOrdered: i.quantityOrdered,
            unitCost: i.unitCost,
          })),
        },
      },
      include: { items: true },
    });
  }

  async updateStatus(
    branchId: string,
    id: string,
    status: PurchaseOrderStatus,
  ) {
    const po = await this.getPurchaseOrder(branchId, id);
    const allowed = NEXT_STATUS[po.status];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot move purchase order from ${po.status} to ${status}`,
      );
    }
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status },
    });
  }

  private async nextPoNumber(branchId: string): Promise<string> {
    const count = await this.prisma.purchaseOrder.count({
      where: { branchId },
    });
    return `PO-${String(count + 1).padStart(4, '0')}`;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PublicMenuService {
  constructor(private readonly prisma: PrismaService) {}

  async getMenuByQrToken(qrToken: string) {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
      include: { floor: { include: { branch: true } } },
    });
    if (!table) throw new NotFoundException('This QR code is not recognized');

    const branch = table.floor.branch;

    const categories = await this.prisma.menuCategory.findMany({
      where: { branchId: branch.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            price: true,
            isVeg: true,
            isVegan: true,
            spiceLevel: true,
            allergens: true,
          },
        },
      },
    });

    return {
      branchName: branch.name,
      tableName: table.name ?? `Table ${table.number}`,
      categories,
    };
  }
}

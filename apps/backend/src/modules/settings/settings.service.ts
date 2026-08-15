import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BranchSettingsDto,
  RestaurantSettingsDto,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(restaurantId: string, branchId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId },
    });
    if (!restaurant || !branch) {
      throw new NotFoundException('Restaurant or branch not found');
    }
    return { restaurant, branch };
  }

  async updateRestaurant(
    restaurantId: string,
    userId: string,
    dto: RestaurantSettingsDto,
  ) {
    const updated = await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: dto,
    });
    await this.audit.record({
      userId,
      action: 'settings.restaurant_updated',
      entity: 'Restaurant',
      entityId: restaurantId,
      metadata: { changes: dto },
    });
    return updated;
  }

  async updateBranch(branchId: string, userId: string, dto: BranchSettingsDto) {
    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: dto,
    });
    await this.audit.record({
      userId,
      action: 'settings.branch_updated',
      entity: 'Branch',
      entityId: branchId,
      metadata: { changes: dto },
    });
    return updated;
  }
}

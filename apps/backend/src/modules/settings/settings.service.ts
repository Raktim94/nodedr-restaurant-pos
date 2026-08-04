import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BranchSettingsDto,
  RestaurantSettingsDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

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

  updateRestaurant(restaurantId: string, dto: RestaurantSettingsDto) {
    return this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: dto,
    });
  }

  updateBranch(branchId: string, dto: BranchSettingsDto) {
    return this.prisma.branch.update({
      where: { id: branchId },
      data: dto,
    });
  }
}

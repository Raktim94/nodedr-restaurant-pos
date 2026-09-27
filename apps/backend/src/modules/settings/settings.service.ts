import { Injectable, NotFoundException } from '@nestjs/common';
import {
  TAX_REGIME_PRESETS,
  type BranchSettingsDto,
  type RestaurantSettingsDto,
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
    // Picking a new regime without also stating a mode gets that regime's
    // own default (INDIA_GST/EU_VAT/ES_IVA -> inclusive, US_SALES_TAX ->
    // exclusive) — a picker that silently kept the old mode across a
    // regime switch would quietly mis-price every item on that branch.
    const data =
      dto.taxRegime && dto.taxMode === undefined
        ? { ...dto, taxMode: TAX_REGIME_PRESETS[dto.taxRegime].defaultMode }
        : dto;
    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data,
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

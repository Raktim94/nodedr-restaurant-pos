import { ForbiddenException, Injectable } from '@nestjs/common';
import { ModuleKey, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE_SUBSCRIPTIONS: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
];

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertTenantActive(restaurantId: string): Promise<void> {
    const tenant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { status: true, trialEndsAt: true },
    });

    if (!tenant) throw new ForbiddenException('Company is unavailable');
    if (
      tenant.status === TenantStatus.SUSPENDED ||
      tenant.status === TenantStatus.CANCELLED
    ) {
      throw new ForbiddenException('Company access is suspended');
    }
    if (
      tenant.status === TenantStatus.TRIAL &&
      tenant.trialEndsAt &&
      tenant.trialEndsAt <= new Date()
    ) {
      throw new ForbiddenException('Company trial has expired');
    }
  }

  async assertModuleEnabled(
    restaurantId: string,
    moduleKey: ModuleKey,
  ): Promise<void> {
    await this.assertTenantActive(restaurantId);

    const override = await this.prisma.tenantModule.findUnique({
      where: { restaurantId_moduleKey: { restaurantId, moduleKey } },
      select: { enabled: true, expiresAt: true },
    });
    if (override) {
      if (!override.enabled || (override.expiresAt && override.expiresAt <= new Date())) {
        throw new ForbiddenException(`${moduleKey} module is not enabled`);
      }
      return;
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { restaurantId, status: { in: ACTIVE_SUBSCRIPTIONS } },
      orderBy: { createdAt: 'desc' },
      select: {
        currentPeriodEnd: true,
        trialEndsAt: true,
        plan: {
          select: {
            modules: {
              where: { moduleKey },
              select: { enabled: true },
              take: 1,
            },
          },
        },
      },
    });

    // Existing self-hosted installations have no subscription records. Keep
    // them working until a SaaS plan is explicitly assigned.
    if (!subscription) return;

    const end = subscription.currentPeriodEnd ?? subscription.trialEndsAt;
    if (end && end <= new Date()) {
      throw new ForbiddenException('Subscription period has expired');
    }
    if (subscription.plan.modules[0]?.enabled !== true) {
      throw new ForbiddenException(`${moduleKey} module is not included in the plan`);
    }
  }
}

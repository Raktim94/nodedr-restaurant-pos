import { ForbiddenException } from '@nestjs/common';
import { ModuleKey, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService', () => {
  const prisma = {
    restaurant: { findUnique: jest.fn() },
    tenantModule: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
  };
  const service = new EntitlementsService(prisma as never);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.restaurant.findUnique.mockResolvedValue({
      status: TenantStatus.ACTIVE,
      trialEndsAt: null,
    });
    prisma.tenantModule.findUnique.mockResolvedValue(null);
    prisma.subscription.findFirst.mockResolvedValue(null);
  });

  it('keeps legacy self-hosted tenants working without a subscription', async () => {
    await expect(
      service.assertModuleEnabled('restaurant-1', ModuleKey.POS),
    ).resolves.toBeUndefined();
  });

  it('blocks a suspended tenant', async () => {
    prisma.restaurant.findUnique.mockResolvedValue({
      status: TenantStatus.SUSPENDED,
      trialEndsAt: null,
    });
    await expect(
      service.assertModuleEnabled('restaurant-1', ModuleKey.POS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks an explicit module override', async () => {
    prisma.tenantModule.findUnique.mockResolvedValue({
      enabled: false,
      expiresAt: null,
    });
    await expect(
      service.assertModuleEnabled('restaurant-1', ModuleKey.ACCOUNTING),
    ).rejects.toThrow('ACCOUNTING module is not enabled');
  });

  it('blocks a module excluded from an active plan', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: null,
      trialEndsAt: null,
      plan: { modules: [] },
    });
    await expect(
      service.assertModuleEnabled('restaurant-1', ModuleKey.AI),
    ).rejects.toThrow('AI module is not included in the plan');
  });
});

import { AiAnalyticsService } from './ai-analytics.service';

describe('AiAnalyticsService', () => {
  it('calculates forecast confidence per menu item, not per branch', async () => {
    const now = new Date();
    const popular = Array.from({ length: 100 }, () => ({
      menuItemId: 'popular',
      nameSnapshot: 'Popular dish',
      quantity: 1,
      order: { createdAt: now },
    }));
    const rare = [{
      menuItemId: 'rare',
      nameSnapshot: 'Rare dish',
      quantity: 1,
      order: { createdAt: now },
    }];
    const prisma = {
      orderItem: { findMany: jest.fn().mockResolvedValue([...popular, ...rare]) },
    };
    const service = new AiAnalyticsService(prisma as never);

    const result = await service.demandForecast('branch-1');

    expect(result.forecasts.find((item) => item.menuItemId === 'popular'))
      .toMatchObject({ confidence: 'HIGH', observations: 100 });
    expect(result.forecasts.find((item) => item.menuItemId === 'rare'))
      .toMatchObject({ confidence: 'LOW', observations: 1 });
  });
});

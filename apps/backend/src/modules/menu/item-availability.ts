import { ConflictException } from '@nestjs/common';

interface SaleItem {
  id: string;
  isActive: boolean;
  pausedUntil: Date | null;
  category?: { isActive: boolean };
}

/** Both public carts and the final write return the items a customer must remove to submit. */
export function assertMenuItemsAvailable(ids: string[], items: SaleItem[]) {
  const available = new Set<string>();
  const pausedItems: { id: string; pausedUntil: string }[] = [];
  const now = new Date();
  for (const item of items) {
    if (!item.isActive || item.category?.isActive === false) continue;
    if (item.pausedUntil && item.pausedUntil > now) {
      pausedItems.push({
        id: item.id,
        pausedUntil: item.pausedUntil.toISOString(),
      });
    } else {
      available.add(item.id);
    }
  }
  const unavailableItemIds = ids.filter((id) => !available.has(id));
  if (unavailableItemIds.length) {
    throw new ConflictException({
      statusCode: 409,
      code: 'ITEM_UNAVAILABLE',
      message: 'Some items are no longer available',
      unavailableItemIds,
      ...(pausedItems.length && { pausedItems }),
    });
  }
}

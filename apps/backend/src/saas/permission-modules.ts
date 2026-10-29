import { ModuleKey } from '@prisma/client';

const PREFIX_MODULES: Record<string, ModuleKey> = {
  ai: ModuleKey.AI,
  accounting: ModuleKey.ACCOUNTING,
  attendance: ModuleKey.HR,
  backup: ModuleKey.OPERATIONS,
  customers: ModuleKey.CRM,
  delivery: ModuleKey.DELIVERY,
  inventory: ModuleKey.INVENTORY,
  kds: ModuleKey.KDS,
  marketing: ModuleKey.MARKETING,
  menu: ModuleKey.MENU,
  operations: ModuleKey.OPERATIONS,
  reports: ModuleKey.REPORTS,
  reservations: ModuleKey.TABLES,
  sales: ModuleKey.POS,
  staff: ModuleKey.HR,
  tables: ModuleKey.TABLES,
};

export function moduleForPermission(permission: string): ModuleKey | null {
  if (permission.startsWith('orders.') || permission.startsWith('bills.')) {
    return ModuleKey.POS;
  }
  if (permission.startsWith('discounts.') || permission.startsWith('refunds.')) {
    return ModuleKey.POS;
  }
  return PREFIX_MODULES[permission.split('.')[0]] ?? null;
}

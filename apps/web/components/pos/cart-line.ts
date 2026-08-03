export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifierLabel?: string;
}

export function cartLineKey(menuItemId: string, modifierIds: string[]): string {
  return `${menuItemId}::${[...modifierIds].sort().join(",")}`;
}

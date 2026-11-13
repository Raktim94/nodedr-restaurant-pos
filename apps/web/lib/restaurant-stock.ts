// What a restaurant actually stocks. Used as suggestions in the item form and as the order the stock list
// is grouped in; owners can still type their own.
export const STOCK_CATEGORIES = [
  "Vegetables", "Fruits", "Dairy & eggs", "Meat & poultry", "Fish & seafood", "Rice, grains & flour",
  "Pulses & lentils", "Spices & masala", "Oils & fats", "Sauces & condiments", "Bakery", "Beverages",
  "Bar & liquor", "Packaging & takeaway", "Cleaning & hygiene", "Gas & fuel",
] as const;

export const STORAGE_AREAS = ["Dry store", "Walk-in fridge", "Freezer", "Kitchen line", "Bar", "Dessert counter", "Dispatch / packing"] as const;

export const rank = (list: readonly string[], v: string | null | undefined) => {
  const i = v ? list.findIndex((x) => x.toLowerCase() === v.toLowerCase()) : -1;
  return i === -1 ? list.length : i;
};

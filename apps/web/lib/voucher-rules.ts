// Small rules of the stock journal voucher, kept apart from the screen so they can be tested.
// The phone app (mobile/www/pos/lib/stockjournal.js) carries the same wording.

export const NO_RECIPES_FOR_PRODUCT = "No saved recipes for this product yet";

export type RecipeState = "choose-product" | "loading" | "error" | "empty" | "ready";

/**
 * What the recipe area should say. "empty" is only ever true for a request that succeeded and returned no recipes
 * for the chosen product: a missing product, a pending request or a failed one must never read as "no recipes".
 */
export function recipeState(q: { hasProduct: boolean; isError: boolean; isSuccess: boolean; count: number }): RecipeState {
  if (!q.hasProduct) return "choose-product";
  if (q.isError) return "error";
  if (!q.isSuccess) return "loading";
  return q.count === 0 ? "empty" : "ready";
}

/** A readable message when a unit cannot be used for an item, or null when it can. */
export function unitProblem(item: { name: string; unit: string; units: readonly string[] } | undefined, unit: string): string | null {
  if (!item || !unit || item.units.includes(unit)) return null;
  return `${item.name} is stocked in ${item.unit}, so it cannot be entered in ${unit}. Choose ${item.units.join(", ")} in the Unit column, or add a conversion to the item first.`;
}

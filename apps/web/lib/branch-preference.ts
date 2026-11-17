const KEY = "nodedr_branch_id";

export function readBranchPreference(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveBranchPreference(id: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, id);
  } catch {
    // The selector can continue using its in-memory preference.
  }
}

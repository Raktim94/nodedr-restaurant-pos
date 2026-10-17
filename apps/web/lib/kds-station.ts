// Which KDS station a screen is pinned to. This is a DEVICE setting, not a
// restaurant one: the pass tablet, the grill tablet and the bar tablet each
// show a different station, so the choice is remembered per browser + branch
// (localStorage) and deliberately not synced across devices or staff. Pure and
// storage-injected so reload / branch-switch / blocked-storage behaviour is
// unit-tested with `node --test`.

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const stationKey = (branchId: string) => `kds-station:${branchId}`;

export interface StationRead {
  /** Saved station id; "" = all stations / nothing saved. */
  value: string;
  /** false when the browser refused access to storage. */
  storageOk: boolean;
}

export function readStation(storage: KeyValueStorage | null, branchId: string): StationRead {
  if (!storage) return { value: "", storageOk: false };
  try {
    return { value: storage.getItem(stationKey(branchId)) ?? "", storageOk: true };
  } catch {
    return { value: "", storageOk: false };
  }
}

/** Returns false when the choice could not be saved (it then lasts until reload). */
export function writeStation(storage: KeyValueStorage | null, branchId: string, stationId: string): boolean {
  if (!storage) return false;
  try {
    if (stationId) storage.setItem(stationKey(branchId), stationId);
    else storage.removeItem(stationKey(branchId));
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedStation {
  /** Station to actually filter by ("" = all). Never an id that no longer exists. */
  active: string;
  /** The saved station was deleted/renamed away; the screen fell back to all. */
  stale: boolean;
  /** Safe to fetch tickets: we know which station scope to ask for. */
  ready: boolean;
}

/**
 * `stations` is undefined while the list is loading. A saved station is only
 * trusted once the list confirms it exists, so we never fetch (and flash) the
 * wrong station's tickets, and a deleted station never leaves an empty board.
 * If the list cannot be loaded at all, the saved station is used as-is rather
 * than leaving the screen blank.
 */
export function resolveStation(
  saved: string,
  stations: readonly { id: string }[] | undefined,
  listFailed = false,
): ResolvedStation {
  if (!saved) return { active: "", stale: false, ready: true };
  if (listFailed && !stations) return { active: saved, stale: false, ready: true };
  if (!stations) return { active: "", stale: false, ready: false };
  if (stations.some((s) => s.id === saved)) return { active: saved, stale: false, ready: true };
  return { active: "", stale: true, ready: true };
}

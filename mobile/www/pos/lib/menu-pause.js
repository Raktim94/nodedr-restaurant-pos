// Server-linked phones use their most recent menu snapshot, including offline.
export function activePauseUntil(item, now = Date.now()) {
  const until = Date.parse(item?.pausedUntil);
  return until > now ? until : null;
}

export function pausedAddition(items, lines, now = Date.now()) {
  for (const line of lines) {
    if (line.qty <= (line.sent || 0)) continue;
    const item = items.find((dish) => dish.id === line.item.id);
    if (activePauseUntil(item, now)) return item;
  }
}

/** A late reply must not overwrite a full menu refresh, another branch or a phone-only account. */
export function mergeMenuPauses(current, requested, rows) {
  if (!current || current.local || current.generatedAt !== requested.generatedAt ||
      current.branch.id !== requested.branch.id || current.user.id !== requested.user.id) return current;
  const deadlines = new Map(rows.map(({ id, pausedUntil }) => [id, pausedUntil]));
  let changed = false;
  const items = current.items.map((item) => {
    const pausedUntil = deadlines.get(item.id) ?? null;
    if ((item.pausedUntil ?? null) === pausedUntil) return item;
    changed = true;
    return { ...item, pausedUntil };
  });
  return changed ? { ...current, items } : current;
}

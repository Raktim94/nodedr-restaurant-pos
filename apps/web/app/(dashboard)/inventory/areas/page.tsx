"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useState, useMemo } from "react";
import Link from "next/link";
import { 
  ArrowLeftRight, 
  ArrowRight, 
  Check, 
  ClipboardCheck, 
  History, 
  MapPin, 
  MoreVertical, 
  Package, 
  Pencil, 
  Plus, 
  Search, 
  Sparkles, 
  Trash2, 
  Warehouse 
} from "lucide-react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { usePlaceActions, usePlaceMatrix, usePlaceTransfers, useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { STORAGE_AREAS } from "@/lib/restaurant-stock";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export default function AreasPage() {
  const { branchId } = useBranch();
  const { data, isLoading, isError } = usePlaceMatrix(branchId);
  const { data: log } = usePlaceTransfers(branchId);
  const { data: stockItems } = useStockItems(branchId);
  const act = usePlaceActions(branchId);

  const [name, setName] = useState("");
  const [moving, setMoving] = useState(false);
  const [item, setItem] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Rename / Edit place state
  const [editingPlace, setEditingPlace] = useState<{ id: string; name: string } | null>(null);
  const [editName, setEditName] = useState("");

  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Action failed");
  const places = data?.locations ?? [];
  const chosen = stockItems?.find((s) => s.id === item);
  const missing = STORAGE_AREAS.filter((a) => !places.some((p) => p.name === a));

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (!search.trim()) return data.items;
    return data.items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));
  }, [data?.items, search]);

  const move = () => {
    setErr(null);
    act.transfer.mutate(
      {
        ingredientId: item,
        fromLocationId: from || null,
        toLocationId: to,
        quantity: qty.trim(),
        unit: (unit || chosen?.unit) as IngredientUnit,
        note: transferNote.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Stock transferred successfully");
          setMoving(false);
          setQty("");
          setItem("");
          setTransferNote("");
        },
        onError: (e) => setErr(e instanceof ApiError ? e.message : "Could not complete transfer"),
      }
    );
  };

  const handleRenamePlace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlace || !editName.trim()) return;
    act.update.mutate(
      { id: editingPlace.id, name: editName.trim() },
      {
        onSuccess: () => {
          toast.success("Location updated");
          setEditingPlace(null);
        },
        onError: fail,
      }
    );
  };

  const handleDeactivatePlace = (p: { id: string; name: string }) => {
    if (!confirm(`Are you sure you want to deactivate "${p.name}"? Only locations with 0 stock can be deactivated.`)) return;
    act.update.mutate(
      { id: p.id, isActive: false },
      {
        onSuccess: () => toast.success(`"${p.name}" deactivated`),
        onError: fail,
      }
    );
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 pb-24 sm:pb-20">
      {/* Page Title & Action Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
              Storage Areas & Distribution
            </h1>
            <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground border-border/70">
              Locations
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Organize stock across physical rooms, walk-in coolers, dry stores, and bar stations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={places.length < 2}
            onClick={() => setMoving(true)}
            className="w-full sm:w-auto h-11 sm:h-9 rounded-xl shadow-xs gap-1.5 font-semibold active:scale-98"
          >
            <ArrowLeftRight className="h-4 w-4" />
            <span>Move Stock</span>
          </Button>
        </div>
      </div>

      <InventoryTabs />

      {/* Storage Area Manager Card */}
      <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Warehouse className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Configured Storage Locations</h2>
              <p className="text-xs text-muted-foreground">
                {places.length} active location{places.length === 1 ? "" : "s"} defined for this branch
              </p>
            </div>
          </div>

          {/* Quick Add Area Form */}
          <form
            className="flex items-center gap-2 w-full sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                act.create.mutate(name.trim(), {
                  onSuccess: () => {
                    toast.success(`Area "${name}" added`);
                    setName("");
                  },
                  onError: fail,
                });
              }
            }}
          >
            <div className="relative flex-1 sm:w-60">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="New storage place"
                list="place-list"
                className="pl-9 h-11 sm:h-9 text-xs sm:text-sm rounded-xl"
                placeholder="Add location (e.g. Walk-in Freezer)…"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <datalist id="place-list">
                {missing.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="rounded-xl h-11 sm:h-9 text-xs font-semibold shrink-0 gap-1 active:scale-96 px-3.5"
              disabled={!name.trim() || act.create.isPending}
            >
              <Plus className="h-4 w-4" />
              <span>Add</span>
            </Button>
          </form>
        </div>

        {/* Location Badges with Options Dropdown */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
          {places.length > 0 ? (
            places.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-secondary/50 pl-3 pr-1 py-1.5 text-xs font-semibold text-foreground transition-all hover:border-border active:scale-98"
              >
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span>{p.name}</span>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        title="Manage location"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="start" className="w-40 p-1 shadow-lg">
                    <DropdownMenuItem
                      render={
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPlace(p);
                            setEditName(p.name);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground hover:bg-secondary cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Rename</span>
                        </button>
                      }
                    />
                    <DropdownMenuItem
                      render={
                        <Link
                          href={`/inventory/stock-take?area=${encodeURIComponent(p.name)}`}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground hover:bg-secondary cursor-pointer"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Count this area</span>
                        </Link>
                      }
                    />
                    <DropdownMenuItem
                      variant="destructive"
                      render={
                        <button
                          type="button"
                          onClick={() => handleDeactivatePlace(p)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Deactivate</span>
                        </button>
                      }
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Suggested presets you can click to add:</span>
              <div className="flex flex-wrap gap-1.5">
                {STORAGE_AREAS.slice(0, 4).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => act.create.mutate(preset, { onError: fail })}
                    className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] hover:bg-secondary hover:text-foreground"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Storage Area Matrix Section */}
      <div className="flex flex-col gap-3">
        {/* Search Toolbar */}
        {places.length > 0 && data?.items && data.items.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search stock distribution…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-11 sm:h-9 text-xs sm:text-sm rounded-xl bg-card border-border/70"
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
              Showing <strong>{filteredItems.length}</strong> items across <strong>{places.length}</strong> locations
            </span>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-56 rounded-2xl" />
        ) : isError ? (
          <Card className="p-8 text-center text-sm text-destructive rounded-2xl border-dashed">
            Could not load storage locations. Please refresh or verify your connection.
          </Card>
        ) : places.length === 0 ? (
          /* Empty State: No Storage Places Defined Yet */
          <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-2xl border-dashed bg-card/50">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Warehouse className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-1 max-w-sm">
              <h3 className="text-base font-semibold text-foreground">No Storage Locations Added</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Set up rooms where physical ingredients are kept (e.g. Dry Pantry, Walk-In Chiller, Beverage Cellar) to track granular stock placement.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {STORAGE_AREAS.map((preset) => (
                <Button
                  key={preset}
                  variant="outline"
                  size="sm"
                  onClick={() => act.create.mutate(preset, { onError: fail })}
                  className="rounded-xl text-xs gap-1.5"
                >
                  <Plus className="h-3 w-3" />
                  <span>{preset}</span>
                </Button>
              ))}
            </div>
          </Card>
        ) : filteredItems.length > 0 ? (
          <>
            {/* Desktop / Tablet Matrix Table */}
            <div className="hidden md:block rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/80">
                    <TableHead className="font-semibold text-xs text-foreground py-3">Ingredient</TableHead>
                    <TableHead className="text-right font-semibold text-xs text-foreground py-3">Total In-Stock</TableHead>
                    {places.map((p) => (
                      <TableHead key={p.id} className="text-right font-semibold text-xs text-foreground py-3">
                        {p.name}
                      </TableHead>
                    ))}
                    <TableHead className="text-right font-semibold text-xs text-foreground py-3">Unassigned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((i) => {
                    const unassignedNum = Number(i.unassigned) || 0;
                    return (
                      <TableRow key={i.id} className="transition-colors hover:bg-muted/30">
                        <TableCell className="font-medium text-foreground py-3 text-sm">
                          {i.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums py-3 font-semibold text-foreground">
                          {i.total} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span>
                        </TableCell>
                        {places.map((p) => {
                          const level = i.levels[p.id];
                          const hasQty = Number(level) > 0;
                          return (
                            <TableCell key={p.id} className="text-right tabular-nums py-3 text-xs">
                              {hasQty ? (
                                <span className="font-medium text-foreground">{level}</span>
                              ) : (
                                <span className="text-muted-foreground/60">–</span>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right tabular-nums py-3 text-xs">
                          {i.needsRecount ? (
                            <Badge variant="destructive" className="text-[10px] py-0">
                              Recount Needed
                            </Badge>
                          ) : unassignedNum > 0 ? (
                            <span className="font-medium text-warning">{i.unassigned}</span>
                          ) : (
                            <span className="text-muted-foreground/60">–</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card Layout (< md screens) */}
            <div className="md:hidden flex flex-col gap-2.5">
              {filteredItems.map((i) => {
                const unassignedNum = Number(i.unassigned) || 0;
                return (
                  <div
                    key={i.id}
                    className="flex flex-col gap-2.5 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-foreground">{i.name}</span>
                      <span className="text-xs font-bold tabular-nums text-foreground">
                        {i.total} <span className="text-muted-foreground font-normal">{i.unit}</span>
                      </span>
                    </div>

                    {/* Breakdown by place */}
                    <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted/40 p-2 text-xs">
                      {places.map((p) => {
                        const level = i.levels[p.id];
                        const hasQty = Number(level) > 0;
                        return (
                          <div key={p.id} className="flex items-center justify-between px-1.5 py-1 rounded-md bg-background/50">
                            <span className="text-muted-foreground truncate mr-2 text-[11px]">{p.name}:</span>
                            <span className={cn("font-medium tabular-nums", hasQty ? "text-foreground" : "text-muted-foreground/50")}>
                              {hasQty ? level : "0"}
                            </span>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-1.5 py-1 rounded-md bg-background/50 col-span-2 border border-border/40">
                        <span className="text-muted-foreground text-[11px]">Unassigned:</span>
                        <span className={cn("font-medium tabular-nums", unassignedNum > 0 ? "text-warning" : "text-muted-foreground")}>
                          {i.needsRecount ? "Recount required" : unassignedNum > 0 ? unassignedNum : "0"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Empty Search State */
          <Card className="flex flex-col items-center justify-center gap-2 py-12 text-center rounded-2xl border-dashed">
            <Package className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">No ingredients match &ldquo;{search}&rdquo;</p>
            <p className="text-xs text-muted-foreground">Clear your search term to view all inventory placements.</p>
          </Card>
        )}
      </div>

      {/* Recent Moves Log */}
      {log && log.length > 0 && (
        <section aria-label="Recent moves" className="flex flex-col gap-2.5 pt-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Recent Stock Transfers</h2>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
            <ul className="divide-y divide-border/60 text-xs sm:text-sm">
              {log.map((t) => (
                <li key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{t.item?.name}</span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="rounded-md bg-secondary px-1.5 py-0.5">{t.from}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="rounded-md bg-primary/10 text-primary font-medium px-1.5 py-0.5">{t.to}</span>
                    </div>
                    {t.note && (
                      <span className="text-xs italic text-muted-foreground/80 pl-1">
                        &ldquo;{t.note}&rdquo;
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold tabular-nums text-foreground">
                      {t.quantity} {t.item?.unit}
                    </span>
                    <span>•</span>
                    <span>{t.by}</span>
                    <span>•</span>
                    <span className="text-[11px]">{new Date(t.createdAt).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Rename Place Dialog */}
      <Dialog open={!!editingPlace} onOpenChange={(o) => !o && setEditingPlace(null)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleRenamePlace}>
            <DialogHeader>
              <DialogTitle>Rename Storage Location</DialogTitle>
              <DialogDescription>
                Update the name of this storage area.
              </DialogDescription>
            </DialogHeader>
            <div className="py-3">
              <label className="text-xs font-medium text-foreground block mb-1.5">Location Name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Location name"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingPlace(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!editName.trim() || act.update.isPending}>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Move Stock Dialog */}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Stock Between Locations</DialogTitle>
            <DialogDescription>
              Relocate quantities between storage rooms. Overall restaurant stock count remains unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Stock Item</label>
              <select
                aria-label="Item"
                className={selectClass}
                value={item}
                onChange={(e) => {
                  setItem(e.target.value);
                  setUnit("");
                }}
              >
                <option value="">Choose item to transfer…</option>
                {(stockItems ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">From Location</label>
                <select
                  aria-label="From"
                  className={selectClass}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  <option value="">Unassigned Pool</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">To Location</label>
                <select
                  aria-label="To"
                  className={selectClass}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value="">Choose destination…</option>
                  {places
                    .filter((p) => p.id !== from)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">Quantity</label>
                <Input
                  aria-label="Quantity"
                  inputMode="decimal"
                  placeholder="e.g. 5.0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">Unit</label>
                <select
                  aria-label="Unit"
                  className={selectClass}
                  value={unit || chosen?.unit || ""}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  {(chosen?.units ?? []).map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Note / Transfer Reason (Optional)</label>
              <Input
                placeholder="e.g. Prep for weekend dinner service"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
              />
            </div>

            {err && (
              <p role="alert" className="text-xs text-destructive rounded-lg bg-destructive/10 p-2.5">
                {err}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              disabled={!item || !to || !qty.trim() || act.transfer.isPending}
              onClick={move}
            >
              {act.transfer.isPending ? "Transferring…" : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

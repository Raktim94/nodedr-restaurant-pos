"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { EyeOff, Layers, Leaf, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { AddCategoryDialog } from "@/components/menu/add-category-dialog";
import { ImportCsvDialog } from "@/components/imports/import-csv-dialog";
import { BulkPriceDialog } from "@/components/menu/bulk-price-dialog";
import { AddItemDialog } from "@/components/menu/add-item-dialog";
import { ComboComponentsDialog } from "@/components/menu/combo-components-dialog";
import { EditCategoryDialog } from "@/components/menu/edit-category-dialog";
import { EditItemDialog } from "@/components/menu/edit-item-dialog";
import { PauseBadge } from "@/components/menu/pause-badge";
import { PauseSalesDialog } from "@/components/menu/pause-sales-dialog";
import { StatusNote, useStatusNote } from "@/components/ui/status-note";
import { Badge } from "@/components/ui/badge";
import { UploadImage } from "@/components/ui/upload-image";
import { Button } from "@/components/ui/button";
import { ResponsiveTabs } from "@/components/ui/nav-picker";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import {
  useCategories,
  useDeleteCategory,
  useDeleteMenuItem,
  useMenuItems,
  useSetMenuItemPause,
  type MenuCategory,
  type MenuItem,
} from "@/hooks/use-menu";
import { useMenuPauseLabels } from "@/hooks/use-menu-pauses";
import { useDisplaySettings } from "@/hooks/use-settings";
import { useI18n } from "@/lib/i18n/context";
import { ApiError } from "@/lib/api";
import { pausedItemsByReturn } from "@/lib/menu-pauses";
import { cn } from "@/lib/utils";

export default function MenuPage() {
  const { branchId } = useBranch();
  return <BranchMenu key={branchId} branchId={branchId} />;
}

function BranchMenu({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: settings } = useDisplaySettings(branchId);
  const timezone = settings?.restaurant.timezone;
  const { data: me } = useCurrentUser();
  // menu.view alone is read-only; every edit control needs menu.manage.
  const canManage = hasPermission(me?.user, "menu.manage");
  const { data: categories, isLoading: categoriesLoading } = useCategories(branchId);
  const [view, setView] = useState("all");
  const selectedCategory = categories?.find((category) => view === `category:${category.id}`);
  const pausedOnly = view === "paused";
  // Deleting an item that appears in past orders archives it (isActive false) instead of removing it, so hide those here.
  const { data: rawItems, isLoading: itemsLoading, isError: itemsFailed } = useMenuItems(branchId);
  const pauseLabels = useMenuPauseLabels(rawItems, timezone);
  const allItems = rawItems?.filter((item) => item.isActive);
  const pausedItems = rawItems && pausedItemsByReturn(rawItems, pauseLabels);
  const items = pausedOnly ? pausedItems : allItems?.filter((item) =>
    view === "all" || view === `category:${item.categoryId}`);
  const views = [
    { id: "all", label: t("All items"), count: allItems?.length },
    { id: "paused", label: t("menu.pausedView"), count: pausedItems?.length },
  ];
  const deleteItem = useDeleteMenuItem(branchId);
  const deleteCategory = useDeleteCategory(branchId);
  const [comboItem, setComboItem] = useState<MenuItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  const pause = useSetMenuItemPause(branchId);
  const [pausingItem, setPausingItem] = useState<MenuItem | null>(null);
  const pauseTrigger = useRef<HTMLButtonElement>(null);
  const { note, show, clear } = useStatusNote();
  const pauseError = (error: unknown) => error instanceof ApiError ? error.message : t("menu.pauseFailed");

  function pauseButton(item: MenuItem) {
    const paused = pauseLabels.has(item.id);
    const label = t(paused ? "menu.resumeTitle" : "menu.pauseTitle", { name: item.name });
    const Icon = paused ? Play : Pause;
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs"
        title={label} aria-label={label} disabled={pause.isPending}
        onClick={(event) => {
          clear();
          if (paused) {
            pause.mutate({ id: item.id, change: { resume: true } }, {
              onSuccess: () => show("success", t("menu.resumed", { name: item.name })),
              onError: (error) => show("error", pauseError(error)),
            });
          } else {
            pause.reset();
            pauseTrigger.current = event.currentTarget;
            setPausingItem(item);
          }
        }}>
        <Icon className="size-3.5" aria-hidden />
        <span>{t(paused ? "menu.resumeSales" : "menu.pauseSales")}</span>
      </Button>
    );
  }

  const onDeleteCategory = (category: MenuCategory) => {
    if (!confirm(t("Delete the \"{name}\" category? This cannot be undone.", { name: category.name }))) return;
    deleteCategory.mutate(category.id, {
      onSuccess: () => {
        toast.success(t("\"{name}\" deleted", { name: category.name }));
        if (selectedCategory?.id === category.id) setView("all");
      },
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? err.message : t("Could not delete category — remove its items first"),
        ),
    });
  };

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t("Menu")}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {canManage ? t("Categories, items, and pricing") : t("Categories, items, and pricing (view only)")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* Categories Sidebar */}
        <Card className="flex flex-col gap-3.5 p-4 rounded-2xl border-border/70 bg-card shadow-xs">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t("Categories")}
            </h2>
            {categories && (
              <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                {categories.length}
              </span>
            )}
          </div>

          {categoriesLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
            {/* Phones: Category Picker + Selected Category Actions */}
            <div className="flex flex-col gap-2.5 lg:hidden">
              <ResponsiveTabs
                mobileOnly
                label={t("Category")}
                value={view}
                onChange={setView}
                items={[
                  ...views.map(({ id, label, count }) => ({ id, label, hint: count?.toString() })),
                  ...(categories ?? []).map((c) => ({ id: `category:${c.id}`, label: c.name, hint: t("{items} items{value}", { items: c._count.items, value: c.showOnWebsite ? "" : t(" · hidden") }) })),
                ]}
              />
              {selectedCategory && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-secondary/50 border border-border/50 px-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-semibold text-foreground">{selectedCategory.name}</span>
                    {!selectedCategory.showOnWebsite && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <EyeOff className="h-3 w-3" /> {t("Hidden from website")}
                      </span>
                    )}
                  </span>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-lg px-2 text-xs font-medium hover:bg-secondary active:scale-95 transition-transform"
                        onClick={() => setEditingCategory(selectedCategory)}
                      >
                        <Pencil className="h-3.5 w-3.5" /> {t("Edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-lg px-2 text-xs font-medium text-destructive hover:bg-destructive/10 active:scale-95 transition-transform"
                        onClick={() => onDeleteCategory(selectedCategory)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {t("Delete")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Desktop Categories List */}
            <div className="hidden flex-col gap-1 lg:flex">
              {views.map(({ id, label, count }) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold transition-all active:scale-[0.99]",
                    view === id
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                  )}
                >
                  <span>{label}</span>
                  {count !== undefined && (
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] tabular-nums font-mono",
                      view === id ? "bg-white/20 text-white" : "text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
              {categories?.map((cat) => (
                <div
                  key={cat.id}
                  className={cn(
                    "group flex items-center justify-between rounded-xl pl-3 pr-1.5 py-1 text-left text-xs font-medium transition-all",
                    selectedCategory?.id === cat.id
                      ? "bg-secondary text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <button
                    aria-pressed={selectedCategory?.id === cat.id}
                    onClick={() => setView(`category:${cat.id}`)}
                    className="min-w-0 flex-1 truncate py-1 text-left text-xs"
                  >
                    {cat.name}
                  </button>
                  {!cat.showOnWebsite && (
                    <span title={t("Hidden from website")} className="mr-1 shrink-0 text-muted-foreground">
                      <EyeOff className="h-3.5 w-3.5" />
                      <span className="sr-only">{t("Hidden from website")}</span>
                    </span>
                  )}
                  <span className={cn("shrink-0 text-xs text-muted-foreground px-1.5 font-mono", canManage && "group-hover:hidden group-focus-within:hidden")}>
                    {cat._count.items}
                  </span>
                  {canManage && (
                    <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
                        title={t("Edit category")}
                        aria-label={t("Edit category {name}", { name: cat.name })}
                        onClick={() => setEditingCategory(cat)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:text-destructive active:scale-95 transition-transform"
                        title={t("Delete category")}
                        aria-label={t("Delete category {name}", { name: cat.name })}
                        onClick={() => onDeleteCategory(cat)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            </>
          )}

          {canManage && <AddCategoryDialog branchId={branchId} />}
        </Card>

        {/* Items Container */}
        <Card className="flex flex-col gap-4 p-4 sm:p-5 rounded-2xl border-border/70 bg-card shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
                {pausedOnly ? t("menu.pausedView") : selectedCategory?.name ?? t("All items")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {pausedOnly ? t("menu.pauseSortHint") : items ? t("{count} dishes & items", { count: items.length }) : t("Loading items…")}
              </p>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <BulkPriceDialog branchId={branchId} categories={categories ?? []} />
                <ImportCsvDialog kind="menu" branchId={branchId} />
                <AddItemDialog branchId={branchId} categories={categories ?? []} />
              </div>
            )}
          </div>

          <StatusNote note={note} onClear={clear} />
          {itemsLoading ? (
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : itemsFailed && !rawItems ? (
            <p role="alert" className="py-8 text-center text-sm text-destructive">{t("menu.itemsLoadFailed")}</p>
          ) : items && items.length > 0 ? (
            <>
            {/* Mobile Cards List */}
            <ul className="flex flex-col divide-y divide-border/60 md:hidden">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-2.5 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    {item.imageUrl ? (
                      <UploadImage
                        src={item.imageUrl}
                        width={48}
                        height={48}
                        className="h-12 w-12 shrink-0 rounded-xl bg-secondary object-cover border border-border/50"
                      />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-xl bg-secondary/70 border border-border/40 flex items-center justify-center text-muted-foreground/50">
                        {item.isVeg ? <Leaf className="h-5 w-5 text-emerald-500/50" /> : <Layers className="h-5 w-5" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        {item.isVeg && <Leaf className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                        <span className="min-w-0 break-words leading-tight">{item.name}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-1">
                        <span>{item.category.name}</span>
                        {item.station && <span>· {item.station.name}</span>}
                        <span>{t("· {Number}% tax", { Number: Number(item.taxRatePercent) })}</span>
                      </p>
                      {pauseLabels.has(item.id) && <div className="mt-1.5"><PauseBadge label={pauseLabels.get(item.id)} /></div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-foreground">{fmt.currency(item.price)}</p>
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                      {pauseButton(item)}
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 rounded-lg px-2.5 text-xs font-medium border-border/70 hover:bg-secondary/70 active:scale-95 transition-transform",
                          item.isCombo && "text-primary border-primary/30 bg-primary/5"
                        )}
                        onClick={() => setComboItem(item)}
                      >
                        <Layers className="h-3.5 w-3.5 mr-1" /> {t("Combo")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg px-2.5 text-xs font-medium border-border/70 hover:bg-secondary/70 active:scale-95 transition-transform"
                        onClick={() => setEditingItem(item)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> {t("Edit")}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/60 active:scale-95 transition-transform"
                        aria-label={t("Delete {name}", { name: item.name })}
                        onClick={() =>
                          deleteItem.mutate(item.id, {
                            onSuccess: () => toast.success(t("{name} removed", { name: item.name })),
                            onError: (err) =>
                              toast.error(err instanceof ApiError ? err.message : t("Could not remove item")),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Item")}</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Category")}</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Station")}</TableHead>
                    <TableHead className="text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Price")}</TableHead>
                    <TableHead className="text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Tax")}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className="border-border/50 hover:bg-muted/40 transition-colors">
                      <TableCell className="font-semibold text-foreground py-2.5">
                        <div className="flex items-center gap-3">
                          {item.imageUrl ? (
                            <UploadImage
                              src={item.imageUrl}
                              width={36}
                              height={36}
                              className="h-9 w-9 shrink-0 rounded-lg bg-secondary object-cover border border-border/40"
                            />
                          ) : (
                            <div className="h-9 w-9 shrink-0 rounded-lg bg-secondary/60 border border-border/40 flex items-center justify-center text-muted-foreground/40">
                              {item.isVeg ? <Leaf className="h-4 w-4 text-emerald-500/50" /> : <Layers className="h-4 w-4" />}
                            </div>
                          )}
                          {item.isVeg && <Leaf className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            <span className="max-w-[28ch] [overflow-wrap:anywhere]" title={item.name}>{item.name}</span>
                            <PauseBadge label={pauseLabels.get(item.id)} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-medium py-2.5">{item.category.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {item.station ? (
                          <Badge variant="secondary" className="font-medium text-[11px] rounded-lg">
                            {item.station.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums py-2.5">
                        {fmt.currency(item.price)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground py-2.5 font-mono">
                        {Number(item.taxRatePercent)}%
                      </TableCell>
                      <TableCell className="py-2.5">
                        {canManage && (
                          <div className="flex items-center justify-end gap-1">
                            {pauseButton(item)}
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8 rounded-lg text-muted-foreground hover:text-primary active:scale-95 transition-transform",
                                item.isCombo && "text-primary bg-primary/10",
                              )}
                              title={t("Combo components")}
                              aria-label={t("Combo components for {name}", { name: item.name })}
                              onClick={() => setComboItem(item)}
                            >
                              <Layers className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
                              title={t("Edit item")}
                              aria-label={t("Edit item {name}", { name: item.name })}
                              onClick={() => setEditingItem(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive active:scale-95 transition-transform"
                              title={t("Delete item")}
                              aria-label={t("Delete item {name}", { name: item.name })}
                              onClick={() =>
                                deleteItem.mutate(item.id, {
                                  onSuccess: () => toast.success(t("{name} removed", { name: item.name })),
                                  onError: (err) =>
                                    toast.error(err instanceof ApiError ? err.message : t("Could not remove item")),
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          ) : pausedOnly ? (
            <p role="status" className="py-16 text-center text-sm text-muted-foreground">{t("menu.noPausedItems")}</p>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm font-semibold text-foreground">{t("No items yet")}</p>
              <p className="text-xs text-muted-foreground">
                {t("Add a category, then add your first menu item.")}
              </p>
            </div>
          )}
        </Card>
      </div>

      {canManage && pausingItem && (
        <PauseSalesDialog
          itemName={pausingItem.name}
          timezone={timezone}
          pending={pause.isPending}
          error={pause.isError ? pauseError(pause.error) : undefined}
          triggerRef={pauseTrigger}
          onClose={() => setPausingItem(null)}
          onPause={(change) => pause.mutate({ id: pausingItem.id, change }, {
            onSuccess: () => {
              show("success", t("menu.paused", { name: pausingItem.name }));
              setPausingItem(null);
            },
          })}
        />
      )}

      <ComboComponentsDialog
        branchId={branchId}
        item={comboItem}
        allItems={allItems ?? []}
        open={!!comboItem}
        onOpenChange={(open) => !open && setComboItem(null)}
      />

      {editingCategory && (
        <EditCategoryDialog
          branchId={branchId}
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
        />
      )}

      {editingItem && (
        <EditItemDialog
          branchId={branchId}
          item={editingItem}
          categories={categories ?? []}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}

"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ItemOptionsEditor, problemWithDrafts, saveOptionDrafts, type GroupDraft } from "@/components/menu/item-options-editor";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateMenuItem,
  useStations,
  useUploadItemImage,
  type MenuCategory,
} from "@/hooks/use-menu";
import { useDisplaySettings } from "@/hooks/use-settings";
import { ApiError } from "@/lib/api";

export function AddItemDialog({
  branchId,
  categories,
}: {
  branchId: string | null;
  categories: MenuCategory[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [stationId, setStationId] = useState<string>("");
  const [price, setPrice] = useState("");
  const [halfPrice, setHalfPrice] = useState("");
  const [taxRatePercent, setTaxRatePercent] = useState("5");
  const [isVeg, setIsVeg] = useState(true);
  const [optionDrafts, setOptionDrafts] = useState<GroupDraft[]>([]);
  const [savingOptions, setSavingOptions] = useState(false);
  const queryClient = useQueryClient();
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [imagePreview, setImagePreview] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: stations } = useStations(branchId);
  const { data: settings } = useDisplaySettings(branchId);
  const createItem = useCreateMenuItem(branchId);
  const uploadImage = useUploadItemImage();
  const priceLabel =
    settings?.branch.taxMode === "EXCLUSIVE" ? "Price (excl. tax)" : "Price (incl. tax)";

  const reset = () => {
    setName("");
    setCategoryId("");
    setStationId("");
    setPrice("");
    setTaxRatePercent("5");
    setIsVeg(true);
    setOptionDrafts([]);
    setImageUrl(undefined);
    setImagePreview(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    uploadImage.mutate(file, {
      onSuccess: (res) => setImageUrl(res.url),
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Could not upload image");
        setImagePreview(undefined);
      },
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      toast.error("Choose a category");
      return;
    }
    const problem = problemWithDrafts(optionDrafts);
    if (problem) {
      toast.error(problem);
      return;
    }
    // Option groups are written first (the item needs their ids), then the item is created pointing at them.
    let modifierGroupIds: string[] = [];
    if (optionDrafts.length > 0) {
      setSavingOptions(true);
      try {
        modifierGroupIds = await saveOptionDrafts(branchId, optionDrafts);
        void queryClient.invalidateQueries({ queryKey: ["menu", "modifier-groups", branchId] });
      } catch (err) {
        setSavingOptions(false);
        toast.error(err instanceof ApiError ? err.message : "Could not save the options");
        return;
      }
      setSavingOptions(false);
    }
    createItem.mutate(
      {
        name,
        categoryId,
        stationId: stationId || undefined,
        price: Number(price),
        halfPrice: halfPrice.trim() === "" ? undefined : Number(halfPrice),
        taxRatePercent: Number(taxRatePercent),
        isVeg,
        isVegan: false,
        isJain: false,
        isHalal: false,
        isGlutenFree: false,
        spiceLevel: "NONE",
        allergens: [],
        isActive: true,
        modifierGroupIds,
        imageUrl,
      },
      {
        onSuccess: () => {
          toast.success(`"${name}" added to menu`);
          setOpen(false);
          reset();
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add item"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" disabled={categories.length === 0} className="h-9 rounded-xl font-semibold active:scale-95 transition-transform shadow-xs">
            + Add item
          </Button>
        }
      />
      <DialogContent className="max-h-[92dvh] flex flex-col p-0 overflow-hidden sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader className="p-4 sm:p-5 pb-3 shrink-0 border-b border-border/50">
            <DialogTitle>New menu item</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Photo</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onFileChange}
              />
              {imagePreview ? (
                <div className="relative h-28 w-28 overflow-hidden rounded-xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob/uploaded preview, not a Next-optimizable remote asset */}
                  <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl(undefined);
                      setImagePreview(undefined);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 backdrop-blur-xs text-foreground shadow-xs hover:bg-background"
                    aria-label="Remove photo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {uploadImage.isPending && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs">
                      Uploading…
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-24 w-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/80 text-muted-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/5 active:scale-95 transition-all"
                >
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-xs font-medium">Add photo</span>
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-name">Name</Label>
              <Input
                id="item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Margherita Pizza"
                required
                autoFocus
                className="rounded-xl"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="price">{priceLabel}</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  className="rounded-xl"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tax">Tax rate %</Label>
                <Input
                  id="tax"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(e.target.value)}
                  required
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="add-half">Half portion price (optional)</Label>
              <Input
                id="add-half"
                type="number"
                min="0"
                step="0.01"
                value={halfPrice}
                onChange={(e) => setHalfPrice(e.target.value)}
                placeholder="Leave empty if there is no half/full choice"
                className="rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                When set, the POS asks Half / Full / Custom. The price above is the Full portion.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Kitchen station</Label>
              <Select value={stationId} onValueChange={(v) => setStationId(v ?? "")}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {stations?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/70 px-3.5 py-2.5">
              <Label htmlFor="is-veg" className="cursor-pointer font-medium">
                Vegetarian
              </Label>
              <Switch id="is-veg" checked={isVeg} onCheckedChange={setIsVeg} />
            </div>

            <ItemOptionsEditor branchId={branchId} drafts={optionDrafts} setDrafts={setOptionDrafts} />
          </div>

          <DialogFooter className="p-3 sm:p-4 bg-muted/40 border-t border-border/60 shrink-0 m-0 rounded-none sm:rounded-b-xl flex flex-row items-center justify-end gap-2">
            <Button
              type="submit"
              className="w-full sm:w-auto h-10 px-5 rounded-xl font-semibold active:scale-95 transition-transform shadow-xs"
              disabled={createItem.isPending || uploadImage.isPending || savingOptions}
            >
              {createItem.isPending || savingOptions ? "Adding…" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { type RefObject, useState } from "react";
import type { MenuItemPauseDto } from "@nodedr-restaurant/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/context";

interface PauseSalesDialogProps {
  itemName: string;
  timezone?: string;
  pending: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  error?: string;
  onClose: () => void;
  onPause: (change: MenuItemPauseDto) => void;
}

export function PauseSalesDialog({ itemName, timezone, pending, error, triggerRef, onClose, onPause }: PauseSalesDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"minutes" | "clock">("minutes");
  const [localTime, setLocalTime] = useState("");

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent showCloseButton={false} finalFocus={triggerRef}>
        <DialogHeader>
          <DialogTitle>{t("menu.pauseTitle", { name: itemName })}</DialogTitle>
          <DialogDescription>{t("menu.pauseDescription")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (!pending) onPause(mode === "minutes" ? { minutes: 30 } : { localTime });
        }}>
          <fieldset className="grid gap-2" disabled={pending}>
            <legend className="sr-only">{t("menu.pauseDuration")}</legend>
            {(["minutes", "clock"] as const).map((choice) => (
              <label key={choice} className="flex cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2.5 text-sm font-medium has-checked:border-primary has-checked:bg-primary/5">
                <input type="radio" name="pause-duration" className="size-4 accent-primary" checked={mode === choice} onChange={() => setMode(choice)} />
                {t(choice === "minutes" ? "menu.pause30Minutes" : "menu.pauseAtTime")}
              </label>
            ))}
            {mode === "clock" && (
              <div className="grid gap-2 pt-2">
                <Label htmlFor="pause-local-time">
                  {timezone ? t("menu.restaurantTimeZone", { zone: timezone }) : t("menu.restaurantTime")}
                </Label>
                <Input id="pause-local-time" type="time" required value={localTime}
                  onChange={(event) => setLocalTime(event.target.value)} aria-describedby="pause-time-hint" />
                <p id="pause-time-hint" className="text-xs text-muted-foreground">{t("menu.pauseNextDay")}</p>
              </div>
            )}
          </fieldset>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={pending || (mode === "clock" && !localTime)}>{t("menu.pauseSales")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

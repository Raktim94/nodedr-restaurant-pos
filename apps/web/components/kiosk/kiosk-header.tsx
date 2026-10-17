"use client";

import { Globe, X } from "lucide-react";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
import { TOUCH } from "./kiosk-ui";

// Spanish-first; English is the optional second language. (French and other
// dashboard languages exist but have no kiosk copy, so they are not offered.)
export const LOCALES_SHOWN: Locale[] = ["es", "en"];

export function KioskHeader({
  name,
  locale,
  onLocale,
  locales,
  onCancel,
  cancelLabel,
  languageLabel,
  serviceLabel,
  onChangeService,
  changeLabel,
}: {
  name: string;
  locale: Locale;
  onLocale: (l: Locale) => void;
  locales: Locale[];
  onCancel: () => void;
  cancelLabel: string;
  languageLabel: string;
  serviceLabel: string | null;
  onChangeService?: () => void;
  changeLabel: string;
}) {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-4 py-2">
      <p className="min-w-0 flex-1 truncate text-[1.4rem] font-bold">{name}</p>
      {serviceLabel && (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-4 py-2 text-[1.05rem] font-semibold">{serviceLabel}</span>
          {onChangeService && (
            <button
              type="button"
              onClick={onChangeService}
              className={cn("rounded-xl px-3 text-[1rem] font-semibold text-primary underline-offset-4 hover:underline", TOUCH)}
            >
              {changeLabel}
            </button>
          )}
        </div>
      )}
      <div role="group" aria-label={languageLabel} className="flex items-center gap-1">
        <Globe className="mr-1 h-5 w-5 text-muted-foreground" aria-hidden />
        {locales.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={l === locale}
            onClick={() => onLocale(l)}
            className={cn(
              "touch-manipulation rounded-xl px-3 text-[1.05rem] font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
              TOUCH,
              l === locale ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-muted",
            )}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className={cn(
          "inline-flex touch-manipulation items-center gap-2 rounded-xl border-2 border-border px-4 text-[1.05rem] font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
          TOUCH,
        )}
      >
        <X className="h-5 w-5" aria-hidden />
        {cancelLabel}
      </button>
    </header>
  );
}

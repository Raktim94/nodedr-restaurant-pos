"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Kiosk-only primitives. Plain elements on purpose (not the dashboard's
// shadcn Button): kiosk sizing is driven by the root font-size scale in
// app/kiosk/[token]/layout.tsx, and every control keeps a >=48 CSS px touch
// target via the max(48px, 3rem) floor.

export const TOUCH = "min-h-[max(48px,3rem)] min-w-[max(48px,3rem)]";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50",
  secondary: "border-2 border-border bg-card text-foreground hover:bg-secondary",
  ghost: "text-foreground hover:bg-secondary",
  danger: "bg-destructive text-white hover:bg-destructive/90",
};

export function KButton({
  variant = "primary",
  large,
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  large?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex touch-manipulation select-none items-center justify-center gap-2 rounded-2xl px-5 font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-60 active:scale-[0.98] motion-reduce:transition-none",
        TOUCH,
        large ? "py-4 text-[1.35rem]" : "py-2 text-[1.1rem]",
        VARIANT[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...props}
      className={cn(
        "inline-flex touch-manipulation select-none items-center justify-center rounded-full border-2 border-border bg-card text-foreground",
        "hover:bg-secondary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-40 active:scale-95 motion-reduce:transition-none",
        TOUCH,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: "error" | "warning" | "info";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-destructive/50 bg-destructive/10"
      : tone === "warning"
        ? "border-warning/60 bg-warning/10"
        : "border-border bg-secondary";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-center gap-4 rounded-2xl border-2 p-4", toneClass)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[1.15rem] font-semibold leading-snug">{title}</p>
        {children && <p className="mt-1 text-[1rem] leading-snug text-muted-foreground">{children}</p>}
      </div>
      {action}
    </div>
  );
}

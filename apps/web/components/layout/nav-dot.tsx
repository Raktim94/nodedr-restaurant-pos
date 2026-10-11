import { cn } from "@/lib/utils";

// Small glowing dot shown next to a nav item / settings tab that has
// something the user should look at (a new order, an update, a failed backup).
export function NavDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Needs attention"}
      className={cn("relative ml-auto flex h-2.5 w-2.5 shrink-0", className)}
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_2px_rgba(245,158,11,0.7)]" />
    </span>
  );
}

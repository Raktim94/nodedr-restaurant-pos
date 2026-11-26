import { Clock3 } from "lucide-react";

export function PauseBadge({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-md bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">
      <Clock3 className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

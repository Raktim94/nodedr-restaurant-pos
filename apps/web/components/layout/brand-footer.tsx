import { LifeBuoy } from "lucide-react";

export function BrandFooter() {
  return (
    <div className="flex flex-col gap-2 border-t border-sidebar-border px-4 py-3">
      <a
        href="https://orderrestro.nodedr.com/contact"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-lg border border-sidebar-border px-3 py-1.5 text-xs font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <LifeBuoy className="h-3.5 w-3.5" />
        Contact support
      </a>
      <a
        href="https://orderrestro.nodedr.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-center text-[11px] leading-tight text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:underline"
      >
        OrderRestro · made by Nodedr Infotech Private Limited
      </a>
    </div>
  );
}

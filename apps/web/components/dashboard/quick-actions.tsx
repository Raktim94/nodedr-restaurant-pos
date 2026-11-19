import { CalendarPlus, ChefHat, LayoutGrid, Plus, ShoppingCart, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const ACTIONS = [
  { href: "/pos", label: "New Order", icon: Plus, primary: true },
  { href: "/tables", label: "Tables", icon: LayoutGrid },
  { href: "/kds", label: "Kitchen Display", icon: ChefHat },
  { href: "/reservations", label: "Reservations", icon: CalendarPlus },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
];

export function QuickActions() {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none sm:flex-wrap">
      {ACTIONS.map((action) => (
        <Button
          key={action.href}
          variant={action.primary ? "default" : "outline"}
          size="sm"
          className={
            action.primary
              ? "h-11 sm:h-9 min-h-[44px] sm:min-h-0 shrink-0 rounded-xl px-4 text-xs font-semibold shadow-xs transition active:scale-97 gap-1.5"
              : "h-11 sm:h-9 min-h-[44px] sm:min-h-0 shrink-0 rounded-xl border-border/80 bg-card px-3.5 text-xs text-foreground hover:bg-secondary transition active:scale-97 gap-1.5"
          }
          render={<Link href={action.href} />}
        >
          <action.icon className="h-4 w-4" />
          <span>{action.label}</span>
        </Button>
      ))}
    </div>
  );
}

"use client";

import { useI18n } from "@/lib/i18n/context";
import type { SessionUser } from "@nodedr-restaurant/types";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EntityDialogHost } from "@/components/layout/entity-dialog-host";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useBranch } from "@/hooks/use-branch";
import { useDisplaySettings } from "@/hooks/use-settings";
import { StaffCurrencyContext } from "@/hooks/use-staff-format";
import { cn } from "@/lib/utils";
import { BrandFooter } from "./brand-footer";
import { BranchSwitcher } from "./branch-switcher";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { DemoBanner } from "@/components/demo/demo-banner";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

// The restaurant's own logo + name lead the sidebar header — this is
// white-label self-hosted software, so the operator's branding takes the
// prime spot an operator actually looks at. The OrderRestro product
// mark moves to a small credit line at the bottom (BrandFooter) instead of
// competing with it up here. Falls back to the product mark only until the
// restaurant sets its own logo/name under Settings.
function RestaurantBrand() {
  const { branchId } = useBranch();
  const { data } = useDisplaySettings(branchId);
  const restaurant = data?.restaurant;

  if (restaurant?.logoUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded asset served from the backend, not a Next-optimizable remote source */}
        <img
          src={restaurant.logoUrl}
          alt={restaurant.name}
          className="h-8 w-8 shrink-0 rounded-lg object-contain"
        />
        <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
          {restaurant.name}
        </span>
      </>
    );
  }

  return (
    <>
      <Logo />
      <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
        {restaurant?.name ?? "OrderRestro"}
      </span>
    </>
  );
}

export function AppShell({
  user,
  children,
}: {
  user?: SessionUser;
  children: React.ReactNode;
}) {
  const { t: translate } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop sidebar is compact (icons) by default so the page gets the room. The toggle button pins it open or
  // compact (remembered per browser; mouse, touch and keyboard all work). On top of that, hovering with a mouse or
  // tabbing into it shows it expanded as an overlay without moving the page. Only an explicit "0" means "pinned open".
  const [collapsed, setCollapsed] = useState(true);
  // Hover and keyboard focus are separate reasons to show the full sidebar.
  // Sharing one state let a pointer-leave timer collapse it while someone was
  // still tabbing through the links (and unmount the focused link with it).
  const [hoverPeek, setHoverPeek] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  // Hover opens the sidebar only when the mouse rests on it (a short delay), and closes it a moment after leaving,
  // so sweeping across it to reach the page does not make it flicker open and shut.
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleHover = (on: boolean) => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    // Hover and focus are independent reasons to stay open (`expanded` is their union), so leaving with the
    // pointer always clears hover - even while focus is inside. Skipping it when focus was inside left hover
    // stuck on after focus later moved away, and the sidebar stayed open with nobody on it.
    peekTimer.current = setTimeout(() => setHoverPeek(on), on ? 150 : 250);
  };
  useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current); }, []);
  useEffect(() => {
    let v = true;
    try { v = localStorage.getItem("orderrestro.sidebar.collapsed") !== "0"; } catch { /* storage blocked */ }
    const t = setTimeout(() => setCollapsed(v), 0);
    return () => clearTimeout(t);
  }, []);
  const expanded = !collapsed || hoverPeek || focusWithin;
  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("orderrestro.sidebar.collapsed", n ? "1" : "0"); } catch { /* storage blocked */ } return n; });
  const { branchId: shellBranch } = useBranch();
  const { data: shellDisplay } = useDisplaySettings(shellBranch);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DemoBanner />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        {translate("Skip to content")}
      </a>
      <StaffCurrencyContext.Provider value={shellDisplay?.restaurant.currency}>
      <div className="flex min-h-0 flex-1">
      {/* Desktop sidebar */}
      <aside
        id="app-sidebar"
        aria-label={translate("Main navigation")}
        className={`relative hidden shrink-0 transition-[width] duration-200 motion-reduce:transition-none lg:block ${collapsed ? "w-[4.5rem]" : "w-64"}`}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") scheduleHover(true); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") scheduleHover(false); }}
        onFocus={() => {
          setFocusWithin(true);
          // A pending hover timer must not close the sidebar under the keyboard.
          if (peekTimer.current) {
            clearTimeout(peekTimer.current);
            peekTimer.current = null;
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setFocusWithin(false);
        }}
      >
        <div className={`absolute inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none ${expanded ? "w-64" : "w-[4.5rem]"} ${collapsed && expanded ? "shadow-xl" : ""}`}>
          <div className={`flex h-16 items-center gap-2 ${expanded ? "px-5" : "justify-center px-2"}`}>
            {expanded ? <RestaurantBrand /> : <Logo />}
          </div>
          {/* Keep the switcher mounted when collapsed: unmounting its trigger
              while a portalled branch menu has focus loses that focus too. */}
          <div className={cn("px-3 pb-3", !expanded && "hidden")}>
            <BranchSwitcher />
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <SidebarNav user={user} collapsed={!expanded} />
          </div>
          <BrandFooter collapsed={!expanded} />
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">{translate("Navigation")}</SheetTitle>
          <div className="flex h-16 items-center gap-2 px-5">
            <RestaurantBrand />
          </div>
          <div className="px-3 pb-3">
            <BranchSwitcher />
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <SidebarNav user={user} onNavigate={() => setMobileOpen(false)} />
          </div>
          <BrandFooter />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary lg:hidden"
            aria-label={translate("Open navigation")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <button
              type="button"
              onClick={toggle}
              aria-controls="app-sidebar"
              aria-expanded={!collapsed}
              aria-label={collapsed ? translate("Expand navigation") : translate("Collapse navigation")}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
            {/* The restaurant's name stays in view whether the sidebar is open or collapsed. */}
            <span className="truncate text-sm font-semibold text-foreground">{shellDisplay?.restaurant?.name ?? "OrderRestro"}</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher compact />
            <NotificationBell />
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:p-6 lg:pb-6">{children}</main>
        <EntityDialogHost />
      </div>
      <MobileBottomNav user={user} onMore={() => setMobileOpen(true)} />
      </div>
      </StaffCurrencyContext.Provider>
    </div>
  );
}

"use client";

import type { SessionUser } from "@nodedr-restaurant/types";
import Link from "next/link";
import { ArrowLeft, Menu, PanelLeftClose, PanelLeftOpen, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EntityDialogHost } from "@/components/layout/entity-dialog-host";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useBranch } from "@/hooks/use-branch";
import { useDisplaySettings } from "@/hooks/use-settings";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop sidebar can collapse to icons. Remembered per browser; works with mouse, touch and keyboard (a real button).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let v = false;
    try { v = localStorage.getItem("orderrestro.sidebar.collapsed") === "1"; } catch { /* storage blocked */ }
    const t = setTimeout(() => setCollapsed(v), 0);
    return () => clearTimeout(t);
  }, []);
  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("orderrestro.sidebar.collapsed", n ? "1" : "0"); } catch { /* storage blocked */ } return n; });
  const { branchId: shellBranch } = useBranch();
  const { data: shellDisplay } = useDisplaySettings(shellBranch);

  const pathname = usePathname();
  const isChatPage = pathname === "/ask";
  const isReportsPage = pathname === "/reports";

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-background">
      <DemoBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        {!isChatPage && (
          <aside
            id="app-sidebar"
            aria-label="Main navigation"
            className={`hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none lg:flex ${
              collapsed ? "w-[4.5rem]" : "w-64"
            }`}
          >
            <div
              className={`flex h-16 items-center gap-2 ${
                collapsed ? "justify-center px-2" : "px-5"
              }`}
            >
              {collapsed ? <Logo /> : <RestaurantBrand />}
            </div>
            {!collapsed && (
              <div className="px-3 pb-3">
                <BranchSwitcher />
              </div>
            )}
            <div className="flex-1 overflow-y-auto py-2 scrollbar-none">
              <SidebarNav user={user} collapsed={collapsed} />
            </div>
            <BrandFooter collapsed={collapsed} />
          </aside>
        )}

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
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

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              {isChatPage ? (
                <Link
                  href="/dashboard"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-secondary/50 px-3 text-xs font-medium text-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
                  title="Return to Dashboard"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to Dashboard</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={toggle}
                  aria-controls="app-sidebar"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
                </button>
              )}
              {/* The restaurant's name stays in view whether the sidebar is open or collapsed. */}
              <span className="truncate text-sm font-semibold text-foreground">
                {shellDisplay?.restaurant?.name ?? "OrderRestro"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Dedicated Chat Link Button (navigates directly to full AI Assistant workspace) */}
              <Link
                href="/ask"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-all shadow-xs ${
                  isChatPage
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/80 bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground active:scale-95"
                }`}
                title="AI Assistant"
                aria-label="AI Assistant"
              >
                <MessageSquare className="h-4 w-4" />
              </Link>

              <LanguageSwitcher />
              <NotificationBell />
              <UserMenu user={user} />
            </div>
          </header>
          <main
            className={
              isChatPage
                ? "flex-1 overflow-hidden p-0 min-w-0"
                : isReportsPage
                ? "flex-1 overflow-y-auto lg:overflow-hidden p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 min-w-0"
                : "flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 min-w-0"
            }
          >
            {children}
          </main>
          <EntityDialogHost />
        </div>
        <MobileBottomNav user={user} onMore={() => setMobileOpen(true)} />
      </div>
    </div>
  );
}

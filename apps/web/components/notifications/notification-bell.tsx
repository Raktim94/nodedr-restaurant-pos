"use client";

import { Bell, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBranch } from "@/hooks/use-branch";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationEntry,
} from "@/hooks/use-notifications";
import { playNotificationFeedback } from "@/lib/notification-feedback";

// NEXT_PUBLIC_* vars are inlined at build time, so a literal default here
// would bake in whatever host built the bundle — see use-realtime.ts's
// resolveWsUrl for the full reasoning; falls back to the browser's own
// current hostname at connect time so this works from any device that
// loaded the page from the real server address, no per-deployment env
// var required.
function resolveWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4001`;
  }
  return "http://localhost:4001";
}
const MUTE_STORAGE_KEY = "nodedr_notifications_muted";

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Bell + unread badge for the dashboard topbar (mounted once in AppShell so
// it's visible across every (dashboard) page). Subscribes to the branch's
// realtime socket for `notification.created` — pushed only to sockets whose
// authenticated user was actually resolved as a recipient server-side (see
// notifications.service.ts / realtime.gateway.ts's `user:<id>` room), so
// this component never needs to filter events client-side; anything it
// receives is genuinely meant for the logged-in user.
export function NotificationBell() {
  const { branchId } = useBranch();
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // Per-device mute, not per-account — a loud kitchen expo screen and a
  // quiet back-office laptop are different physical environments, so this
  // is deliberately localStorage (this browser/device), not a user
  // preference synced from the server. Lazy initializer (read once on
  // mount), same pattern use-branch.tsx already uses, so no effect is
  // needed to keep it in sync with a would-be `open` prop.
  const [muted, setMuted] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem(MUTE_STORAGE_KEY) === "1"
      : false,
  );
  // Mirrors `muted` for the socket handler below, so toggling the mute
  // button takes effect immediately without tearing down and reopening the
  // socket connection just to rebind a listener.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const toggleMuted = () => {
    setMuted((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  useEffect(() => {
    if (!branchId) return;

    const socket = io(resolveWsUrl(), { query: { branchId }, withCredentials: true });

    socket.on("notification.created", () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (!mutedRef.current) playNotificationFeedback();
    });

    return () => {
      socket.disconnect();
    };
  }, [branchId, queryClient]);

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.data ?? [];

  const handleSelect = (notification: NotificationEntry) => {
    if (!notification.readAt) markRead.mutate(notification.id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <Badge className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            )}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 sm:w-96">
        <div className="flex items-center justify-between gap-2 px-1.5 py-1">
          <span className="text-xs font-medium text-muted-foreground">
            Notifications
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                toggleMuted();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
              aria-label={
                muted
                  ? "Unmute notification sound on this device"
                  : "Mute notification sound on this device"
              }
              aria-pressed={muted}
            >
              {muted ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  markAllRead.mutate();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                aria-label="Mark all notifications read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No notifications yet
            </p>
            <p className="text-xs text-muted-foreground">
              New orders and ready tickets will show up here.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                // Generously sized row (min 44px) — this dropdown is used
                // from tablets and shared kitchen/expo screens as much as
                // a mouse-driven desktop session, so it follows the same
                // large-touch-target discipline DESIGN_SYSTEM.md calls out
                // for POS/KDS surfaces rather than the compact default menu
                // item sizing used for text-only settings menus.
                className="min-h-11 flex-col items-start gap-0.5 whitespace-normal px-2 py-2"
                onClick={() => handleSelect(notification)}
              >
                <div className="flex w-full items-center gap-2">
                  {!notification.readAt && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden
                    />
                  )}
                  <span className="truncate text-sm font-medium text-foreground">
                    {notification.title}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {timeAgo(notification.createdAt)}
                  </span>
                </div>
                <p className="pl-0 text-xs text-muted-foreground">
                  {notification.body}
                </p>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface AttachmentProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "default";
}

export function Attachment({
  size = "default",
  className,
  children,
  ...props
}: AttachmentProps) {
  return (
    <div
      data-slot="attachment"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 text-foreground transition-colors",
        size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function AttachmentMedia({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="attachment-media"
      className={cn("flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AttachmentContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("min-w-0 flex-1 truncate font-medium", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AttachmentTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="attachment-title"
      className={cn("truncate block text-xs", className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function AttachmentActions({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AttachmentAction({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-slot="attachment-action"
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none transition-colors",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

"use client";

import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const Trace = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="trace"
    className={cn("flex flex-col gap-1 text-sm", className)}
    {...props}
  />
));
Trace.displayName = "Trace";

const traceLineVariants = cva(
  "group relative flex items-center gap-2 py-1 px-1.5 rounded-md transition-colors select-none text-muted-foreground",
  {
    variants: {
      status: {
        pending: "opacity-60 italic",
        running: "font-medium text-foreground [&_[data-slot=trace-title]]:animate-pulse",
        error: "text-destructive font-medium",
      },
    },
    defaultVariants: {},
  }
);

export interface TraceLineProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof traceLineVariants> {
  status?: "pending" | "running" | "error";
}

const TraceLine = React.forwardRef<HTMLDivElement, TraceLineProps>(
  ({ className, status, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="trace-line"
      data-status={status}
      className={cn(traceLineVariants({ status }), className)}
      {...props}
    >
      {children}
    </div>
  )
);
TraceLine.displayName = "TraceLine";

const TraceIcon = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="trace-icon"
    className={cn(
      "flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5",
      className
    )}
    {...props}
  />
));
TraceIcon.displayName = "TraceIcon";

const TraceTitle = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="trace-title"
    className={cn("flex-1 truncate text-foreground text-xs sm:text-sm font-medium", className)}
    {...props}
  />
));
TraceTitle.displayName = "TraceTitle";

const TraceDescription = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="trace-description"
    className={cn("ml-auto text-xs text-muted-foreground", className)}
    {...props}
  />
));
TraceDescription.displayName = "TraceDescription";

const TraceCollapsible = CollapsiblePrimitive.Root;

const TraceCollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleTrigger
    ref={ref}
    data-slot="trace-collapsible-trigger"
    className={cn(
      "flex w-full items-center text-left cursor-pointer [&[data-state=open]_[data-slot=trace-chevron]]:rotate-90",
      className
    )}
    {...props}
  >
    {children}
    <span
      data-slot="trace-chevron"
      className="ml-auto shrink-0 text-muted-foreground transition-transform duration-200"
    >
      <ChevronRight className="size-3.5" />
    </span>
  </CollapsiblePrimitive.CollapsibleTrigger>
));
TraceCollapsibleTrigger.displayName = "TraceCollapsibleTrigger";

export interface TraceCollapsibleContentProps
  extends React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent> {
  keepMounted?: boolean;
}

const TraceCollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  TraceCollapsibleContentProps
>(({ className, keepMounted, forceMount, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleContent
    ref={ref}
    data-slot="trace-collapsible-content"
    forceMount={keepMounted ? true : forceMount}
    className={cn(
      "overflow-hidden text-xs transition-all data-[state=closed]:hidden data-[state=open]:animate-collapsible-down pl-4 py-1",
      className
    )}
    {...props}
  />
));
TraceCollapsibleContent.displayName = "TraceCollapsibleContent";

export {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
};


"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const bubbleVariants = cva(
  "flex max-w-[85%] sm:max-w-[80%] flex-col gap-1.5 w-fit",
  {
    variants: {
      align: {
        start: "mr-auto items-start",
        end: "ml-auto items-end",
      },
    },
    defaultVariants: {
      align: "start",
    },
  }
);

export interface BubbleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleVariants> {
  align?: "start" | "end";
}

function Bubble({
  className,
  align = "start",
  children,
  ...props
}: BubbleProps) {
  return (
    <div
      data-slot="bubble"
      data-align={align}
      className={cn(bubbleVariants({ align }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

const bubbleContentVariants = cva(
  "rounded-xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-xs transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground font-medium",
        secondary: "bg-secondary text-secondary-foreground",
        muted: "bg-muted/50 text-foreground border border-border/70",
        tinted: "bg-primary/10 text-foreground border border-primary/20",
        outline: "border border-border bg-background text-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        ghost: "bg-transparent text-foreground shadow-none px-0 py-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BubbleContentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleContentVariants> {}

function BubbleContent({
  className,
  variant,
  children,
  ...props
}: BubbleContentProps) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(bubbleContentVariants({ variant }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { Bubble, BubbleContent };

"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group border-input bg-background/50 shadow-xs relative flex w-full items-center rounded-xl border outline-none transition-[color,box-shadow]",
        "has-[>textarea]:h-auto",
        "has-[>[data-align=inline-start]]:[&>input]:pl-2",
        "has-[>[data-align=inline-end]]:[&>input]:pr-2",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-ring has-[[data-slot=input-group-control]:focus-visible]:border-ring",
        "has-data-[disabled]:opacity-50 has-data-[disabled]:cursor-not-allowed",
        className
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex items-center justify-center gap-2 text-sm font-medium transition-colors select-none",
  {
    variants: {
      align: {
        "inline-start": "order-first px-3",
        "inline-end": "order-last px-3",
        "block-start": "order-first w-full px-3 pt-2.5 pb-1 text-xs",
        "block-end": "order-last w-full px-3 pt-1 pb-2.5 text-xs",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
);

interface InputGroupAddonProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof inputGroupAddonVariants> {}

function InputGroupAddon({
  className,
  align = "inline-start",
  onClick,
  ...props
}: InputGroupAddonProps) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) {
      return;
    }
    const group = e.currentTarget.closest('[data-slot="input-group"]');
    const control = group?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[data-slot="input-group-control"]'
    );
    control?.focus();
    onClick?.(e);
  };

  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={handleClick}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-text"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

interface InputGroupButtonProps
  extends React.ComponentProps<typeof Button> {
  size?: "xs" | "sm" | "default" | "lg" | "icon" | "icon-xs" | "icon-sm";
}

function InputGroupButton({
  className,
  variant = "ghost",
  size = "xs",
  ...props
}: InputGroupButtonProps) {
  return (
    <Button
      data-slot="input-group-button"
      variant={variant}
      size={size as any}
      className={cn(
        "h-7 px-2 text-xs shadow-none data-[slot=input-group-button]:focus-visible:ring-0",
        className
      )}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent",
        className
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 focus-visible:outline-none resize-none dark:bg-transparent min-h-14 text-xs",
        className
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
};

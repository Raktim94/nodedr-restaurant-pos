"use client";

import * as React from "react";
import Image from "next/image";
import { Sparkles, CheckCircle2, Clock, Loader2 } from "lucide-react";
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "@/components/ui/trace";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ChainOfThoughtProps
  extends React.ComponentPropsWithoutRef<typeof TraceCollapsible> {
  children: React.ReactNode;
}

export function ChainOfThought({
  open,
  defaultOpen,
  onOpenChange,
  className,
  children,
  ...props
}: ChainOfThoughtProps) {
  return (
    <Trace className={cn("w-full py-1", className)}>
      <TraceCollapsible
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        {...props}
      >
        {children}
      </TraceCollapsible>
    </Trace>
  );
}

export interface ChainOfThoughtHeaderProps
  extends React.ComponentPropsWithoutRef<typeof TraceCollapsibleTrigger> {
  title?: string;
  stepCount?: number;
  completedCount?: number;
  icon?: React.ReactNode;
}

export function ChainOfThoughtHeader({
  title,
  stepCount,
  completedCount,
  icon,
  className,
  children,
  ...props
}: ChainOfThoughtHeaderProps) {
  const displayTitle =
    title ||
    (stepCount !== undefined
      ? `Researched in ${stepCount} ${stepCount === 1 ? "step" : "steps"}`
      : "Chain of Thought");

  return (
    <TraceCollapsibleTrigger className={cn("w-full py-1", className)} {...props}>
      <TraceLine className="w-full">
        <TraceIcon>{icon || <Sparkles className="h-3.5 w-3.5 text-primary" />}</TraceIcon>
        <TraceTitle>{displayTitle}</TraceTitle>
        {completedCount !== undefined && stepCount !== undefined && (
          <TraceDescription>
            {completedCount}/{stepCount}
          </TraceDescription>
        )}
        {children}
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}

export interface ChainOfThoughtContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof TraceCollapsibleContent>, "keepMounted"> {
  keepMounted?: boolean;
}

export function ChainOfThoughtContent({
  keepMounted = true,
  className,
  children,
  ...props
}: ChainOfThoughtContentProps) {
  return (
    <TraceCollapsibleContent keepMounted={keepMounted} className={className} {...props}>
      <Trace className="gap-1 border-l-2 border-border/50 pl-2 ml-1 mt-1">
        {children}
      </Trace>
    </TraceCollapsibleContent>
  );
}

export type ChainOfThoughtStepStatus = "active" | "pending" | "complete";

export interface ChainOfThoughtStepProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  label?: string;
  title?: string;
  description?: string;
  status?: ChainOfThoughtStepStatus;
  icon?: React.ReactNode;
}

export function ChainOfThoughtStep({
  label,
  title,
  description,
  status = "complete",
  icon,
  className,
  children,
  ...props
}: ChainOfThoughtStepProps) {
  // Map status: "active" to "running", "pending" to "pending", and "complete" to no status.
  const mappedStatus =
    status === "active" ? "running" : status === "pending" ? "pending" : undefined;

  const defaultIcon =
    status === "active" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : status === "pending" ? (
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
    ) : (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    );

  const displayTitle = label || title;

  return (
    <div className={cn("flex flex-col gap-1 w-full", className)} {...props}>
      <TraceLine status={mappedStatus}>
        <TraceIcon>{icon || defaultIcon}</TraceIcon>
        {displayTitle && <TraceTitle>{displayTitle}</TraceTitle>}
        {description && <TraceDescription>{description}</TraceDescription>}
      </TraceLine>
      {children && <div className="pl-6 w-full">{children}</div>}
    </div>
  );
}

export interface ChainOfThoughtSearchResultsProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function ChainOfThoughtSearchResults({
  className,
  children,
  ...props
}: ChainOfThoughtSearchResultsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 py-1", className)} {...props}>
      {children}
    </div>
  );
}

export interface ChainOfThoughtSearchResultProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  title?: string;
  url?: string;
  children?: React.ReactNode;
}

export function ChainOfThoughtSearchResult({
  title,
  url,
  children,
  className,
  ...props
}: ChainOfThoughtSearchResultProps) {
  const content = (
    <Badge
      variant="secondary"
      className={cn(
        "cursor-pointer text-[11px] font-normal transition-colors hover:bg-secondary/80",
        className
      )}
    >
      {title || children}
    </Badge>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex"
        {...props}
      >
        {content}
      </a>
    );
  }

  return content;
}

export interface ChainOfThoughtImageProps {
  src: string;
  alt?: string;
  caption?: string;
  className?: string;
}

export function ChainOfThoughtImage({
  src,
  alt = "Chain of thought image",
  caption,
  className,
}: ChainOfThoughtImageProps) {
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-border/60 bg-muted/20 my-1", className)}>
      <div className="relative aspect-video w-full">
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 400px"
        />
      </div>
      {caption && (
        <figcaption className="p-2 text-center text-[11px] text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}


"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SuggestionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: React.ReactNode;
}

export function Suggestion({
  label,
  icon,
  className,
  ...props
}: SuggestionProps) {
  return (
    <button
      type="button"
      data-slot="ai-suggestion"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border/60 bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-secondary hover:border-primary/40 active:scale-95 focus:outline-none",
        className
      )}
      {...props}
    >
      {icon ? (
        icon
      ) : (
        <Sparkles className="h-3 w-3 text-primary shrink-0" />
      )}
      <span>{label}</span>
    </button>
  );
}

export function SuggestionsList({
  suggestions,
  onSelect,
  className,
}: {
  suggestions: Array<{ id: string; label: string; icon?: React.ReactNode }>;
  onSelect: (label: string) => void;
  className?: string;
}) {
  return (
    <div
      data-slot="ai-suggestions-list"
      className={cn(
        "flex w-full items-center gap-2 overflow-x-auto py-1 scrollbar-none",
        className
      )}
    >
      {suggestions.map((s) => (
        <Suggestion
          key={s.id}
          label={s.label}
          icon={s.icon}
          onClick={() => onSelect(s.label)}
        />
      ))}
    </div>
  );
}


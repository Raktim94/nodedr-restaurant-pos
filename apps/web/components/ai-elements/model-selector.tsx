"use client";

import * as React from "react";
import {
  Sparkles,
  Gauge,
  Key,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ModelOption {
  id: string;
  name: string;
  provider: "Google" | "OpenAI" | "Anthropic" | "Local (Ollama)";
  contextWindow: string;
  visionSupport: boolean;
  quota: {
    used: number;
    total: number;
    unit: string;
    resetIn: string;
  };
}

export const SUPPORTED_MODELS: ModelOption[] = [
  {
    id: "gemini-flash-latest",
    name: "Gemini Flash (Latest)",
    provider: "Google",
    contextWindow: "1M tokens",
    visionSupport: true,
    quota: {
      used: 342,
      total: 1500,
      unit: "req/day",
      resetIn: "4h",
    },
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "Google",
    contextWindow: "2M tokens",
    visionSupport: true,
    quota: {
      used: 18,
      total: 50,
      unit: "req/day",
      resetIn: "4h",
    },
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "OpenAI",
    contextWindow: "128k tokens",
    visionSupport: true,
    quota: {
      used: 450,
      total: 2000,
      unit: "req/day",
      resetIn: "12h",
    },
  },
  {
    id: "gpt-4o",
    name: "GPT-4o (Omni)",
    provider: "OpenAI",
    contextWindow: "128k tokens",
    visionSupport: true,
    quota: {
      used: 64,
      total: 500,
      unit: "req/day",
      resetIn: "12h",
    },
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    contextWindow: "200k tokens",
    visionSupport: true,
    quota: {
      used: 120,
      total: 1000,
      unit: "req/day",
      resetIn: "8h",
    },
  },
  {
    id: "ollama-local",
    name: "Llama 3.2 (Local)",
    provider: "Local (Ollama)",
    contextWindow: "128k tokens",
    visionSupport: false,
    quota: {
      used: 890,
      total: 99999,
      unit: "unlimited",
      resetIn: "never",
    },
  },
];

interface ModelSelectorProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  className?: string;
}

export function ModelSelector({
  selectedModelId,
  onSelectModel,
  className,
}: ModelSelectorProps) {
  const currentModel =
    SUPPORTED_MODELS.find((m) => m.id === selectedModelId) || SUPPORTED_MODELS[0];

  const quotaPercent = Math.min(
    100,
    Math.round((currentModel.quota.used / currentModel.quota.total) * 100)
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border/70 bg-background/80 text-xs font-medium text-foreground hover:bg-muted/50 focus:outline-none transition-all shadow-2xs",
          className
        )}
      >
        <Sparkles className="h-3 w-3 text-primary shrink-0" />
        <span className="font-semibold truncate max-w-[110px] sm:max-w-[140px]">
          {currentModel.name}
        </span>
        <span className="text-[10px] text-muted-foreground hidden sm:inline tabular-nums">
          ({currentModel.quota.used}/{currentModel.quota.total})
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-2 text-xs">
        {/* Active Model Quota Progress Card */}
        <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-primary" /> Active Model Quota
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              Resets in {currentModel.quota.resetIn}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Requests consumed:</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {currentModel.quota.used} / {currentModel.quota.total} {currentModel.quota.unit}
            </span>
          </div>

          {/* Quota Bar */}
          <div className="mt-1.5 h-1.5 w-full bg-border/60 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                quotaPercent > 85
                  ? "bg-rose-500"
                  : quotaPercent > 60
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              )}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
        </div>

        <DropdownMenuLabel className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Switch AI Model & Engine
        </DropdownMenuLabel>

        <div className="space-y-1 mt-1">
          {SUPPORTED_MODELS.map((m) => {
            const isSelected = m.id === currentModel.id;
            const percent = Math.round((m.quota.used / m.quota.total) * 100);

            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectModel(m.id)}
                className={cn(
                  "w-full flex items-start justify-between p-2 rounded-lg text-left transition-colors border",
                  isSelected
                    ? "bg-primary/10 border-primary/30 text-foreground"
                    : "border-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("font-medium text-xs truncate", isSelected ? "text-primary font-semibold" : "text-foreground")}>
                      {m.name}
                    </span>
                    {m.visionSupport && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-border/60 font-mono">
                        Vision
                      </Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">
                    {m.provider} · {m.contextWindow}
                  </span>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] font-mono tabular-nums block text-foreground">
                    {m.quota.used}/{m.quota.total}
                  </span>
                  <span className="text-[9px] text-muted-foreground block">
                    {percent}% used
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <DropdownMenuSeparator className="my-2" />

        <div className="px-2 py-1 text-[11px] text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Key className="h-3 w-3 text-muted-foreground" /> API Keys configured in
          </span>
          <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
            .env
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import * as React from "react";
import { Check, ArrowRight, CornerDownLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface QuestionOption {
  label: string;
  description?: string;
  isRecommended?: boolean;
}

export interface QuestionCardData {
  header?: string;
  question: string;
  options: QuestionOption[];
}

export interface QuestionCardProps {
  data: QuestionCardData;
  onSelectOption: (option: QuestionOption, index: number) => void;
  onSubmitCustomAnswer?: (customAnswer: string) => void;
  disabled?: boolean;
  className?: string;
}

export function QuestionCard({
  data,
  onSelectOption,
  onSubmitCustomAnswer,
  disabled = false,
  className,
}: QuestionCardProps) {
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [showOtherInput, setShowOtherInput] = React.useState<boolean>(false);
  const [customText, setCustomText] = React.useState<string>("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSelect = (option: QuestionOption, idx: number) => {
    if (disabled || selectedIndex !== null) return;
    setSelectedIndex(idx);
    setShowOtherInput(false);
    onSelectOption(option, idx);
  };

  const handleToggleOther = () => {
    if (disabled || selectedIndex !== null) return;
    setShowOtherInput(true);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const handleCustomSubmit = () => {
    const trimmed = customText.trim();
    if (!trimmed || disabled) return;
    setSelectedIndex(-1); // special mark for custom
    if (onSubmitCustomAnswer) {
      onSubmitCustomAnswer(trimmed);
    } else {
      onSelectOption({ label: trimmed, description: "Custom instruction" }, -1);
    }
  };

  const otherIndex = data.options.length + 1;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-xs overflow-hidden flex flex-col text-left max-w-2xl w-full my-2 animate-in fade-in-50 duration-150",
        className
      )}
    >
      {/* Header Row */}
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2">
        {data.header && (
          <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            {data.header}
          </span>
        )}
        <p className="text-sm sm:text-base font-semibold text-foreground leading-snug">
          {data.question}
        </p>
      </div>

      {/* Options Stack */}
      <div className="flex flex-col gap-1 p-2 pt-0">
        {data.options.map((option, idx) => {
          const isSelected = selectedIndex === idx;
          return (
            <button
              key={idx}
              type="button"
              disabled={disabled || selectedIndex !== null}
              onClick={() => handleSelect(option, idx)}
              className={cn(
                "group flex items-start gap-3 p-3 rounded-lg border text-left transition-all active:scale-[0.99]",
                isSelected
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : option.isRecommended
                  ? "border-primary/40 bg-accent/30 hover:bg-accent/60 hover:border-primary"
                  : "border-border/70 bg-card hover:bg-secondary/60 hover:border-border",
                disabled && !isSelected && "opacity-50 cursor-not-allowed"
              )}
            >
              {/* Option Number or Check Badge */}
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-colors mt-0.5",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : option.isRecommended
                    ? "bg-primary/20 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                    : "bg-muted text-muted-foreground group-hover:bg-muted-foreground/20 group-hover:text-foreground"
                )}
              >
                {isSelected ? <Check className="h-3 w-3 stroke-[3]" /> : idx + 1}
              </div>

              {/* Label & Description */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {option.label}
                  </span>
                  {option.isRecommended && (
                    <Badge
                      variant="default"
                      className="text-[9px] px-1.5 py-0 h-4 bg-primary text-primary-foreground font-medium rounded-full"
                    >
                      Recommended
                    </Badge>
                  )}
                </div>
                {option.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-normal">
                    {option.description}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors mt-1 opacity-70 group-hover:opacity-100">
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </button>
          );
        })}

        {/* Option: Other / Custom Input (prcrm style) */}
        {!showOtherInput ? (
          <button
            type="button"
            disabled={disabled || selectedIndex !== null}
            onClick={handleToggleOther}
            className={cn(
              "group flex items-center gap-3 p-3 rounded-lg border border-border/70 bg-card hover:bg-secondary/60 hover:border-border text-left transition-all active:scale-[0.99]",
              disabled && selectedIndex !== null && "opacity-50 cursor-not-allowed"
            )}
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              {otherIndex}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs sm:text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Other (type your own answer)…
              </span>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors opacity-70 group-hover:opacity-100" />
          </button>
        ) : (
          <div className="flex flex-col gap-2 p-3 rounded-lg border border-primary/40 bg-accent/20 animate-in fade-in-50 duration-150">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold bg-primary text-primary-foreground">
                {otherIndex}
              </div>
              <span className="text-xs font-semibold text-foreground">
                Your custom instruction:
              </span>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Type how you want the assistant to proceed..."
                rows={2}
                disabled={disabled || selectedIndex !== null}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleCustomSubmit();
                  }
                }}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customText.trim() || disabled || selectedIndex !== null}
                className="flex items-center justify-center h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary-hover active:scale-95 disabled:opacity-50 transition-all gap-1 shrink-0"
              >
                <span>Submit</span>
                <CornerDownLeft className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

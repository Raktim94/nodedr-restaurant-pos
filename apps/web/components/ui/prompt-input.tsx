"use client";

import * as React from "react";
import { ArrowUp, Mic, Paperclip, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PromptInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  onStop?: () => void;
  onVoiceClick?: () => void;
  onAttachClick?: () => void;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Ask AI or speak an order…",
  disabled = false,
  isLoading = false,
  onStop,
  onVoiceClick,
  onAttachClick,
  className,
  ...props
}: PromptInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea up to 160px
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled && !isLoading) {
        onSubmit();
      }
    }
  };

  return (
    <div
      data-slot="prompt-input-container"
      className={cn(
        "relative flex flex-col rounded-2xl border border-border/70 bg-card p-2 shadow-xs transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20",
        className
      )}
      {...props}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-none bg-transparent px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          {onAttachClick && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onAttachClick}
              disabled={disabled}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              title="Attach photo or file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          )}

          {onVoiceClick && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onVoiceClick}
              disabled={disabled}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-primary active:scale-95 transition-transform"
              title="Voice order dictation"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isLoading ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={onStop}
              className="h-8 w-8 rounded-xl active:scale-95 transition-transform"
              title="Stop response"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              disabled={!value.trim() || disabled}
              onClick={() => onSubmit()}
              className="h-8 w-8 rounded-xl bg-primary text-primary-foreground active:scale-95 transition-transform shadow-xs disabled:opacity-40"
              title="Send prompt"
            >
              <ArrowUp className="h-4 w-4 stroke-[2.5]" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

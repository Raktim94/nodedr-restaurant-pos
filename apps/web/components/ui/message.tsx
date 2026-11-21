"use client";

import * as React from "react";
import { Bot, Check, Copy, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  role: "user" | "assistant" | "system";
  children: React.ReactNode;
  avatar?: React.ReactNode;
}

export function Message({
  role,
  avatar,
  children,
  className,
  ...props
}: MessageProps) {
  const isUser = role === "user";

  return (
    <div
      data-slot="chat-message"
      data-role={role}
      className={cn(
        "group flex w-full gap-3 text-sm",
        isUser ? "flex-row-reverse" : "flex-row",
        className
      )}
      {...props}
    >
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-xl border border-border/60 bg-muted shadow-xs">
        {avatar ? (
          avatar
        ) : isUser ? (
          <User className="h-4 w-4 text-foreground/80" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary" />
        )}
      </div>

      {/* Bubble Content */}
      <div
        className={cn(
          "flex max-w-[85%] sm:max-w-[78%] flex-col gap-1.5",
          isUser && "items-end"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-xs",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-xs"
              : "bg-secondary/70 border border-border/50 text-foreground rounded-tl-xs"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function MessageActions({
  content,
  className,
  onCopy,
}: {
  content?: string;
  className?: string;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (content) {
      void navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5",
        className
      )}
    >
      {content && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
          title={copied ? "Copied" : "Copy message"}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </Button>
      )}
    </div>
  );
}


"use client";

import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Chat({ className, children, ...props }: ChatProps) {
  return (
    <div
      data-slot="chat-container"
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-background",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  autoScroll?: boolean;
}

export function ChatMessageList({
  className,
  children,
  autoScroll = true,
  ...props
}: ChatMessageListProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const scrollToBottom = React.useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  const handleScroll = React.useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(atBottom);
  }, []);

  React.useEffect(() => {
    if (autoScroll && isAtBottom) {
      scrollToBottom();
    }
  }, [children, autoScroll, isAtBottom, scrollToBottom]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-slot="chat-message-list"
        className={cn(
          "h-full w-full overflow-y-auto px-4 py-4 space-y-4 scroll-smooth",
          className
        )}
        {...props}
      >
        {children}
      </div>

      {!isAtBottom && (
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToBottom}
          className="absolute bottom-3 right-4 h-8 w-8 rounded-full bg-background/80 backdrop-blur-md shadow-md border-border/70 hover:bg-background transition-transform active:scale-95 z-10"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}


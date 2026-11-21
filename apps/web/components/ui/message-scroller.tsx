/* eslint-disable react-hooks/immutability --
   The viewport element is shared through a callback ref (the standard way to merge a forwarded ref with an internal one). */
"use client";

import * as React from "react";
import { ArrowDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageScrollerContextValue {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

const MessageScrollerContext = React.createContext<MessageScrollerContextValue | null>(null);

export function useMessageScroller() {
  const context = React.useContext(MessageScrollerContext);
  if (!context) {
    throw new Error("MessageScroller components must be wrapped within <MessageScrollerProvider />");
  }
  return context;
}

export interface MessageScrollerProviderProps {
  children: React.ReactNode;
  autoScroll?: boolean;
}

export function MessageScrollerProvider({
  children,
  autoScroll = true,
}: MessageScrollerProviderProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  return (
    <MessageScrollerContext.Provider value={{ viewportRef, isAtBottom, scrollToBottom }}>
      {children}
    </MessageScrollerContext.Provider>
  );
}

export type MessageScrollerProps = React.HTMLAttributes<HTMLDivElement>;

export const MessageScroller = React.forwardRef<HTMLDivElement, MessageScrollerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative flex flex-col flex-1 min-h-0 overflow-hidden", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageScroller.displayName = "MessageScroller";

export type MessageScrollerViewportProps = React.HTMLAttributes<HTMLDivElement>;

export const MessageScrollerViewport = React.forwardRef<HTMLDivElement, MessageScrollerViewportProps>(
  ({ className, children, onScroll, ...props }, ref) => {
    const { viewportRef } = useMessageScroller();

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(e);
    };

    // Hands the element to both the scroller's own ref and any ref the caller passed.
    const setRefs = (node: HTMLDivElement | null) => {
      (viewportRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    };

    return (
      <div
        ref={setRefs}
        tabIndex={0}
        role="region"
        aria-label="Message transcript"
        onScroll={handleScroll}
        className={cn(
          "flex-1 overflow-y-auto focus-visible:outline-none scroll-smooth",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageScrollerViewport.displayName = "MessageScrollerViewport";

export type MessageScrollerContentProps = React.HTMLAttributes<HTMLDivElement>;

export const MessageScrollerContent = React.forwardRef<HTMLDivElement, MessageScrollerContentProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-6 p-4 md:p-8 max-w-4xl w-full mx-auto", className)}
        {...props}
      />
    );
  }
);
MessageScrollerContent.displayName = "MessageScrollerContent";

export interface MessageScrollerItemProps extends React.HTMLAttributes<HTMLDivElement> {
  messageId: string;
  scrollAnchor?: boolean;
}

export const MessageScrollerItem = React.forwardRef<HTMLDivElement, MessageScrollerItemProps>(
  ({ className, messageId, scrollAnchor, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-message-id={messageId}
        data-anchor={scrollAnchor ? true : undefined}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    );
  }
);
MessageScrollerItem.displayName = "MessageScrollerItem";

export type MessageScrollerButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const MessageScrollerButton = React.forwardRef<HTMLButtonElement, MessageScrollerButtonProps>(
  ({ className, ...props }, ref) => {
    const { isAtBottom, scrollToBottom } = useMessageScroller();

    if (isAtBottom) return null;

    return (
      <button
        ref={ref}
        type="button"
        onClick={() => scrollToBottom()}
        className={cn(
          "absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-md transition-all hover:bg-accent hover:text-accent-foreground",
          className
        )}
        {...props}
      >
        <span>Latest messages</span>
        <ArrowDownIcon className="h-3.5 w-3.5" />
      </button>
    );
  }
);
MessageScrollerButton.displayName = "MessageScrollerButton";

"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, Trash2, Maximize2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Chat, ChatMessageList } from "@/components/ui/chat";
import { Message, MessageActions } from "@/components/ui/message";
import { PromptInput } from "@/components/ui/prompt-input";
import { SuggestionsList } from "@/components/ui/suggestion";
import { Confirmation } from "@/components/ui/confirmation";
import { Reasoning } from "@/components/ui/reasoning";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  confirmation?: {
    title: string;
    description: string;
    status: "pending" | "confirmed" | "cancelled";
  };
}

const DEFAULT_SUGGESTIONS = [
  { id: "1", label: "Top sellers today" },
  { id: "2", label: "Table 2 status" },
  { id: "3", label: "Low stock alert" },
  { id: "4", label: "Draft a weekend dish" },
];

export function AiAssistantSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [input, setInput] = React.useState("");
  const [isTyping, setIsTyping] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatItem[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your OrderRestro AI assistant. You can speak or type to take table orders, check live table status, inspect stock levels, or get instant sales reports.",
    },
  ]);

  const handleSend = (text?: string) => {
    const prompt = (text || input).trim();
    if (!prompt) return;

    const userMsg: ChatItem = {
      id: String(Date.now()),
      role: "user",
      content: prompt,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Mock intelligent restaurant assistant response
    setTimeout(() => {
      let reply: ChatItem;
      const lower = prompt.toLowerCase();

      if (lower.includes("top") || lower.includes("sales") || lower.includes("best")) {
        reply = {
          id: String(Date.now() + 1),
          role: "assistant",
          reasoning: "Queried completed KOT tickets for the active shift and ranked items by volume.",
          content:
            "Here are today's top sellers so far:\n\n1. **Butter Chicken** — 14 orders (₹6,720)\n2. **Margherita Pizza** — 11 orders (₹4,620)\n3. **Virgin Mojito** — 9 orders (₹1,980)\n\nPeak ordering hour was between 1:00 PM and 2:30 PM.",
        };
      } else if (lower.includes("table") || lower.includes("order") || lower.includes("mojito")) {
        reply = {
          id: String(Date.now() + 1),
          role: "assistant",
          content: "I parsed your order request. Would you like me to push this directly to the Kitchen Display (KDS)?",
          confirmation: {
            title: "Push order to Table 2 (Kitchen)",
            description: "2× Virgin Mojito (₹440) + 1× Margherita Pizza (₹420) — Total: ₹860 (Tax incl.)",
            status: "pending",
          },
        };
      } else if (lower.includes("stock") || lower.includes("inventory")) {
        reply = {
          id: String(Date.now() + 1),
          role: "assistant",
          content: "⚠️ **Inventory Alert**:\n\n- **Paneer**: 1.2 kg remaining (~6 portions left). Expected to run out by dinner shift.\n- **Mozzarella**: Healthy (6.4 kg).\n\nWould you like me to create a purchase order voucher?",
        };
      } else {
        reply = {
          id: String(Date.now() + 1),
          role: "assistant",
          content: `I've noted that for the current branch. You can ask me to draft menu items, check live tables, reorder ingredients, or inspect sales.`,
        };
      }

      setMessages((prev) => [...prev, reply]);
      setIsTyping(false);
    }, 700);
  };

  const handleConfirmAction = (msgId: string, confirmed: boolean) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId && m.confirmation) {
          return {
            ...m,
            confirmation: {
              ...m.confirmation,
              status: confirmed ? "confirmed" : "cancelled",
            },
          };
        }
        return m;
      })
    );
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome-reset",
        role: "assistant",
        content: "Chat history cleared. How can I assist you with your restaurant operations?",
      },
    ]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden bg-background border-l border-border/70 z-50 shadow-2xl [&>button[data-slot=sheet-close]]:top-2.5 [&>button[data-slot=sheet-close]]:right-2.5"
      >
        {/* Mobile-Friendly Fixed Top Header */}
        <SheetHeader className="p-3 sm:p-4 border-b border-border/60 bg-muted/30 shrink-0 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <SheetTitle className="text-sm sm:text-base font-bold tracking-tight text-foreground truncate">
                OrderRestro AI
              </SheetTitle>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Assistant</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 pr-9">
            <Link
              href="/ask"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
              title="Open full dedicated page"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearChat}
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        {/* Scrollable Chat Area */}
        <Chat className="flex-1 min-h-0 bg-background/50">
          <ChatMessageList className="p-3 sm:p-4 space-y-3.5">
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-2">
                <Message role={m.role}>
                  {m.reasoning && (
                    <div className="mb-2">
                      <Reasoning durationMs={1200}>{m.reasoning}</Reasoning>
                    </div>
                  )}

                  <div className="whitespace-pre-wrap leading-relaxed text-xs sm:text-sm">
                    {m.content}
                  </div>

                  {m.confirmation && (
                    <div className="mt-2.5">
                      {m.confirmation.status === "pending" ? (
                        <Confirmation
                          title={m.confirmation.title}
                          description={m.confirmation.description}
                          confirmLabel="Approve & Send"
                          cancelLabel="Dismiss"
                          onConfirm={() => handleConfirmAction(m.id, true)}
                          onCancel={() => handleConfirmAction(m.id, false)}
                        />
                      ) : (
                        <div className="rounded-xl border border-border/60 bg-muted/40 p-2.5 text-xs font-medium flex items-center justify-between">
                          <span className="text-muted-foreground">{m.confirmation.title}</span>
                          <Badge
                            variant={m.confirmation.status === "confirmed" ? "default" : "secondary"}
                            className="text-[10px] uppercase font-semibold"
                          >
                            {m.confirmation.status}
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}

                  {m.role === "assistant" && (
                    <div className="flex justify-end pt-1">
                      <MessageActions content={m.content} />
                    </div>
                  )}
                </Message>
              </div>
            ))}

            {isTyping && (
              <Message role="assistant">
                <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
                  <span className="ml-1 text-xs">Thinking…</span>
                </div>
              </Message>
            )}
          </ChatMessageList>

          {/* Sticky Quick Suggestions + Input Area */}
          <div className="shrink-0 p-3 sm:p-4 pt-1.5 bg-background border-t border-border/60 flex flex-col gap-2.5">
            <SuggestionsList
              suggestions={DEFAULT_SUGGESTIONS}
              onSelect={(label) => handleSend(label)}
            />

            <PromptInput
              value={input}
              onChange={setInput}
              onSubmit={() => handleSend()}
              placeholder="Ask anything or type table order…"
              isLoading={isTyping}
              onVoiceClick={() => {
                setInput("2x Virgin Mojito, 1x Margherita Pizza for Table 2");
              }}
            />
          </div>
        </Chat>
      </SheetContent>
    </Sheet>
  );
}


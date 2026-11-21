"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpIcon,
  CircleCheckIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  PlusIcon,
  RotateCwIcon,
  TelescopeIcon,
  TerminalIcon,
  MessageSquare,
  Search,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ChefHat,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Package,
  Layers,
  Flame,
  FileTextIcon,
  XIcon,
  ChevronDownIcon,
  Check,
  UtensilsCrossed,
  Cpu,
} from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/ai-elements/markdown-renderer";
import { useBranch } from "@/hooks/use-branch";
import { useQueryClient } from "@tanstack/react-query";
import { QuestionCard, type QuestionCardData, type QuestionOption } from "@/components/ui/question-card";
import { ApprovalReviewDeck, type ProposalData } from "@/components/ui/approval-review-deck";
import { ThinkingStepsDisplay } from "@/components/ui/thinking-steps";

interface ChatThread {
  id: string;
  title: string;
  preview: string;
  time: string;
  status: "active" | "completed";
}

interface ChatMessagePart {
  type: "text" | "reasoning" | "tool-runCommand" | "image" | "question-card";
  text?: string;
  command?: string;
  toolCallId?: string;
  state?: "streaming" | "approval-requested" | "approval-responded" | "output-available" | "output-denied";
  approved?: boolean;
  imageData?: string;
  actionTitle?: string;
  actionDescription?: string;
  questionData?: QuestionCardData;
  proposalData?: ProposalData;
}

// Module-level so ids are generated in event handlers, not during render.
function newMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface MessageItem {
  id: string;
  role: "user" | "assistant";
  parts: ChatMessagePart[];
}

const STORAGE_KEY_THREADS = "orderrestro_chat_threads_v5";
const STORAGE_KEY_MESSAGES_PREFIX = "orderrestro_chat_msgs_v5_";
const STORAGE_KEY_SIDEBAR = "orderrestro_chat_sidebar_open_v5";
const STORAGE_KEY_ACTIVE_THREAD = "orderrestro_active_thread_id_v5";

const providers = [
  {
    name: "Google Gemini",
    models: [
      { id: "gemini-flash-latest", name: "Gemini Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Lite" },
    ],
  },
  {
    name: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "gpt-4o", name: "GPT-4o" },
    ],
  },
  {
    name: "Anthropic",
    models: [
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    ],
  },
];

const allModels = providers.flatMap((p) => p.models);

const efforts = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
];

export default function AskAssistantPage() {
  const [model, setModel] = React.useState<string>(allModels[0].id);
  const [effort, setEffort] = React.useState<string>(efforts[1].id);
  const [threads, setThreads] = React.useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = React.useState<string>("");
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [text, setText] = React.useState("");
  const [attachedFiles, setAttachedFiles] = React.useState<Array<{ id: string; name: string; mimeType: string; data: string; preview: string }>>([]);
  const [status, setStatus] = React.useState<"ready" | "submitted" | "streaming">("ready");

  const formRef = React.useRef<HTMLFormElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const currentModel = allModels.find((m) => m.id === model) ?? allModels[0];
  const currentEffort = efforts.find((e) => e.id === effort) ?? efforts[1];

  const { branchId } = useBranch();
  const queryClient = useQueryClient();
  const [executingToolId, setExecutingToolId] = React.useState<string | null>(null);

  // Messages state starts empty
  const [messages, setMessages] = React.useState<MessageItem[]>([]);

  // Auto-scroll to bottom whenever messages or status changes
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Load saved state from LocalStorage on mount
  // localStorage only exists in the browser, so this has to run after mount (reading it during render would break hydration).
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    try {
      const savedThreads = localStorage.getItem(STORAGE_KEY_THREADS);
      const parsedThreads: ChatThread[] = savedThreads ? JSON.parse(savedThreads) : [];
      setThreads(parsedThreads);

      const savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE_THREAD);
      const activeId = savedActiveId || (parsedThreads.length > 0 ? parsedThreads[0].id : "");
      setActiveThreadId(activeId);

      if (activeId) {
        const savedMsgs = localStorage.getItem(`${STORAGE_KEY_MESSAGES_PREFIX}${activeId}`);
        if (savedMsgs) {
          setMessages(JSON.parse(savedMsgs));
        }
      }

      const savedSidebar = localStorage.getItem(STORAGE_KEY_SIDEBAR);
      if (savedSidebar !== null) {
        setSidebarOpen(savedSidebar === "1");
      } else if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    } catch {}
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const persistMessages = (threadId: string, newMsgs: MessageItem[]) => {
    setMessages(newMsgs);
    if (!threadId) return;
    try {
      localStorage.setItem(`${STORAGE_KEY_MESSAGES_PREFIX}${threadId}`, JSON.stringify(newMsgs));
    } catch {}
  };

  const saveThreads = (newThreads: ChatThread[]) => {
    setThreads(newThreads);
    try {
      localStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(newThreads));
    } catch {}
  };

  const switchThread = (threadId: string) => {
    setActiveThreadId(threadId);
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_THREAD, threadId);
      const savedMsgs = localStorage.getItem(`${STORAGE_KEY_MESSAGES_PREFIX}${threadId}`);
      setMessages(savedMsgs ? JSON.parse(savedMsgs) : []);
    } catch {
      setMessages([]);
    }
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_SIDEBAR, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const handleCreateNewThread = () => {
    const newId = `thread-${Date.now()}`;
    const newThread: ChatThread = {
      id: newId,
      title: "New Conversation",
      preview: "Ready to assist…",
      time: "Just now",
      status: "active",
    };
    const updated = [newThread, ...threads];
    saveThreads(updated);
    setActiveThreadId(newId);
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_THREAD, newId);
    } catch {}
    persistMessages(newId, []);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleDeleteThread = (id: string) => {
    const remaining = threads.filter((t) => t.id !== id);
    saveThreads(remaining);
    try {
      localStorage.removeItem(`${STORAGE_KEY_MESSAGES_PREFIX}${id}`);
    } catch {}

    if (activeThreadId === id) {
      if (remaining.length > 0) {
        switchThread(remaining[0].id);
      } else {
        setActiveThreadId("");
        setMessages([]);
      }
    }
  };

  const handleProcessFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      setAttachedFiles((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: file.name || "Pasted image",
          mimeType: file.type || "image/png",
          data: base64Data,
          preview: result,
        },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const onAttachFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected || selected.length === 0) return;

    Array.from(selected).forEach((file) => {
      handleProcessFile(file);
    });
    event.target.value = "";
  };

  const handleToolApproval = async (toolCallId: string, approved: boolean) => {
    const threadId = activeThreadId || (threads.length > 0 ? threads[0].id : "");
    const targetPart = messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool-runCommand" && p.toolCallId === toolCallId);

    if (!approved) {
      const updated = messages.map((m) => ({
        ...m,
        parts: m.parts.map((p) => {
          if (p.type === "tool-runCommand" && p.toolCallId === toolCallId) {
            return {
              ...p,
              state: "output-denied" as const,
              approved: false,
            };
          }
          return p;
        }),
      }));

      persistMessages(threadId, updated);

      const cancelMsg: MessageItem = {
        id: newMessageId(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "❌ **Action Cancelled**\n\nNo changes were applied to your restaurant records. System remains in current state.",
          },
        ],
      };
      persistMessages(threadId, [...updated, cancelMsg]);
      return;
    }

    // User approved: Execute real backend persistence!
    setExecutingToolId(toolCallId);

    try {
      const res = await fetch("/api/v1/ai/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          actionPayload: {
            command: targetPart?.command,
            title: targetPart?.actionTitle,
            toolName: targetPart?.proposalData?.toolName,
            items: targetPart?.proposalData?.items,
            bomLines: targetPart?.proposalData?.bomLines,
            ingredients: targetPart?.proposalData?.bomLines?.map((b) => ({
              name: b.ingredientName,
              unit: b.unit,
              quantity: b.quantity,
            })),
            deleteItems: targetPart?.proposalData?.deleteItems,
            parameters: targetPart?.proposalData?.parameters,
          },
        }),
      });

      const result = await res.json();

      // Check if backend returned an error or failure
      const isFailed = !res.ok || result.success === false;

      // Invalidate React Query caches if success
      if (!isFailed) {
        queryClient.invalidateQueries({ queryKey: ["menu"] });
        queryClient.invalidateQueries({ queryKey: ["inventory"] });
        queryClient.invalidateQueries({ queryKey: ["inventory", "ingredients"] });
        queryClient.invalidateQueries({ queryKey: ["inventory", "tracking"] });
        queryClient.invalidateQueries({ queryKey: ["inventory", "recipe"] });
        queryClient.invalidateQueries({ queryKey: ["users"] });
        queryClient.invalidateQueries({ queryKey: ["team"] });
        queryClient.invalidateQueries({ queryKey: ["tables"] });
      }

      const updated = messages.map((m) => ({
        ...m,
        parts: m.parts.map((p) => {
          if (p.type === "tool-runCommand" && p.toolCallId === toolCallId) {
            return {
              ...p,
              state: "output-available" as const,
              approved: !isFailed,
            };
          }
          return p;
        }),
      }));

      persistMessages(threadId, updated);

      if (isFailed) {
        const errorText = result.message || "Action execution failed. Please verify permissions and data requirements.";
        const isPermission = errorText.toLowerCase().includes("permission");
        const followUpError: MessageItem = {
          id: newMessageId(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: isPermission
                ? `⛔ **Permission Denied**\n\n${errorText}`
                : `⚠️ **Action Rejected by Database**\n\n${errorText}`,
            },
          ],
        };
        persistMessages(threadId, [...updated, followUpError]);
        return;
      }

      const itemsSummary = result.createdItems && result.createdItems.length > 0
        ? result.createdItems.map((name: string) => `• Dish: **${name}**`).join("\n")
        : "";

      const ingSummary = result.createdIngredients && result.createdIngredients.length > 0
        ? result.createdIngredients.map((name: string) => `• Stockroom Item: **${name}**`).join("\n")
        : "";

      const delSummary = result.deletedItems && result.deletedItems.length > 0
        ? result.deletedItems.map((name: string) => `• Purged from Menu: ~${name}~`).join("\n")
        : "";

      const sections = [
        result.message ? `✅ **Action Approved & Persisted to Database**\n\n${result.message}` : "✅ **Action Approved & Persisted to Database**",
        itemsSummary ? `**Registered Menu Items:**\n${itemsSummary}` : null,
        ingSummary ? `**Stockroom Inventory (Ingredients):**\n${ingSummary}` : null,
        delSummary ? `**Removed from Sales Catalog:**\n${delSummary}` : null,
        "You can view and audit changes anytime in [Menu Management](/menu), [Team Management](/team), or [Stockroom Inventory](/inventory).",
      ].filter(Boolean).join("\n\n");

      const followUp: MessageItem = {
        id: newMessageId(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: sections,
          },
        ],
      };
      persistMessages(threadId, [...updated, followUp]);
    } catch (err) {
      console.error("Action execution error:", err);
      const errorMsg: MessageItem = {
        id: newMessageId(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "⚠️ **Database Synchronization Error**: Could not complete write operation. Please check your network and session.",
          },
        ],
      };
      persistMessages(threadId, [...messages, errorMsg]);
    } finally {
      setExecutingToolId(null);
    }
  };

  const busy = status === "submitted" || status === "streaming";
  const canSend = (text.trim().length > 0 || attachedFiles.length > 0) && !busy;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSend) return;

    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      currentThreadId = `thread-${Date.now()}`;
      const newThread: ChatThread = {
        id: currentThreadId,
        title: text.trim().slice(0, 26) || "Photo Analysis",
        preview: text.trim() || "Uploaded attachment",
        time: "Just now",
        status: "active",
      };
      saveThreads([newThread, ...threads]);
      setActiveThreadId(currentThreadId);
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_THREAD, currentThreadId);
      } catch {}
    } else {
      const updatedThreads = threads.map((t) =>
        t.id === currentThreadId
          ? {
              ...t,
              title: t.title === "New Conversation" ? text.trim().slice(0, 26) || "Photo Analysis" : t.title,
              preview: text.trim() || "Uploaded attachment",
              time: "Just now",
            }
          : t
      );
      saveThreads(updatedThreads);
    }

    const userText = text.trim();
    const filesToSend = [...attachedFiles];
    setText("");
    setAttachedFiles([]);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now()}`;

    // Construct user parts
    const userParts: ChatMessagePart[] = [];
    filesToSend.forEach((f) => {
      userParts.push({ type: "image", imageData: f.preview });
    });
    if (userText) {
      userParts.push({ type: "text", text: userText });
    }

    const msgsWithUser: MessageItem[] = [
      ...messages,
      { id: userMsgId, role: "user", parts: userParts },
    ];
    persistMessages(currentThreadId, msgsWithUser);

    setStatus("streaming");

    // Add streaming thinking step
    const msgsWithThinking: MessageItem[] = [
      ...msgsWithUser,
      {
        id: assistantMsgId,
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: filesToSend.length > 0
              ? "Inspecting visual document: extracting dish names, ingredients, spice samples, and commercial inventory portions..."
              : `Analyzing: "${userText}" across restaurant floor tables, KDS queue, and ingredients inventory…`,
            state: "streaming",
          },
        ],
      },
    ];
    setMessages(msgsWithThinking);

    const firstImage = filesToSend[0];

    fetch("/api/v1/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          ...msgsWithUser.map((m, idx) => {
            const isLatestUserMsg = idx === msgsWithUser.length - 1 && m.role === "user";
            const imgPart = m.parts.find((p) => p.type === "image" && p.imageData);
            let imgPayload: { mimeType: string; data: string } | undefined = undefined;

            // Only attach image payload on the message where it was actively uploaded
            if (isLatestUserMsg && firstImage) {
              imgPayload = { mimeType: firstImage.mimeType, data: firstImage.data };
            } else if (isLatestUserMsg && imgPart && imgPart.imageData) {
              const mime = imgPart.imageData.match(/data:([^;]+);base64,/)?.[1] || "image/png";
              const b64 = imgPart.imageData.replace(/^data:[^;]+;base64,/, "");
              imgPayload = { mimeType: mime, data: b64 };
            }

            return {
              role: m.role,
              content: m.parts.find((p) => p.type === "text")?.text || "",
              image: imgPayload,
            };
          }),
        ],
        model,
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || `HTTP error ${res.status}`);
        }
        return data;
      })
      .then((data) => {
        const assistantParts: ChatMessagePart[] = [
          {
            type: "reasoning",
            text: data.reasoning || `Processed operational logic for "${userText || "Image"}"`,
            state: "output-available" as const,
          },
          {
            type: "text",
            text: data.text || "Processed successfully.",
          },
        ];

        // 1. Interactive Question Card (Pausing tool)
        if (data.questionCard) {
          assistantParts.push({
            type: "question-card",
            questionData: data.questionCard,
          });
        }

        // 2. Structured Approval Review Deck (Pausing tool)
        if (data.actionProposal) {
          assistantParts.push({
            type: "tool-runCommand",
            command: data.actionProposal.command || "executeProposedAction()",
            toolCallId: `tool-${Date.now()}`,
            state: "approval-requested",
            actionTitle: data.actionProposal.title,
            actionDescription: data.actionProposal.summary || data.actionProposal.description,
            proposalData: data.actionProposal,
          });
        }

        const finalMsgs: MessageItem[] = msgsWithUser.concat({
          id: assistantMsgId,
          role: "assistant",
          parts: assistantParts,
        });
        persistMessages(currentThreadId, finalMsgs);
      })
      .catch((err) => {
        console.error("AI chat error:", err);
        const errMsg = err?.message || "Failed to reach AI service";
        const fallbackMsgs: MessageItem[] = msgsWithUser.concat({
          id: assistantMsgId,
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: `Processing query for "${userText || "Image"}".`,
              state: "output-available" as const,
            },
            {
              type: "text",
              text: `⚠️ **AI Service Notice**: ${errMsg}. If you are running Docker, ensure backend has \`GEMINI_API_KEY\` passed in \`docker-compose.yml\` and restart with \`docker compose up -d backend\`.`,
            },
          ],
        });
        persistMessages(currentThreadId, fallbackMsgs);
      })
      .finally(() => {
        setStatus("ready");
      });
  };

  const filteredThreads = threads.filter(
    (t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.preview.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-background relative select-none">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={onAttachFiles}
        className="sr-only"
        tabIndex={-1}
      />

      {/* Mobile Drawer Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        data-slot="chat-page-sidebar"
        className={cn(
          "flex flex-col bg-sidebar/50 border-r border-border shrink-0 z-50 h-full",
          "fixed inset-y-0 left-0 w-72 md:static md:z-auto transition-transform duration-200 md:transition-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-3.5 bg-sidebar/40">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold tracking-tight text-foreground">
              Conversations
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCreateNewThread}
            className="h-7 px-2 text-xs gap-1 rounded-md"
          >
            <Plus className="h-3 w-3" />
            New
          </Button>
        </div>

        <div className="p-2 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search chats…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-2 text-xs rounded-md border border-border bg-background/50 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-1">
          {filteredThreads.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No conversations yet.
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const isSelected = thread.id === activeThreadId;
              return (
                <div
                  key={thread.id}
                  onClick={() => switchThread(thread.id)}
                  className={cn(
                    "group flex w-full flex-col gap-1 p-2.5 rounded-lg cursor-pointer transition-colors text-left",
                    isSelected
                      ? "bg-secondary text-foreground font-medium"
                      : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-foreground">
                      {thread.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {thread.time}
                    </span>
                  </div>
                  <p className="line-clamp-1 text-[11px] text-muted-foreground">
                    {thread.preview}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <Badge
                      variant={thread.status === "active" ? "default" : "secondary"}
                      className="text-[9px] px-1 py-0 h-3.5 font-normal"
                    >
                      {thread.status}
                    </Badge>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteThread(thread.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                      title="Delete thread"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Workspace - Full width message scroller with left alignment */}
      <main className="flex-1 flex flex-col min-w-0 bg-background h-full overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/80 px-4 sm:px-6 bg-background/50">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="outline"
              size="icon"
              onClick={toggleSidebar}
              className="h-8 w-8 rounded-lg shrink-0 text-muted-foreground hover:text-foreground md:hidden"
              title={sidebarOpen ? "Hide conversations" : "Show conversations"}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>

            <span className="font-semibold text-xs sm:text-sm text-foreground truncate">
              {threads.find((t) => t.id === activeThreadId)?.title || "Assistant Workspace"}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (activeThreadId) {
                persistMessages(activeThreadId, []);
              } else {
                setMessages([]);
              }
            }}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCwIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </header>

        {/* Message Stream or Empty State */}
        {messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-center max-w-xl mx-auto w-full select-none text-center animate-in fade-in-50 duration-300">
            <div className="relative mb-4 group cursor-pointer">
              <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl overflow-hidden border border-primary/30 bg-primary/5 p-1 shadow-sm transition-transform group-hover:scale-105">
                <img
                  src="/ai-mascot.png"
                  alt="OrderRestro Chef Robot"
                  className="w-full h-full object-contain pixelated"
                />
              </div>
              <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-background" title="Online" />
            </div>

            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              How can I help you today?
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 mb-6 max-w-md">
              Ask about live floor tables, KDS orders, recipe ingredients, or paste an invoice image directly with <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border">Ctrl+V</kbd>.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
              {[
                {
                  icon: Flame,
                  title: "Active KDS queue",
                  desc: "Show pending and delayed tickets",
                  prompt: "Show all pending tickets currently in the kitchen queue.",
                },
                {
                  icon: Layers,
                  title: "Table 2 occupancy",
                  desc: "Check bill subtotal and order state",
                  prompt: "Table 2: 2 Virgin Mojitos, 1 Margherita Pizza. Check occupancy and push order to kitchen display.",
                },
                {
                  icon: TrendingUp,
                  title: "Shift 1 sales summary",
                  desc: "Revenue and top selling items",
                  prompt: "Generate lunch rush sales audit and revenue summary for Shift 1.",
                },
                {
                  icon: Package,
                  title: "Low stock audit",
                  desc: "Review ingredients below threshold",
                  prompt: "Which ingredients are below the minimum threshold right now?",
                },
              ].map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      setText(item.prompt);
                    }}
                    className="flex items-start gap-3 p-3 rounded-xl border border-border/70 bg-card hover:bg-muted/40 hover:border-primary/40 transition-all text-left shadow-2xs group active:scale-[0.99]"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors mt-0.5">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-foreground block group-hover:text-primary transition-colors">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground block truncate mt-0.5">
                        {item.desc}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <MessageScrollerProvider>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                {/* Changed: Align content cleanly to the left, full available width with max-w-4xl */}
                <MessageScrollerContent className="select-text px-4 sm:px-6 py-4 max-w-4xl w-full mx-auto space-y-5">
                  {messages.map((message) => {
                    if (message.role === "user") {
                      return (
                        <MessageScrollerItem
                          key={message.id}
                          messageId={message.id}
                          scrollAnchor
                          className="flex justify-end items-end w-full"
                        >
                          <div className="flex flex-col items-end gap-2 max-w-[85%] sm:max-w-md ml-auto">
                            {message.parts.map((p, i) => {
                              if (p.type === "image" && p.imageData) {
                                return (
                                  <div
                                    key={i}
                                    className="overflow-hidden rounded-xl border border-primary/30 bg-card shadow-sm max-w-[240px] sm:max-w-[280px] ml-auto"
                                  >
                                    <img
                                      src={p.imageData}
                                      alt="Uploaded file"
                                      className="w-full h-auto max-h-60 object-contain bg-black/5"
                                    />
                                  </div>
                                );
                              }
                              return null;
                            })}

                            {message.parts.some((p) => p.type === "text") && (
                              <Bubble align="end" className="ml-auto w-auto max-w-full">
                                <BubbleContent variant="default" className="text-left whitespace-normal break-words inline-block">
                                  {message.parts
                                    .filter((p) => p.type === "text")
                                    .map((p, i) => (
                                      <p key={i}>{p.text}</p>
                                    ))}
                                </BubbleContent>
                              </Bubble>
                            )}
                          </div>
                        </MessageScrollerItem>
                      );
                    }

                    return (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        className="flex flex-col gap-2 w-full max-w-3xl"
                      >
                        {/* Assistant Header matching prcrm */}
                        <div className="flex items-center gap-2 mb-1">
                          <img
                            src="/ai-mascot.png"
                            alt="OrderRestro Assistant"
                            className="h-8 w-8 object-contain pixelated shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-foreground leading-tight">
                              OrderRestro Assistant
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              Kitchen & Operations Copilot
                            </span>
                          </div>
                        </div>

                        {message.parts.map((part, index) => {
                          if (part.type === "text") {
                            return (
                              <MarkdownRenderer
                                key={index}
                                content={part.text || ""}
                                className="text-xs sm:text-sm"
                              />
                            );
                          }

                          if (part.type === "reasoning") {
                            return (
                              <ThinkingStepsDisplay
                                key={index}
                                text={part.text || ""}
                                running={part.state === "streaming"}
                              />
                            );
                          }

                          if (part.type === "question-card" && part.questionData) {
                            return (
                              <QuestionCard
                                key={index}
                                data={part.questionData}
                                onSelectOption={(option) => {
                                  // Send the selected choice directly to the chat
                                  setText(`Selected: ${option.label}`);
                                  setTimeout(() => {
                                    formRef.current?.requestSubmit();
                                  }, 50);
                                }}
                                onSubmitCustomAnswer={(customAnswer) => {
                                  // Send the custom typed instruction directly
                                  setText(customAnswer);
                                  setTimeout(() => {
                                    formRef.current?.requestSubmit();
                                  }, 50);
                                }}
                              />
                            );
                          }

                          if (part.type === "tool-runCommand") {
                            const isDenied = part.state === "output-denied" || part.approved === false;
                            const isApproved = part.state === "output-available" || part.approved === true;

                            // Render Review Deck for proposed tool calls
                            if (part.proposalData) {
                              return (
                                <ApprovalReviewDeck
                                  key={part.toolCallId || index}
                                  proposal={part.proposalData}
                                  isExecuting={executingToolId === part.toolCallId}
                                  isCompleted={isApproved}
                                  isRejected={isDenied}
                                  onApprove={() => handleToolApproval(part.toolCallId!, true)}
                                  onReject={() => handleToolApproval(part.toolCallId!, false)}
                                />
                              );
                            }

                            // Approval Action Card Fallback
                            if (part.state === "approval-requested") {
                              return (
                                <Item key={part.toolCallId} variant="outline" size="sm" className="my-1.5 border-primary/40 bg-card">
                                  <ItemMedia variant="icon">
                                    <UtensilsCrossed className="text-primary" />
                                  </ItemMedia>
                                  <ItemContent>
                                    <ItemTitle className="font-semibold text-xs sm:text-sm">
                                      {part.actionTitle || `Run ${part.command}?`}
                                    </ItemTitle>
                                    <ItemDescription className="text-xs">
                                      {part.actionDescription || "Pushes actions to OrderRestro kitchen & menu records."}
                                    </ItemDescription>
                                  </ItemContent>
                                  <ItemActions>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={executingToolId === part.toolCallId}
                                      onClick={() => handleToolApproval(part.toolCallId!, false)}
                                    >
                                      Deny
                                    </Button>
                                    <Button
                                      size="sm"
                                      disabled={executingToolId === part.toolCallId}
                                      onClick={() => handleToolApproval(part.toolCallId!, true)}
                                      className="gap-1.5"
                                    >
                                      {executingToolId === part.toolCallId && (
                                        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
                                      )}
                                      <span>{executingToolId === part.toolCallId ? "Saving…" : "Approve"}</span>
                                    </Button>
                                  </ItemActions>
                                </Item>
                              );
                            }

                            const denied = part.state === "output-denied" || part.approved === false;

                            return (
                              <Item
                                key={part.toolCallId}
                                variant="outline"
                                size="sm"
                                className={cn(
                                  "my-2 bg-card border-border/80 transition-all shadow-2xs",
                                  denied ? "border-destructive/40 bg-destructive/5" : "border-emerald-500/40 bg-emerald-500/5"
                                )}
                              >
                                <ItemMedia variant="icon" className={denied ? "text-destructive" : "text-emerald-500"}>
                                  {denied ? <XIcon className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                </ItemMedia>
                                <ItemContent>
                                  <ItemTitle className="text-xs sm:text-sm font-semibold flex items-center gap-2">
                                    <span>{part.actionTitle || "Proposed Action"}</span>
                                    <Badge
                                      variant={denied ? "destructive" : "default"}
                                      className={cn(
                                        "text-[10px] px-1.5 py-0 h-4 font-normal",
                                        !denied && "bg-emerald-600 hover:bg-emerald-600 text-white"
                                      )}
                                    >
                                      {denied ? "Denied" : "Approved & Recorded"}
                                    </Badge>
                                  </ItemTitle>
                                  <ItemDescription className="text-xs font-mono opacity-80">
                                    {part.command}
                                  </ItemDescription>
                                </ItemContent>
                              </Item>
                            );
                          }

                          return null;
                        })}
                      </MessageScrollerItem>
                    );
                  })}
                  <div ref={messagesEndRef} aria-hidden="true" className="h-0 w-0" />
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}

        {/* 
          Composer with Mobile Clearance & Compact Icon-only Buttons on Small Screens
        */}
        <div className="p-2 sm:p-5 pt-0 max-w-4xl w-full mx-auto shrink-0 pb-3 sm:pb-5">
          <form ref={formRef} onSubmit={onSubmit} className="w-full">
            <InputGroup className="bg-background border-border/80 focus-within:ring-1 focus-within:ring-primary shadow-xs">
              {/* Attachment chip bar */}
              {attachedFiles.length > 0 && (
                <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 p-2 border-b border-border/50">
                  {attachedFiles.map((file) => (
                    <Attachment key={file.id} size="sm">
                      <AttachmentMedia>
                        <FileTextIcon />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{file.name}</AttachmentTitle>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setAttachedFiles((current) =>
                              current.filter((item) => item.id !== file.id)
                            )
                          }
                        >
                          <XIcon />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                  ))}
                </InputGroupAddon>
              )}

              <InputGroupTextarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.type.indexOf("image") !== -1) {
                      const file = item.getAsFile();
                      if (file) {
                        e.preventDefault();
                        handleProcessFile(file);
                      }
                    }
                  }
                }}
                placeholder="Ask the agent or paste an invoice/recipe image (Ctrl+V)..."
                aria-label="Message"
                className="min-h-12 sm:min-h-14 text-xs sm:text-sm px-3 pt-2.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
              />

              <InputGroupAddon align="block-end" className="p-2 pt-0 flex items-center justify-between">
                {/* Left: Attach button */}
                <InputGroupButton
                  size="icon-sm"
                  variant="outline"
                  className="rounded-full shrink-0 h-7 w-7"
                  aria-label="Attach files"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload receipt or recipe image"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                </InputGroupButton>

                {/* Right controls: Icons-only on mobile (<sm), full labels on desktop (sm+) */}
                <div className="flex items-center gap-1.5 ml-auto">
                  {/* Model Selector Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <InputGroupButton
                          size="sm"
                          variant="outline"
                          aria-label={`Model: ${currentModel.name}`}
                          className="h-7 px-2 text-xs shrink-0 gap-1 rounded-lg"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span className="hidden sm:inline">{currentModel.name}</span>
                          <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
                        </InputGroupButton>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-48 text-xs">
                      <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
                        {allModels.map((item) => (
                          <DropdownMenuRadioItem
                            key={item.id}
                            value={item.id}
                            closeOnClick
                            className="text-xs"
                          >
                            {item.name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Reasoning Effort Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <InputGroupButton
                          size="sm"
                          variant="outline"
                          aria-label={`Effort: ${currentEffort.name}`}
                          className="h-7 px-2 text-xs shrink-0 gap-1 rounded-lg"
                        >
                          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="hidden sm:inline">
                            <span className="text-muted-foreground mr-1">Effort</span>
                            {currentEffort.name}
                          </span>
                          <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
                        </InputGroupButton>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-36 text-xs">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Effort</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={effort}
                          onValueChange={setEffort}
                        >
                          {efforts.map((item) => (
                            <DropdownMenuRadioItem
                              key={item.id}
                              value={item.id}
                              closeOnClick
                              className="text-xs"
                            >
                              {item.name}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Submit Button */}
                  <InputGroupButton
                    type="submit"
                    size="icon-sm"
                    variant="default"
                    className="rounded-full shrink-0 h-7 w-7 bg-primary text-primary-foreground disabled:opacity-40"
                    disabled={!canSend}
                    aria-label="Send"
                  >
                    <ArrowUpIcon className="h-3.5 w-3.5" />
                  </InputGroupButton>
                </div>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>
      </main>
    </div>
  );
}

function ReasoningRow({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = React.useState<boolean>(true);

  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? "running" : undefined}>
          <TraceIcon>
            {running ? (
              <LoaderCircleIcon className="animate-spin text-primary" />
            ) : (
              <CircleCheckIcon className="text-emerald-500" />
            )}
          </TraceIcon>
          <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap pl-6 py-1 text-xs text-muted-foreground">
        {text}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

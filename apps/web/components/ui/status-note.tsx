"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// Inline result/error message. The app has no toast popups (the Toaster was
// removed in 1.3.0 and is not mounted), so `toast.*` calls show nothing; a
// flow that must tell the user "it worked" or "it failed" renders this next
// to the thing they just did instead.
export type NoteKind = "success" | "error" | "info" | "warning";
export interface Note {
  kind: NoteKind;
  text: string;
  action?: { label: string; onClick: () => void };
}

export function useStatusNote(autoDismissMs = 10_000) {
  const [note, setNote] = useState<Note | null>(null);
  const show = useCallback((kind: NoteKind, text: string, action?: Note["action"]) => {
    setNote({ kind, text, action });
  }, []);
  const clear = useCallback(() => setNote(null), []);
  useEffect(() => {
    // Errors and actionable notes stay until dismissed or replaced.
    if (!note || note.kind === "error" || note.action) return;
    const t = setTimeout(() => setNote(null), autoDismissMs);
    return () => clearTimeout(t);
  }, [note, autoDismissMs]);
  return { note, show, clear };
}

const STYLE: Record<NoteKind, { box: string; Icon: typeof Info }> = {
  success: { box: "bg-success/10 text-success", Icon: CheckCircle2 },
  error: { box: "bg-destructive/10 text-destructive", Icon: XCircle },
  warning: { box: "bg-warning/10 text-warning", Icon: AlertTriangle },
  info: { box: "bg-secondary text-foreground", Icon: Info },
};

export function StatusNote({
  note,
  onClear,
  className,
}: {
  note: Note | null;
  onClear: () => void;
  className?: string;
}) {
  if (!note) return null;
  const { box, Icon } = STYLE[note.kind];
  return (
    <div
      role={note.kind === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", box, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{note.text}</span>
      {note.action && (
        <button
          type="button"
          className="shrink-0 font-medium underline underline-offset-2"
          onClick={() => {
            note.action?.onClick();
            onClear();
          }}
        >
          {note.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss message" className="shrink-0 opacity-70 hover:opacity-100" onClick={onClear}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Drop-in for the `toast.success/error/...` call shape, rendering inline via
// <StatusNote note={note} onClear={clear} /> instead of a popup.
export function useNoteToast() {
  const { note, show, clear } = useStatusNote();
  const toast = useMemo(
    () => ({
      success: (text: string) => show("success", text),
      error: (text: string) => show("error", text),
      warning: (text: string) => show("warning", text),
      info: (text: string, opts?: { action?: Note["action"] }) => show("info", text, opts?.action),
    }),
    [show],
  );
  return { note, clear, toast };
}

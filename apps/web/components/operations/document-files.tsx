"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

export interface DocFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function DocumentFiles({ branchId, docId, files }: { branchId: string | null; docId: string; files: DocFile[] }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ops"] });
  const base = `/operations/documents/${docId}/files`;
  const upload = useMutation({
    mutationFn: (f: File) => api.upload(`${base}?branchId=${branchId}`, f),
    onSuccess: () => {
      refresh();
      toast.success("File attached");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Upload failed"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}?branchId=${branchId}`),
    onSuccess: refresh,
  });

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Attachments</p>
        <input
          ref={ref}
          type="file"
          className="sr-only"
          aria-label="Attach a file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (f.size > 5 * 1024 * 1024) toast.error("Files can be at most 5 MB");
              else upload.mutate(f);
            }
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => ref.current?.click()}>
          <Paperclip className="mr-1.5 h-3.5 w-3.5" /> {upload.isPending ? "Uploading…" : "Attach file"}
        </Button>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">PDF, image, text, Word or Excel · up to 5 MB each, 10 per document.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              <a
                className="truncate text-primary hover:underline"
                href={`/api/v1${base}/${f.id}?branchId=${branchId}`}
                download={f.fileName}
              >
                {f.fileName}
              </a>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {kb(f.size)}
                <button type="button" aria-label={`Remove ${f.fileName}`} onClick={() => remove.mutate(f.id)} className="hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

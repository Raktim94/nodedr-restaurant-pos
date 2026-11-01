"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ImportKind = "menu" | "ingredients";

export interface ImportRow {
  line: number;
  name: string;
  detail: string;
  action: "create" | "update" | "unchanged" | "skipped";
  changes: string[];
}
export interface ImportIssue {
  line: number;
  name: string;
  messages: string[];
}
export interface ImportResult {
  kind: ImportKind;
  applied: boolean;
  fileNote: string | null;
  delimiter: string;
  summary: { total: number; create: number; update: number; unchanged: number; skipped: number; errors: number };
  newCategories: string[];
  newStations: string[];
  unknownColumns: string[];
  warnings: { line: number; message: string }[];
  errors: ImportIssue[];
  rows: ImportRow[];
}

export const templateUrl = (kind: ImportKind, example: boolean) =>
  `/api/v1/imports/templates/${kind}${example ? "?example=1" : ""}`;

export function useCsvImport(kind: ImportKind, branchId: string | null) {
  const qc = useQueryClient();
  const run = (step: "preview" | "commit") =>
    (v: { file: File; updateExisting: boolean; skipInvalid?: boolean }) => {
      const form = new FormData();
      form.append("file", v.file);
      const q = new URLSearchParams({ branchId: branchId ?? "", updateExisting: String(v.updateExisting) });
      if (v.skipInvalid) q.set("skipInvalid", "true");
      return api.postForm<ImportResult>(`/imports/${kind}/${step}?${q}`, form);
    };
  return {
    preview: useMutation({ mutationFn: run("preview") }),
    commit: useMutation({
      mutationFn: run("commit"),
      onSuccess: () => {
        // Everything that lists or counts these records.
        for (const key of ["menu", "inventory", "dashboard", "pos"]) qc.invalidateQueries({ queryKey: [key] });
        qc.invalidateQueries({ queryKey: ["categories"] });
      },
    }),
  };
}

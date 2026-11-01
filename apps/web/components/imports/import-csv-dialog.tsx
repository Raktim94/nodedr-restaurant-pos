"use client";

import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { ApiError } from "@/lib/api";
import {
  templateUrl,
  useCsvImport,
  type ImportKind,
  type ImportResult,
} from "@/hooks/use-csv-import";

const COPY: Record<ImportKind, { title: string; noun: string; key: string; required: string }> = {
  menu: {
    title: "Import menu items from CSV",
    noun: "menu items",
    key: "Items are matched by SKU, or by name and category, so importing the same file again updates them instead of adding copies.",
    required: "name, category, price",
  },
  ingredients: {
    title: "Import ingredients from CSV",
    noun: "ingredients",
    key: "Ingredients are matched by name. Opening stock is only applied to an ingredient that has no stock history, so a re-import never changes real counts.",
    required: "name, unit",
  },
};

const ACTION_LABEL = { create: "New", update: "Update", unchanged: "No change", skipped: "Skipped" } as const;

/** The rejected rows as a CSV the person can fix and re-upload. */
function errorReportCsv(result: ImportResult) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["line,name,problem", ...result.errors.map((e) => [e.line, esc(e.name), esc(e.messages.join("; "))].join(","))].join("\r\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportCsvDialog({ kind, branchId }: { kind: ImportKind; branchId: string | null }) {
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { preview: previewM, commit } = useCsvImport(kind, branchId);
  const { note, clear, toast } = useNoteToast();

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDone(null);
    setSkipInvalid(false);
    clear();
    if (input.current) input.current.value = "";
  };
  // Every way of closing goes through here so the next open starts fresh.
  const close = () => {
    setOpen(false);
    reset();
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong");

  const runPreview = (f: File, update: boolean) => {
    clear();
    setPreview(null);
    previewM.mutate({ file: f, updateExisting: update }, { onSuccess: setPreview, onError: fail });
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setDone(null);
    runPreview(f, updateExisting);
  };

  const s = preview?.summary;
  const importable = s ? s.create + s.update : 0;
  const hasErrors = (s?.errors ?? 0) > 0;
  // Nothing to write, or errors the person has not chosen to skip.
  const blocked = !s || importable === 0 || (hasErrors && !skipInvalid);

  const submit = () => {
    if (!file) return;
    clear();
    commit.mutate({ file, updateExisting, skipInvalid }, { onSuccess: setDone, onError: fail });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Upload className="h-3.5 w-3.5" />
        Import CSV
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-sm font-medium text-foreground">Import finished.</p>
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <li className="rounded-lg bg-secondary p-3"><b className="block text-lg tabular-nums">{done.summary.create}</b>added</li>
              <li className="rounded-lg bg-secondary p-3"><b className="block text-lg tabular-nums">{done.summary.update}</b>updated</li>
              <li className="rounded-lg bg-secondary p-3"><b className="block text-lg tabular-nums">{done.summary.unchanged}</b>unchanged</li>
              <li className="rounded-lg bg-secondary p-3"><b className="block text-lg tabular-nums">{done.summary.errors}</b>skipped (errors)</li>
            </ul>
            {done.summary.errors > 0 && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => download("import-errors.csv", errorReportCsv(done))}>
                <Download className="h-3.5 w-3.5" /> Download the rows that were skipped
              </Button>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Import another file</Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li>Download the example file and open it in Excel, Google Sheets or LibreOffice.</li>
              <li>Replace the sample rows with yours. Required columns: <span className="font-medium text-foreground">{copy.required}</span>.</li>
              <li>Save as <span className="font-medium text-foreground">CSV</span> and choose it below. You will see exactly what will change before anything is saved.</li>
            </ol>
            <p className="text-xs text-muted-foreground">{copy.key}</p>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" render={<a href={templateUrl(kind, true)} download />}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Download example file
              </Button>
              <Button variant="ghost" size="sm" render={<a href={templateUrl(kind, false)} download />}>
                Blank template
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={`csv-${kind}`} className="text-sm font-medium text-foreground">CSV file</label>
              <input
                id={`csv-${kind}`}
                ref={input}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => {
                    setUpdateExisting(e.target.checked);
                    if (file) runPreview(file, e.target.checked);
                  }}
                />
                Update {copy.noun} that already exist
              </label>
            </div>

            <StatusNote note={note} onClear={clear} />
            {previewM.isPending && <p role="status" className="text-sm text-muted-foreground">Checking the file…</p>}

            {preview && s && (
              <section aria-label="What will happen" className="flex flex-col gap-3">
                {preview.fileNote && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{preview.fileNote}</p>}
                <ul className="flex flex-wrap gap-2 text-sm">
                  <li><Badge variant="secondary">{s.create} new</Badge></li>
                  <li><Badge variant="secondary">{s.update} to update</Badge></li>
                  <li><Badge variant="secondary">{s.unchanged} unchanged</Badge></li>
                  {s.skipped > 0 && <li><Badge variant="secondary">{s.skipped} skipped</Badge></li>}
                  <li>
                    <Badge variant={s.errors ? "destructive" : "secondary"}>
                      {s.errors} {s.errors === 1 ? "row with a problem" : "rows with problems"}
                    </Badge>
                  </li>
                </ul>

                {(preview.newCategories.length > 0 || preview.newStations.length > 0) && (
                  <div className="rounded-lg bg-secondary/60 p-3 text-xs">
                    {preview.newCategories.length > 0 && (
                      <p><b>New categories will be created:</b> {preview.newCategories.join(", ")}</p>
                    )}
                    {preview.newStations.length > 0 && (
                      <p><b>New kitchen stations will be created:</b> {preview.newStations.join(", ")}</p>
                    )}
                    <p className="mt-1 text-muted-foreground">Spot a typo? Fix the file and choose it again before importing.</p>
                  </div>
                )}
                {preview.unknownColumns.length > 0 && (
                  <p className="text-xs text-muted-foreground">Ignored columns: {preview.unknownColumns.join(", ")}</p>
                )}
                {preview.warnings.length > 0 && (
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {preview.warnings.slice(0, 5).map((w) => (
                      <li key={w.line + w.message}>Line {w.line}: {w.message}</li>
                    ))}
                    {preview.warnings.length > 5 && <li>…and {preview.warnings.length - 5} more notes</li>}
                  </ul>
                )}

                {hasErrors && (
                  <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive">Fix these rows in your file (line numbers match the spreadsheet):</p>
                    <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto text-xs">
                      {preview.errors.slice(0, 50).map((e) => (
                        <li key={e.line}>
                          <b>Line {e.line}</b>{e.name ? ` · ${e.name}` : ""}: {e.messages.join(" · ")}
                        </li>
                      ))}
                      {preview.errors.length > 50 && <li>…and {preview.errors.length - 50} more. Download the full list.</li>}
                    </ul>
                    <Button variant="outline" size="sm" className="self-start" onClick={() => download("import-errors.csv", errorReportCsv(preview))}>
                      <Download className="h-3.5 w-3.5" /> Download problem list
                    </Button>
                    {importable > 0 && (
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
                        Import the {importable} good row{importable === 1 ? "" : "s"} anyway and skip the ones with problems
                      </label>
                    )}
                  </div>
                )}

                {preview.rows.length > 0 && (
                  <div className="max-h-48 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <caption className="sr-only">Rows that will be imported</caption>
                      <thead className="sticky top-0 bg-secondary text-left">
                        <tr><th className="px-2 py-1.5">Line</th><th>Name</th><th>{kind === "menu" ? "Category" : "Unit"}</th><th>What happens</th></tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r.line} className="border-t border-border align-top">
                            <td className="px-2 py-1 tabular-nums text-muted-foreground">{r.line}</td>
                            <td className="min-w-0 break-words py-1 pr-2">{r.name}</td>
                            <td className="py-1 pr-2">{r.detail}</td>
                            <td className="py-1 pr-2">
                              {ACTION_LABEL[r.action]}
                              {r.changes.length > 0 && <span className="text-muted-foreground"> · {r.changes.join(", ")}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {s.total > preview.rows.length + s.errors && (
                  <p className="text-xs text-muted-foreground">Showing the first {preview.rows.length} rows; all {s.total} will be processed.</p>
                )}
              </section>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button disabled={blocked || commit.isPending || previewM.isPending} onClick={submit}>
                {commit.isPending ? "Importing…" : importable > 0 ? `Import ${importable} ${copy.noun}` : "Import"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

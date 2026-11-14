"use client";

import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type QualityResult, useRecordQuality } from "@/hooks/use-manufacturing";
import { ApiError } from "@/lib/api";

export const QUALITY_LABEL: Record<QualityResult, string> = { PASS: "Pass", FAIL: "Fail", NEEDS_REVIEW: "Needs review" };

// Optional inspection of a posted batch. Saving never changes stock, cost or price; a change of result is kept in
// the audit trail by the server, so the earlier answer is not lost.
export function QualityDialog({ branchId, batch, onClose }: { branchId: string | null; batch: { id: string; entryNo: string; item: string | null; quality: { result: QualityResult; grade: string | null; notes: string | null } | null }; onClose: () => void }) {
  const save = useRecordQuality(branchId);
  const [result, setResult] = useState<QualityResult>(batch.quality?.result ?? "PASS");
  const [grade, setGrade] = useState(batch.quality?.grade ?? "");
  const [notes, setNotes] = useState(batch.quality?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (result === "FAIL" && !notes.trim()) return setError("Say what failed, so the next person can act on it.");
    setError(null);
    save.mutate({ id: batch.id, result, grade: grade.trim() || undefined, notes: notes.trim() || undefined }, {
      onSuccess: onClose,
      onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the inspection. Try again."),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quality inspection</DialogTitle>
          <DialogDescription>{batch.entryNo} · {batch.item ?? "batch"}. This does not change stock, cost or price.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {error && <div id="q-error" role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div className="flex flex-col gap-1.5"><Label htmlFor="q-result">Result</Label>
            <select id="q-result" className={`${selectClass} h-11`} value={result} onChange={(e) => setResult(e.target.value as QualityResult)}>
              {(Object.keys(QUALITY_LABEL) as QualityResult[]).map((r) => <option key={r} value={r}>{QUALITY_LABEL[r]}</option>)}
            </select></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="q-grade">Grade (optional)</Label><Input id="q-grade" className="h-11" maxLength={20} value={grade} onChange={(e) => setGrade(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="q-notes">Notes{result === "FAIL" ? " (required for a fail)" : " (optional)"}</Label><Textarea id="q-notes" maxLength={500} rows={3} required={result === "FAIL"} aria-invalid={!!error && result === "FAIL" && !notes.trim()} aria-describedby={error ? "q-error" : undefined} enterKeyHint="done" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="h-11" disabled={save.isPending} onClick={onClose}>Cancel</Button>
          <Button type="button" className="h-11" disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save inspection"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

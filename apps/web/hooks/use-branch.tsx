"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { branchViewState, type BranchViewState } from "@/lib/branch-state";

interface Branch {
  id: string;
  name: string;
}

interface BranchContextValue {
  branchId: string | null;
  branches: Branch[];
  isLoading: boolean;
  /** loading / error / empty (loaded, none assigned) / ready. */
  state: BranchViewState;
  error: unknown;
  retry: () => void;
  retrying: boolean;
  setBranchId: (id: string) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

const STORAGE_KEY = "nodedr_branch_id";

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { data: branches, isLoading, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["branches"],
    queryFn: () => api.get<Branch[]>("/branches"),
  });

  // Lazy initializer runs once on mount (a legitimate one-time read of an
  // external system), not on every render — the effective branchId below is
  // then a pure derivation from this plus the fetched branches, so no
  // effect/setState is needed to keep them in sync.
  const [manualBranchId, setManualBranchId] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
  );

  const branchId = useMemo(() => {
    if (!branches || branches.length === 0) return null;
    if (manualBranchId && branches.some((b) => b.id === manualBranchId)) return manualBranchId;
    return branches[0].id;
  }, [branches, manualBranchId]);

  const setBranchId = (id: string) => {
    setManualBranchId(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  };

  const state = branchViewState({ isPending, isError, count: branches?.length ?? 0 });
  const value = useMemo(
    () => ({
      branchId,
      branches: branches ?? [],
      isLoading: state === "loading",
      state,
      error,
      retry: () => void refetch(),
      retrying: isFetching,
      setBranchId,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch/setBranchId are stable enough; values below drive changes
    [branchId, branches, isLoading, state, error, isFetching],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within a BranchProvider");
  return ctx;
}

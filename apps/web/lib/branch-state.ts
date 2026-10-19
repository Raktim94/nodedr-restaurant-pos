// What the screens should say about the branch list. "No branch" is only true
// once the list has actually loaded and is empty; while it is still loading,
// or if the request failed (session, network, server), saying "no branch"
// would be wrong and would hide the real problem.
export type BranchViewState = "loading" | "error" | "empty" | "ready";

export function branchViewState(q: { isPending: boolean; isError: boolean; count: number }): BranchViewState {
  if (q.count > 0) return "ready";
  if (q.isError) return "error";
  if (q.isPending) return "loading";
  return "empty";
}

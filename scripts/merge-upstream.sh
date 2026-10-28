#!/usr/bin/env bash
# Merge the original project's master into a throwaway branch and run checks.
# Usage: scripts/merge-upstream.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean; commit or stash first." >&2; exit 1; }

git fetch upstream
base=$(git rev-parse --abbrev-ref HEAD)
branch="upstream-merge-$(date +%Y%m%d-%H%M%S)"

if git merge-base --is-ancestor upstream/master HEAD; then
  echo "Already up to date with upstream/master."; exit 0
fi

echo "Incoming commits:"; git log --oneline HEAD..upstream/master
git checkout -b "$branch"
if ! git merge --no-edit upstream/master; then
  echo "Merge conflicts. Resolve them on $branch, commit, then re-run the checks." >&2
  exit 1
fi

pnpm install --frozen-lockfile
(cd apps/backend && pnpm exec prisma generate)
pnpm typecheck
pnpm test
git diff --quiet || { echo "Checks modified files (eslint --fix); review them." >&2; exit 1; }

echo "OK. Review '$branch', then: git checkout $base && git merge $branch"

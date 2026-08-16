'use strict';

// Copies a directory tree, following symlinks/junctions into real file
// copies (equivalent to `cp -r --dereference`). Used by
// stage-server-assets.ps1 instead of:
//   - Copy-Item -Recurse: mishandles NTFS junctions/symlinks outright
//     (Access Denied on a runaway path).
//   - robocopy: correctly dereferences the top-level source argument, but
//     reliably fails with ERROR 3 "path not found" on every entry under a
//     node_modules\.pnpm\node_modules\* directory specifically — that
//     directory is itself full of symlinks one level further indirected
//     (pnpm's own cross-package resolution links), which robocopy seems
//     unable to walk regardless of path length or long-path settings.
//   - fs.cpSync({dereference:true}): handles pnpm's node_modules fine,
//     but crashed (exit code -1073740791 / STATUS_STACK_BUFFER_OVERRUN)
//     copying apps/web/.next/standalone — its recursive implementation
//     hit a native stack limit on a deep/complex tree.
//
// This walks the tree iteratively (an explicit array as a work-stack,
// not recursive function calls), so there is no call-stack depth to
// overflow regardless of how deep or symlink-heavy the source is. Cycle
// detection tracks each branch's own ancestor chain (real, resolved
// paths from src down to the current position) rather than a single
// global visited set — a global set would incorrectly skip copying a
// real directory into a SECOND destination location that legitimately
// needs its own copy (e.g. two different packages' node_modules both
// symlinking the same shared dependency) after visiting it once via a
// different destination path; per-branch ancestry only blocks a TRUE
// cycle, where a directory's own descendant loops back to one of its
// ancestors.

const fs = require('fs');
const path = require('path');

const [, , src, dst] = process.argv;
if (!src || !dst) {
  console.error('Usage: node dereference-copy.js <src> <dst>');
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });

const rootReal = fs.realpathSync(src);
const stack = [[src, dst, new Set([rootReal])]];

while (stack.length > 0) {
  const [currentSrc, currentDst, ancestors] = stack.pop();
  let entries;
  try {
    entries = fs.readdirSync(currentSrc);
  } catch (err) {
    console.error(`Skipping unreadable directory ${currentSrc}: ${err.message}`);
    continue;
  }

  for (const name of entries) {
    const entrySrc = path.join(currentSrc, name);
    const entryDst = path.join(currentDst, name);

    let st;
    try {
      st = fs.statSync(entrySrc); // follows symlinks/junctions
    } catch {
      continue; // broken symlink target — nothing to copy
    }

    if (st.isDirectory()) {
      let realEntrySrc;
      try {
        realEntrySrc = fs.realpathSync(entrySrc);
      } catch {
        continue;
      }
      if (ancestors.has(realEntrySrc)) continue; // true cycle
      fs.mkdirSync(entryDst, { recursive: true });
      stack.push([entrySrc, entryDst, new Set([...ancestors, realEntrySrc])]);
    } else if (st.isFile()) {
      fs.copyFileSync(entrySrc, entryDst);
    }
    // Anything else (sockets, devices, etc.) is skipped — none
    // legitimately appear in a Node dependency tree or a Next.js build
    // output.
  }
}

'use strict';

// Last staging step for the embedded server payload (run by
// stage-server-assets.ps1 on the fully staged <StageDir>\server tree).
//
// 1. Prune files nothing reads at runtime. The 1.0.13.0 package unpacked to
//    1.24 GB in 50,800 files; about 430 MB and 20,000 files of that were
//    source maps, TypeScript declarations, READMEs, Next's 105 MB SWC
//    compiler (build-time only; Next's own standalone tracer excludes it,
//    our "copy next's siblings" workaround brought it back), Prisma's engine
//    download cache, npm/corepack inside the portable Node, Postgres message
//    translations and .lib import libraries. Every one of those files was
//    downloaded, unpacked by the installer, copied again by the launcher on
//    first start, and scanned by antivirus on each step.
//
// 2. Write runtime-manifest.tsv (path, size, sha1). The launcher compares it
//    with the manifest of the copy it already has, so an update copies only
//    the files that changed instead of the whole runtime.
//
// 3. Verify the result (fails the build, never ships a payload that cannot start): the files the web app and
//    backend need at start-up are present, and no file path is deep enough to break on a PC with a long Windows
//    user name. The runtime copy lives under %LOCALAPPDATA%\OrderRestro\server\server-runtime (about 56 characters
//    plus the user name), and Windows programs (node.exe included) fail to open paths past 260 characters unless
//    the PC has long paths switched on, which most do not. Next's standalone output used to leave a second,
//    complete copy of `next` under web/node_modules/.pnpm/next@<version>_<hash>/ (1,297 files, paths up to 191
//    characters) that nothing loads, since apps/web/node_modules/next is the real one.
//
// Usage: node finalize-server-payload.js <serverDir>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
  console.error('Usage: node finalize-server-payload.js <serverDir>');
  process.exit(1);
}

const MANIFEST = 'runtime-manifest.tsv';
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// Longest relative path (from the server dir) allowed in the payload. The runtime base path is ~56 chars + the
// Windows user name, so 170 leaves room for user names up to ~30 characters before reaching 260.
const MAX_REL_PATH = 170;

// Next's standalone tracer leaves a full second copy of `next` in web/node_modules/.pnpm/next@... . It is only safe
// to drop when the real one the server resolves (apps/web/node_modules/next) is there.
const realNext = path.join(root, 'web', 'apps', 'web', 'node_modules', 'next', 'package.json');
const dropDuplicateNext = fs.existsSync(realNext);

// Directories removed wholesale (matched against the path relative to root).
const dropDir = (r, name) =>
  (dropDuplicateNext && /^web\/node_modules\/\.pnpm\/next@[^/]+$/.test(r)) ||
  /(^|\/)node_modules\/@next\/swc-[^/]+$/.test(r) ||
  /(^|\/)node_modules\/\.cache$/.test(r) ||
  /(^|\/)node_modules\/typescript$/.test(r) ||
  r === 'node/node_modules' ||
  r === 'postgres/share/locale' ||
  r === 'postgres/include' ||
  r === 'postgres/doc' ||
  name === '__tests__' ||
  name === '.github';

const dropFile = (r, name) => {
  const l = name.toLowerCase();
  if (l.endsWith('.map')) return true;
  if (/\.d\.[cm]?ts$/.test(l)) return true;
  if ((l.endsWith('.md') || l.endsWith('.markdown')) && !l.startsWith('license') && !l.startsWith('licence') && !l.startsWith('notice')) return true;
  if (r.startsWith('postgres/lib/') && l.endsWith('.lib')) return true;
  if (r.startsWith('node/') && !r.includes('/', 'node/'.length) && /^(npm|npx|corepack)(\.cmd|\.ps1)?$/.test(l)) return true;
  // Prisma client ships wasm query engines for every database for edge/driver-adapter runtimes; the Node runtime
  // here uses the native library engine, and only ever talks to PostgreSQL.
  if (/(^|\/)@prisma\/client\/runtime\//.test(r) && /(cockroachdb|mysql|sqlite|sqlserver)/.test(l)) return true;
  return false;
};

let removedFiles = 0;
let removedBytes = 0;
const sizeOf = (p) => {
  let total = 0;
  let count = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    const st = fs.lstatSync(cur);
    if (st.isDirectory()) for (const n of fs.readdirSync(cur)) stack.push(path.join(cur, n));
    else { total += st.size; count++; }
  }
  return [total, count];
};

const files = [];
const stack = [root];
while (stack.length) {
  const dir = stack.pop();
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel(full);
    const st = fs.lstatSync(full);
    if (st.isDirectory()) {
      if (dropDir(r, name)) {
        const [b, c] = sizeOf(full);
        removedBytes += b;
        removedFiles += c;
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        stack.push(full);
      }
    } else if (st.isFile()) {
      if (r === MANIFEST) continue;
      if (dropFile(r, name)) {
        removedBytes += st.size;
        removedFiles++;
        fs.rmSync(full, { force: true });
      } else {
        files.push([r, full, st.size]);
      }
    }
  }
}

files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const lines = files.map(([r, full, size]) => {
  const hash = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
  return `${r}\t${size}\t${hash}`;
});
fs.writeFileSync(path.join(root, MANIFEST), lines.join('\n') + '\n');

const keptBytes = files.reduce((s, f) => s + f[2], 0);
console.log(
  `Pruned ${removedFiles} files (${(removedBytes / 1048576).toFixed(0)} MB); ` +
    `payload is now ${files.length} files (${(keptBytes / 1048576).toFixed(0)} MB); wrote ${MANIFEST}`,
);

// --- Verify -----------------------------------------------------------------
const problems = [];
for (const required of [
  'node/node.exe',
  'postgres/bin/pg_ctl.exe',
  'backend/dist/src/main.js',
  'backend/node_modules/prisma/build/index.js',
  'web/apps/web/server.js',
  'web/apps/web/.next/BUILD_ID',
  'web/apps/web/.next/required-server-files.json',
  'web/apps/web/.next/routes-manifest.json',
  'web/apps/web/node_modules/next/package.json',
]) {
  // node.exe / pg_ctl.exe only exist once the Windows runtimes are staged; skip them for a Linux dry run.
  if (/\.exe$/.test(required) && !fs.existsSync(path.join(root, required.split('/')[0]))) continue;
  if (!fs.existsSync(path.join(root, required))) problems.push(`missing required file: ${required}`);
}
if (!files.some(([r]) => r.startsWith('web/apps/web/.next/static/chunks/'))) {
  problems.push('web/apps/web/.next/static/chunks has no files (the browser could not load any JavaScript)');
}
const longest = files.reduce((m, f) => (f[0].length > m[0].length ? f : m), ['', '', 0]);
console.log(`Longest path: ${longest[0].length} chars (${longest[0]}); limit ${MAX_REL_PATH}`);
for (const [r] of files) {
  if (r.length > MAX_REL_PATH) problems.push(`path too long (${r.length} > ${MAX_REL_PATH}): ${r}`);
}
if (problems.length) {
  console.error('Payload verification FAILED:\n  ' + problems.slice(0, 20).join('\n  '));
  process.exit(1);
}

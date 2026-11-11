// Generates mobile/www/pos/lib/costing.js from packages/types/src/costing.ts so the phone
// (offline) and the server run the exact same costing code. `--check` exits 1 if the committed
// file is stale. Run: node scripts/gen-mobile-costing.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/types/package.json'));
const ts = require('typescript');
const src = readFileSync(join(root, 'packages/types/src/costing.ts'), 'utf8');
const out = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020, removeComments: false },
}).outputText;
const banner =
  '// GENERATED from packages/types/src/costing.ts by scripts/gen-mobile-costing.mjs - do not edit by hand.\n' +
  '// The phone runs the same recipe-costing code as the server, so figures match offline.\n';
const text = banner + out;
const dest = join(root, 'mobile/www/pos/lib/costing.js');
if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(dest, 'utf8'); } catch { /* missing */ }
  if (cur !== text) { console.error('mobile/www/pos/lib/costing.js is stale - run node scripts/gen-mobile-costing.mjs'); process.exit(1); }
  console.log('costing.js is up to date');
} else {
  writeFileSync(dest, text);
  console.log('wrote', dest);
}

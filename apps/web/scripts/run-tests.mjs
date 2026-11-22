// Discover *.test.ts on any shell. POSIX shells expand globs before Node sees
// them; PowerShell and cmd.exe do not, which made `pnpm test` a no-op there.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const lib = new URL('../lib/', import.meta.url);
const files = (await readdir(lib))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => fileURLToPath(new URL(f, lib)))
  .sort();

const result = spawnSync(process.execPath, ['--test', '--no-warnings', ...files], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

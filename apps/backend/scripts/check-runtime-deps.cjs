// Fails when the compiled backend requires a package that apps/backend does not list as its own dependency.
// With pnpm's strict layout such a package may still resolve on a developer machine (hoisted by something else)
// and then crash the production image with "Cannot find module". Run after `nest build`.
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }));
const used = new Map();

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/require\(["']([^"'./][^"']*)["']\)/g)) {
        const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
        if (!builtinModules.includes(name) && !name.startsWith('node:') && !used.has(name)) used.set(name, path.relative(root, p));
      }
    }
  }
})(path.join(root, 'dist'));

const missing = [...used].filter(([name]) => !declared.has(name));
if (missing.length) {
  console.error('Runtime packages missing from apps/backend/package.json dependencies:');
  for (const [name, file] of missing) console.error(`  ${name}  (first required in ${file})`);
  process.exit(1);
}
console.log(`Runtime dependency check: ${used.size} packages, all declared.`);

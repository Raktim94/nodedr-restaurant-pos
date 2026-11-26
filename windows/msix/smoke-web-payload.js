'use strict';

// Boots the staged web app from the FINAL (pruned) payload and checks it the way a browser would: the login page
// answers, and every script/style/font file that page references is served. stage-server-assets.ps1 runs this after
// finalize-server-payload.js, so a payload whose web app starts but cannot show its pages (the "blank window" with
// failed chunk requests) fails the build instead of reaching a customer.
//
// Usage: node smoke-web-payload.js <serverDir> [nodeExe]

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const serverDir = process.argv[2];
const nodeExe = process.argv[3] || process.execPath;
if (!serverDir) {
  console.error('Usage: node smoke-web-payload.js <serverDir> [nodeExe]');
  process.exit(1);
}
const webDir = path.join(serverDir, 'web', 'apps', 'web');
if (!fs.existsSync(path.join(webDir, 'server.js'))) {
  console.error(`smoke: ${path.join(webDir, 'server.js')} not found`);
  process.exit(1);
}

const PORT = 19598;
const base = `http://127.0.0.1:${PORT}`;
let output = '';
const child = spawn(nodeExe, ['server.js'], {
  cwd: webDir,
  env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
let exited = false;
child.on('exit', () => (exited = true));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(base + url, { signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  return { status: res.status, body };
}

async function main() {
  let page;
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('the web server exited while starting');
    try {
      page = await get('/login');
      break;
    } catch {
      await sleep(1000);
    }
  }
  if (!page) throw new Error('the web server never answered');
  if (page.status !== 200) throw new Error(`/login answered HTTP ${page.status}`);
  const urls = [...new Set([...page.body.matchAll(/\/_next\/static\/[^"'\\\s<>)]+/g)].map((m) => m[0].replace(/&amp;/g, '&')))];
  if (urls.length < 3) throw new Error(`/login references only ${urls.length} static files`);
  const bad = [];
  for (const u of urls) {
    const r = await get(u);
    if (r.status !== 200) bad.push(`HTTP ${r.status} ${u}`);
  }
  if (bad.length) throw new Error(`${bad.length} of ${urls.length} static files were not served:\n  ${bad.slice(0, 10).join('\n  ')}`);
  console.log(`smoke: /login and its ${urls.length} static files are all served`);
}

main()
  .then(() => {
    child.kill();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`smoke FAILED: ${err.message}\n---- web server output ----\n${output.slice(-3000)}`);
    child.kill();
    process.exit(1);
  });

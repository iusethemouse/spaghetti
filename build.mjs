import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Explicit allowlist: server/, local state, tokens and Functions cannot enter the upload.
const files = [
  'index.html', 'privacy.html', 'style.css', '_headers',
  'api.js', 'state.js', 'main.js', 'render.js', 'picker.js', 'drag.js', 'wires.js', 'share.js'
];
const root = new URL('./', import.meta.url);
const output = new URL('site/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output);
const hashes = {};
for (const file of files) {
  const source = new URL(`web/${file}`, root);
  await copyFile(source, new URL(file, output));
  hashes[file] = createHash('sha256').update(await readFile(source)).digest('hex');
}
let revision = process.env.CF_PAGES_COMMIT_SHA ?? null;
let dirty = false;
try {
  revision ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
} catch {
  // A downloaded source archive need not contain Git metadata.
}
await writeFile(new URL('build.json', output), JSON.stringify({ revision, dirty, files: hashes }, null, 2) + '\n');
console.log(`Built ${files.length} static files and build.json in site/. No server or Functions.`);

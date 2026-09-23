import { readFile, writeFile, mkdir, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(ROOT, 'dist', 'spaghetti.mjs');

async function assets() {
  const dir = join(ROOT, 'web');
  const files = await readdir(dir);
  const held = {};
  for (const name of files.sort()) {
    held[name] = await readFile(join(dir, name), 'utf8');
  }
  return held;
}

function strip(source) {
  return source
    .replace(/^import \{[^}]*\} from '\.\/gh\.mjs';\n/m, '')
    .replace(/^start\(\)\.catch\(\(error\) => \{\n  console\.error\(error\.message\);\n  process\.exitCode = 1;\n\}\);\n?/m, '');
}

const web = await assets();
const gh = await readFile(join(ROOT, 'server', 'gh.mjs'), 'utf8');
const server = strip(await readFile(join(ROOT, 'server', 'index.mjs'), 'utf8'));
const bundle = `#!/usr/bin/env node
const ASSETS = ${JSON.stringify(web, null, 0)};

${gh}
${server}
start(ASSETS).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
`;

for (const line of bundle.split('\n')) {
  if (/^import .* from '\.\//.test(line)) throw new Error(`unresolved local import: ${line}`);
}

await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(OUT, bundle);
await chmod(OUT, 0o755);
process.stdout.write(`${OUT} ${(bundle.length / 1024).toFixed(1)}kb\n`);

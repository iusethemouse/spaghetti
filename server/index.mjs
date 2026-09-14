import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { viewer, searchRepos, listPullRequests, ready } from './gh.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'web');
const STORE = process.env.SPAGHETTI_DATA ?? join(homedir(), '.spaghetti', 'state.json');
const LEGACY = join(ROOT, 'board.json');
const ORG = process.env.SPAGHETTI_ORG ?? 'knime';
const TTL = 60_000;

const cache = new Map();

async function cached(key, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < TTL) return hit.value;
  const value = await produce();
  cache.set(key, { time: Date.now(), value });
  return value;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const EMPTY = { version: 2, active: null, bundles: [] };

function send(res, status, body, type = 'application/json') {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STORE, 'utf8'));
  } catch {
    try {
      return JSON.parse(await readFile(LEGACY, 'utf8'));
    } catch {
      return EMPTY;
    }
  }
}

async function saveState(doc) {
  await mkdir(dirname(STORE), { recursive: true });
  const temporary = `${STORE}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(doc, null, 2));
  try {
    await writeFile(`${STORE}.bak`, await readFile(STORE));
  } catch {
    // there is no earlier state to keep
  }
  await rename(temporary, STORE);
}

async function serveStatic(res, pathname, assets) {
  if (!assets && pathname === '/api.js') {
    return send(res, 200, await readFile(join(ROOT, 'server', 'api.js'), 'utf8'), 'text/javascript');
  }
  const relative = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  if (assets) {
    const body = assets[relative.replace(/^\//, '')];
    if (body === undefined) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[extname(relative)] ?? 'text/plain', 'cache-control': 'no-store' });
    return res.end(body);
  }
  const file = join(WEB, relative);
  if (!file.startsWith(WEB)) return send(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

async function api(req, res, url) {
  const route = url.pathname.slice(5);

  if (route === 'viewer') {
    return send(res, 200, { org: ORG, viewer: await cached('viewer', viewer) });
  }

  if (route === 'repos') {
    const query = (url.searchParams.get('q') ?? '').trim();
    return send(res, 200, { repos: await cached(`repos:${query}`, () => searchRepos(ORG, query)) });
  }

  if (route === 'pulls') {
    const repo = url.searchParams.get('repo') ?? '';
    const [owner, name] = repo.split('/');
    if (!owner || !name) return send(res, 400, { error: 'repo must be owner/name' });
    const key = `pulls:${repo}`;
    if (url.searchParams.get('fresh')) cache.delete(key);
    return send(res, 200, await cached(key, () => listPullRequests(owner, name)));
  }

  if (route === 'state') {
    if (req.method === 'PUT') {
      await saveState(await readBody(req));
      return send(res, 200, { ok: true });
    }
    return send(res, 200, await loadState());
  }

  send(res, 404, { error: 'unknown route' });
}

function listen(server, port, attempts = 12) {
  return new Promise((resolve, reject) => {
    const retry = (error) => {
      if (error.code !== 'EADDRINUSE' || attempts <= 1) return reject(error);
      server.removeListener('error', retry);
      resolve(listen(server, port + 1, attempts - 1));
    };
    server.once('error', retry);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', retry);
      resolve(port);
    });
  });
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // the URL is printed anyway
  }
}

export async function start(assets = null) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      await serveStatic(res, url.pathname, assets);
    } catch (error) {
      send(res, 500, { error: String(error.message ?? error) });
    }
  });

  const port = await listen(server, Number(process.env.PORT ?? 7777));
  const url = `http://localhost:${port}`;
  const health = await ready();
  if (!health.ok) process.stdout.write(`gh: ${health.error}\n`);
  process.stdout.write(`${url}\n${STORE}\n`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
}

if (!process.env.SPAGHETTI_EMBED) start();

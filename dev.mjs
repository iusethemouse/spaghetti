// Development only. Cloudflare publishes site/; this file is not deployed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const root = new URL('./site/', import.meta.url);
const headers = Object.fromEntries((await readFile(new URL('_headers', root), 'utf8'))
  .split('\n').filter((line) => line.startsWith('  ')).map((line) => {
    const at = line.indexOf(':');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, headers);
      return response.end();
    }
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (!/^[\w.-]+$/.test(name) || name.startsWith('_')) throw new Error('not found');
    const body = await readFile(new URL(name, root));
    response.writeHead(200, { ...headers, 'Content-Type': `${types[extname(name)] ?? 'text/plain'}; charset=utf-8` });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, headers);
    response.end('Not found');
  }
}).listen(Number(process.env.PORT ?? 7777), '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${process.env.PORT ?? 7777}`);
});

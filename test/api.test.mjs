import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

async function setup(t) {
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  const calls = [];
  let reply = () => Response.json({ id: 1, login: 'alice' });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return reply(url, options);
  };
  t.after(() => Object.assign(globalThis, previous));
  const { api } = await import(`../web/api.js?case=${Math.random()}`);
  return { api, calls, reply: (value) => { reply = value; } };
}

test('token goes only to GitHub, stays out of persistent storage, and forget keeps boards', async (t) => {
  const { api, calls } = await setup(t);
  await api.connect('  ghp_TEST_NOT_A_REAL_TOKEN  ', 'knime');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/user');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ghp_TEST_NOT_A_REAL_TOKEN');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(sessionStorage.getItem('spaghetti.token'), 'ghp_TEST_NOT_A_REAL_TOKEN');
  assert.ok(!JSON.stringify([...localStorage.values]).includes('ghp_TEST_NOT_A_REAL_TOKEN'));
  const board = { version: 2, bundles: [{ name: 'work', snapshot: { private: 'details' } }] };
  await api.saveState(board);
  assert.equal(calls.length, 1, 'saving must make no network request');
  api.disconnect();
  assert.equal(api.connected, false);
  assert.equal(sessionStorage.getItem('spaghetti.token'), null);
  assert.deepEqual(await api.loadState(), board);
  await assert.rejects(api.repos('secret'), /Paste a GitHub token/);
  assert.equal(calls.length, 1);
});

test('accounts have separate boards and an invalid replacement preserves the current token', async (t) => {
  const { api, reply } = await setup(t);
  await api.connect('alice-token', 'knime');
  await api.saveState({ bundles: ['alice-board'] });
  reply(() => Response.json({ message: 'Bad credentials' }, { status: 401 }));
  await assert.rejects(api.connect('bad-token', 'knime'), /invalid or expired/);
  assert.equal(sessionStorage.getItem('spaghetti.token'), 'alice-token');
  assert.deepEqual(await api.loadState(), { bundles: ['alice-board'] });
  reply(() => Response.json({ id: 2, login: 'bob' }));
  await api.connect('bob-token', 'knime');
  assert.deepEqual((await api.loadState()).bundles, []);
  await api.saveState({ bundles: ['bob-board'] });
  reply(() => Response.json({ id: 1, login: 'alice' }));
  await api.connect('alice-token', 'knime');
  assert.deepEqual(await api.loadState(), { bundles: ['alice-board'] });
});

test('GitHub errors explain SSO, rate limits and GraphQL permissions', async (t) => {
  const { api, reply, calls } = await setup(t);
  await api.connect('test-token', 'knime');
  reply(() => Response.json({ message: 'Forbidden' }, { status: 403, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/knime/sso' } }));
  await assert.rejects(api.repos('test'), /SSO/);
  reply(() => Response.json({ message: 'Forbidden' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
  await assert.rejects(api.repos('test'), /rate limit/);
  reply(() => Response.json({ data: { repository: null }, errors: [{ message: 'Resource not accessible by personal access token' }] }));
  await assert.rejects(api.pulls('knime/private'), /Resource not accessible/);
  assert.equal(calls.at(-1).url, 'https://api.github.com/graphql');
  assert.equal(calls.at(-1).options.method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).variables, { owner: 'knime', name: 'private' });
  assert.ok(calls.every(({ url }) => new URL(url).origin === 'https://api.github.com'));
});

test('storage failure is reported instead of silently discarding a board', async (t) => {
  const { api } = await setup(t);
  await api.connect('test-token', 'knime');
  localStorage.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  await assert.rejects(api.saveState({ bundles: [] }), /Storage full/);
});

test('production build contains only declared static files and matching hashes', async () => {
  execFileSync(process.execPath, ['build.mjs']);
  const manifest = JSON.parse(await readFile('site/build.json', 'utf8'));
  assert.deepEqual((await readdir('site')).sort(), [...Object.keys(manifest.files), 'build.json'].sort());
  assert.ok(!Object.keys(manifest.files).some((name) => /worker|server|functions|\.mjs$/.test(name)));
  for (const [name, hash] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(await readFile(`site/${name}`)).digest('hex'), hash);
  }
  const headers = await readFile('site/_headers', 'utf8');
  assert.match(headers, /connect-src https:\/\/api\.github\.com;/);
  assert.match(headers, /worker-src 'none'/);
  assert.ok(!(await readFile('site/api.js', 'utf8')).includes("fetch('/api/"));
});

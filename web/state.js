import { api } from './api.js';

export const COLORS = {
  a: '#ff5f56',
  b: '#ffa24b',
  c: '#ffd93f',
  d: '#5fd75f',
  e: '#3fd7d7',
  f: '#5f9fff',
  g: '#b57fff',
  h: '#ff6fc0'
};

export const ARCHIVE = 'merged';

export const state = {
  viewer: null,
  doc: { version: 2, active: null, bundles: [] },
  board: { repos: [], rows: [], cards: [], links: [], tags: [] },
  pulls: new Map(),
  selected: null,
  focus: null
};

const listeners = new Set();
let saveTimer = null;

export function subscribe(listener) {
  listeners.add(listener);
}

export function emit() {
  for (const listener of listeners) listener();
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveState(state.doc).catch(report), 250);
}

export function commit() {
  emit();
  save();
}

export function report(error) {
  const toast = document.getElementById('toast');
  toast.textContent = String(error.message ?? error);
  toast.hidden = false;
  clearTimeout(report.timer);
  report.timer = setTimeout(() => { toast.hidden = true; }, 4000);
}

export function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function pull(repo, number) {
  return state.pulls.get(repo)?.byNumber.get(number) ?? null;
}

export function cardsIn(repo, row) {
  return state.board.cards.filter((card) => card.repo === repo && card.row === row);
}

export function cellLayout(repo, row) {
  const held = cardsIn(repo, row).slice().sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
  const bySlot = new Map();
  for (const item of held) {
    let slot = Math.max(0, item.slot ?? 0);
    while (bySlot.has(slot)) slot += 1;
    bySlot.set(slot, item);
  }
  return bySlot;
}

export function archived(cardId) {
  return card(cardId)?.row === ARCHIVE;
}

export function columnSlots(repo) {
  const widest = state.board.rows.reduce((most, row) => {
    const slots = [...cellLayout(repo, row.id).keys()];
    return Math.max(most, slots.length ? Math.max(...slots) + 1 : 0);
  }, 0);
  return Math.max(1, widest);
}

export function freeSlot(repo, row, wanted = 0) {
  const taken = cellLayout(repo, row);
  let slot = Math.max(0, wanted);
  while (taken.has(slot)) slot += 1;
  return slot;
}

export function card(cardId) {
  return state.board.cards.find((item) => item.id === cardId) ?? null;
}

export function tag(tagId) {
  return state.board.tags.find((item) => item.id === tagId) ?? null;
}

export function tagsOf(cardId) {
  const item = card(cardId);
  if (!item) return [];
  return item.tags.map(tag).filter(Boolean);
}

export function onBoard(repo, number) {
  return state.board.cards.some((item) => item.repo === repo && item.number === number);
}

export function parentPull(repo, base) {
  const data = state.pulls.get(repo);
  if (!data || !base) return null;
  if (base === data.defaultBranch || base === 'master' || base === 'main') return null;
  const matches = data.pulls.filter((item) => item.head === base);
  return matches.find((item) => item.state === 'OPEN') ?? matches[0] ?? null;
}

function index(data) {
  data.byNumber = new Map(data.pulls.map((item) => [item.number, item]));
  data.open = data.pulls.filter((item) => item.state === 'OPEN').length;
  return data;
}

export function hydrate() {
  state.pulls = new Map();
  for (const [repo, data] of Object.entries(state.board.snapshot ?? {})) {
    state.pulls.set(repo, index({ ...data, pulls: data.pulls ?? [] }));
  }
}

export async function loadPulls(repo, fresh = false) {
  const held = state.board;
  const data = index(await api.pulls(repo, fresh));
  held.snapshot[repo] = { defaultBranch: data.defaultBranch, pulls: data.pulls, fetchedAt: Date.now() };
  if (held === state.board) state.pulls.set(repo, data);
  save();
  return data;
}

export function addRepo(repo, index = state.board.repos.length) {
  if (state.board.repos.some((item) => item.id === repo.fullName)) return;
  state.board.repos.splice(index, 0, { id: repo.fullName, owner: repo.owner, name: repo.name });
  if (!state.board.rows.length) addRow();
  commit();
  loadPulls(repo.fullName).then(emit).catch(report);
}

export function adoptBundle(shared) {
  const fresh = { ...emptyBundle(shared.name), ...shared, id: id('bundle'), snapshot: {} };
  state.doc.bundles.push(fresh);
  state.doc.active = fresh.id;
  state.board = fresh;
  state.selected = null;
  state.focus = null;
  hydrate();
  commit();
  fetchMissing().catch(report);
  return fresh;
}

export function dropRepo(repoId) {
  const board = state.board;
  delete board.snapshot[repoId];
  const gone = new Set(board.cards.filter((item) => item.repo === repoId).map((item) => item.id));
  board.repos = board.repos.filter((item) => item.id !== repoId);
  board.cards = board.cards.filter((item) => !gone.has(item.id));
  board.links = board.links.filter((item) => !gone.has(item.from) && !gone.has(item.to));
  commit();
}

export function addRow() {
  return addRowAt(state.board.rows.length);
}

export function addRowAt(index) {
  const fresh = { id: id('row') };
  state.board.rows.splice(index, 0, fresh);
  commit();
  return fresh;
}

export function dropRow(rowId) {
  const board = state.board;
  const gone = new Set(board.cards.filter((item) => item.row === rowId).map((item) => item.id));
  board.rows = board.rows.filter((item) => item.id !== rowId);
  board.cards = board.cards.filter((item) => !gone.has(item.id));
  board.links = board.links.filter((item) => !gone.has(item.from) && !gone.has(item.to));
  commit();
}

export function reorder(kind, movingId, overId) {
  const list = kind === 'rows' ? state.board.rows : state.board.repos;
  const from = list.findIndex((item) => item.id === movingId);
  const to = list.findIndex((item) => item.id === overId);
  if (from === -1 || to === -1 || from === to) return false;
  list.splice(to, 0, list.splice(from, 1)[0]);
  commit();
  return true;
}

export function addCard(repo, row, number, wanted = 0) {
  const exists = state.board.cards.find((item) => item.repo === repo && item.number === number);
  if (exists) {
    exists.row = row;
    exists.slot = freeSlot(repo, row, wanted);
  } else {
    state.board.cards.push({ id: id('card'), repo, row, number, slot: freeSlot(repo, row, wanted), tags: [] });
  }
  commit();
}

export function dropCard(cardId) {
  const board = state.board;
  board.cards = board.cards.filter((item) => item.id !== cardId);
  board.links = board.links.filter((item) => item.from !== cardId && item.to !== cardId);
  if (state.selected === cardId) state.selected = null;
  commit();
}

export function moveCard(cardId, row, slot) {
  const moved = card(cardId);
  if (!moved) return;
  moved.row = row;

  if (row === ARCHIVE) {
    moved.slot = cardsIn(moved.repo, ARCHIVE).filter((item) => item.id !== cardId).length;
    commit();
    return;
  }

  moved.slot = Math.max(0, slot);

  const others = state.board.cards
    .filter((item) => item.repo === moved.repo && item.row === row && item.id !== cardId)
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));

  let cursor = moved.slot;
  for (const other of others) {
    const held = other.slot ?? 0;
    if (held < cursor) continue;
    if (held > cursor) break;
    other.slot = held + 1;
    cursor = other.slot;
  }
  commit();
}

export function link(from, to) {
  if (from === to) return;
  const exists = state.board.links.some((item) => item.from === from && item.to === to);
  if (exists) return;
  state.board.links = state.board.links.filter((item) => !(item.from === to && item.to === from));
  state.board.links.push({ id: id('link'), from, to });
  commit();
}

export function unlink(linkId) {
  state.board.links = state.board.links.filter((item) => item.id !== linkId);
  commit();
}

export function addTag() {
  const taken = new Set(state.board.tags.map((item) => item.color));
  const keys = Object.keys(COLORS);
  const color = keys.find((key) => !taken.has(key)) ?? keys[state.board.tags.length % keys.length];
  const fresh = { id: id('tag'), name: '', color };
  state.board.tags.push(fresh);
  commit();
  return fresh;
}

export function dropTag(tagId) {
  state.board.tags = state.board.tags.filter((item) => item.id !== tagId);
  for (const item of state.board.cards) item.tags = item.tags.filter((held) => held !== tagId);
  if (state.focus === tagId) state.focus = null;
  commit();
}

export function nameTag(tagId, name) {
  const target = tag(tagId);
  if (!target || target.name === name) return;
  target.name = name;
  commit();
}

export function colorTag(tagId, color) {
  const target = tag(tagId);
  if (!target) return;
  target.color = color;
  commit();
}

export function toggleTag(cardId, tagId) {
  const target = card(cardId);
  if (!target) return;
  const at = target.tags.indexOf(tagId);
  if (at === -1) target.tags.push(tagId);
  else target.tags.splice(at, 1);
  commit();
}

export function emptyBundle(name = '') {
  return { id: id('bundle'), name, repos: [], rows: [{ id: id('row') }], cards: [], links: [], tags: [], snapshot: {} };
}

function fixBundle(bundle) {
  const merged = { ...emptyBundle(), ...bundle };
  merged.snapshot ??= {};
  const byColor = new Map(merged.tags.map((item) => [item.color, item]));
  const filled = new Map();
  for (const item of merged.cards) {
    item.tags ??= [];
    if (typeof item.slot !== 'number') {
      const key = `${item.repo}|${item.row}`;
      const next = filled.get(key) ?? 0;
      item.slot = next;
      filled.set(key, next + 1);
    }
    if (!item.color) continue;
    let held = byColor.get(item.color);
    if (!held) {
      held = { id: id('tag'), name: '', color: item.color };
      merged.tags.push(held);
      byColor.set(item.color, held);
    }
    if (!item.tags.includes(held.id)) item.tags.push(held.id);
    delete item.color;
  }
  return merged;
}

function migrate(doc) {
  if (Array.isArray(doc?.bundles) && doc.bundles.length) {
    const bundles = doc.bundles.map(fixBundle);
    const active = bundles.some((item) => item.id === doc.active) ? doc.active : bundles[0].id;
    return { version: 2, active, bundles };
  }
  if (Array.isArray(doc?.repos) && (doc.repos.length || doc.cards?.length)) {
    const only = fixBundle({ ...doc, name: 'board' });
    return { version: 2, active: only.id, bundles: [only] };
  }
  const fresh = emptyBundle('board');
  return { version: 2, active: fresh.id, bundles: [fresh] };
}

export function bundle(bundleId) {
  return state.doc.bundles.find((item) => item.id === bundleId) ?? null;
}

export function useBundle(bundleId) {
  const wanted = bundle(bundleId);
  if (!wanted || wanted === state.board) return;
  state.doc.active = wanted.id;
  state.board = wanted;
  state.selected = null;
  state.focus = null;
  hydrate();
  commit();
  fetchMissing().catch(report);
}

export function addBundle(name = '') {
  const fresh = emptyBundle(name);
  state.doc.bundles.push(fresh);
  state.doc.active = fresh.id;
  state.board = fresh;
  state.selected = null;
  state.focus = null;
  hydrate();
  commit();
  return fresh;
}

export function dropBundle(bundleId) {
  const doc = state.doc;
  doc.bundles = doc.bundles.filter((item) => item.id !== bundleId);
  if (!doc.bundles.length) doc.bundles.push(emptyBundle('board'));
  if (!doc.bundles.some((item) => item.id === doc.active)) {
    doc.active = doc.bundles[0].id;
    state.board = doc.bundles[0];
    state.selected = null;
    state.focus = null;
    hydrate();
  }
  commit();
  fetchMissing().catch(report);
}

export function nameBundle(bundleId, name) {
  const wanted = bundle(bundleId);
  if (!wanted || wanted.name === name) return;
  wanted.name = name;
  commit();
}

export async function fetchMissing() {
  const held = state.board;
  const missing = held.repos.filter((repo) => !held.snapshot[repo.id]);
  await Promise.all(missing.map((repo) => loadPulls(repo.id).catch(report)));
  emit();
}

export async function boot() {
  const [who, doc] = await Promise.all([api.viewer(), api.loadState()]);
  state.viewer = who.viewer;
  state.doc = migrate(doc);
  state.board = bundle(state.doc.active);
  state.selected = null;
  state.focus = null;
  hydrate();
  emit();
  await fetchMissing();
}

export async function refresh() {
  await Promise.all(state.board.repos.map((repo) => loadPulls(repo.id, true).catch(report)));
  emit();
}

import { state, COLORS, ARCHIVE, cellLayout, columnSlots, cardsIn, pull, card, tagsOf, parentPull, onBoard } from './state.js';

const strip = document.getElementById('bundles');

const grid = document.getElementById('grid');
const bar = document.getElementById('tags');
const stage = document.getElementById('stage');
const isolate = document.getElementById('isolate');

const STATES = ['draft', 'ready', 'review', 'conflict', 'approved', 'merged'];

export function statusOf(data) {
  if (!data) return null;
  if (data.state === 'MERGED') return 'merged';
  if (data.draft) return 'draft';
  if (data.mergeable === 'CONFLICTING') return 'conflict';
  if (data.review === 'APPROVED') return 'approved';
  if (data.review === 'CHANGES_REQUESTED' || data.review === 'REVIEW_REQUIRED') return 'review';
  return 'ready';
}

function rail(data) {
  const node = document.createElement('div');
  node.className = 'rail';
  const held = statusOf(data);
  for (const key of STATES) {
    const line = document.createElement('span');
    line.className = 'st';
    line.dataset.key = key;
    if (key === held) line.dataset.on = '1';
    line.textContent = key;
    node.append(line);
  }
  return node;
}

function checks(data) {
  const node = document.createElement('i');
  node.className = 'dot checks';
  node.dataset.state = data.checks ?? 'NONE';
  return node;
}

export function flags(data) {
  const node = document.createElement('span');
  node.className = 'flags';
  const held = statusOf(data);
  const label = document.createElement('span');
  label.className = 'st';
  label.dataset.key = held;
  label.dataset.on = '1';
  label.textContent = held ?? '';
  node.append(checks(data), label);
  return node;
}

function killer(role) {
  const button = document.createElement('button');
  button.className = 'kill';
  button.textContent = '×';
  button.dataset.role = role;
  return button;
}

function dot(color) {
  const node = document.createElement('i');
  node.className = 'dot';
  if (color) node.style.background = COLORS[color];
  else node.dataset.empty = '1';
  return node;
}

export function buildCard(item) {
  const data = pull(item.repo, item.number);
  const tags = tagsOf(item.id);
  const node = document.createElement('article');
  node.className = 'card';
  node.dataset.id = item.id;
  node.dataset.repo = item.repo;
  if (data?.draft) node.dataset.draft = '1';
  if (data?.state) node.dataset.state = data.state;
  if (state.selected === item.id) node.dataset.selected = '1';
  node.style.borderLeftColor = tags.length ? COLORS[tags[0].color] : '';

  const body = document.createElement('div');
  body.className = 'body';

  const top = document.createElement('div');
  top.className = 'top';

  const chips = document.createElement('span');
  chips.className = 'chips';
  chips.dataset.role = 'tags';
  if (tags.length) for (const held of tags) chips.append(dot(held.color));
  else chips.append(dot(null));

  const num = document.createElement('a');
  num.className = 'num';
  num.dataset.role = 'open';
  num.textContent = `#${item.number}`;
  num.href = data?.url ?? `https://github.com/${item.repo}/pull/${item.number}`;
  num.target = '_blank';
  num.rel = 'noreferrer';

  top.append(chips, num);

  if (data?.author) {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = data.author;
    top.append(who);
  }
  if (data) top.append(checks(data));

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = data?.title ?? '';

  const refs = document.createElement('div');
  refs.className = 'refs';
  if (data) {
    const head = document.createElement('div');
    head.className = 'ref';
    head.textContent = data.head;

    const base = document.createElement('div');
    base.className = 'ref base';
    const name = document.createElement('span');
    name.className = 'branch';
    name.textContent = `▸ ${data.base}`;
    base.append(name);

    const parent = parentPull(item.repo, data.base);
    if (parent && !onBoard(item.repo, parent.number)) {
      const grow = document.createElement('button');
      grow.className = 'grow';
      grow.dataset.role = 'add-parent';
      grow.dataset.number = String(parent.number);
      grow.textContent = `+#${parent.number}`;
      base.append(grow);
    }
    refs.append(head, base);
  }

  body.append(top, title, refs);

  const plug = document.createElement('span');
  plug.className = 'plug';
  plug.dataset.role = 'plug';

  node.append(body, rail(data), plug, killer('kill-card'));
  return node;
}

export function buildChip(item) {
  const data = pull(item.repo, item.number);
  const tags = tagsOf(item.id);
  const node = document.createElement('article');
  node.className = 'card chip';
  node.dataset.id = item.id;
  node.dataset.repo = item.repo;
  if (state.selected === item.id) node.dataset.selected = '1';
  if (data?.state) node.dataset.state = data.state;
  node.style.borderLeftColor = tags.length ? COLORS[tags[0].color] : '';

  const chips = document.createElement('span');
  chips.className = 'chips';
  chips.dataset.role = 'tags';
  if (tags.length) for (const held of tags) chips.append(dot(held.color));
  else chips.append(dot(null));

  const num = document.createElement('a');
  num.className = 'num';
  num.dataset.role = 'open';
  num.textContent = `#${item.number}`;
  num.href = data?.url ?? `https://github.com/${item.repo}/pull/${item.number}`;
  num.target = '_blank';
  num.rel = 'noreferrer';

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = data?.title ?? '';

  const held = statusOf(data);
  const state_ = document.createElement('span');
  state_.className = 'st';
  state_.dataset.key = held;
  state_.dataset.on = '1';
  state_.textContent = held ?? '';

  node.append(chips, num, title, state_, killer('kill-card'));
  return node;
}

function buildBucket(repoId) {
  const cell = document.createElement('div');
  cell.className = 'cell bucket';
  cell.dataset.repo = repoId;
  cell.dataset.row = ARCHIVE;
  const held = cardsIn(repoId, ARCHIVE).slice().sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
  for (const item of held) cell.append(buildChip(item));
  return cell;
}

function buildCell(repoId, rowId, slots) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.repo = repoId;
  cell.dataset.row = rowId;

  const held = cellLayout(repoId, rowId);
  for (let index = 0; index < slots; index += 1) {
    const item = held.get(index);
    if (item) {
      cell.append(buildCard(item));
    } else {
      const hole = document.createElement('div');
      hole.className = 'hole';
      hole.dataset.role = 'add-card';
      hole.dataset.slot = String(index);
      hole.textContent = '+';
      cell.append(hole);
    }
  }

  const add = document.createElement('div');
  add.className = 'add';
  add.dataset.role = 'add-card';
  add.textContent = '+';
  cell.append(add);
  return cell;
}

export function markSelection() {
  for (const node of stage.querySelectorAll('.card')) {
    if (node.dataset.id === state.selected) node.dataset.selected = '1';
    else delete node.dataset.selected;
  }
}

export function markFocus() {
  for (const node of stage.querySelectorAll('.card')) {
    const item = card(node.dataset.id);
    if (state.focus && !item?.tags.includes(state.focus)) node.dataset.dim = '1';
    else delete node.dataset.dim;
  }
  for (const node of bar.querySelectorAll('.tag')) {
    if (node.dataset.id === state.focus) node.dataset.active = '1';
    else delete node.dataset.active;
  }
  const held = state.board.tags.find((item) => item.id === state.focus);
  isolate.hidden = !held;
  if (held) isolate.replaceChildren(dot(held.color));
}

export function renderBundles() {
  const frame = document.createDocumentFragment();
  for (const held of state.doc.bundles) {
    const node = document.createElement('span');
    node.className = 'bundle';
    node.dataset.id = held.id;
    if (held.id === state.doc.active) node.dataset.active = '1';
    const name = document.createElement('span');
    name.className = 'name';
    name.dataset.role = 'bundle-name';
    name.spellcheck = false;
    name.textContent = held.name;
    node.append(name, killer('bundle-kill'));
    frame.append(node);
  }
  const add = document.createElement('button');
  add.className = 'addtag';
  add.dataset.role = 'add-bundle';
  add.textContent = '+';
  frame.append(add);
  strip.replaceChildren(frame);
}

export function renderTags() {
  const frame = document.createDocumentFragment();
  for (const held of state.board.tags) {
    const node = document.createElement('span');
    node.className = 'tag';
    node.dataset.id = held.id;
    node.style.borderColor = COLORS[held.color];

    const swatch = dot(held.color);
    swatch.dataset.role = 'tag-color';

    const name = document.createElement('span');
    name.className = 'name';
    name.dataset.role = 'tag-name';
    name.spellcheck = false;
    name.textContent = held.name;

    node.append(swatch, name, killer('tag-kill'));
    frame.append(node);
  }

  const add = document.createElement('button');
  add.className = 'addtag';
  add.dataset.role = 'add-tag';
  add.textContent = '+';
  frame.append(add);
  bar.replaceChildren(frame);
}

function insertionEdge(kind, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `insert-edge insert-${kind}`;
  button.dataset.role = `insert-${kind}`;
  button.dataset.index = String(index);
  button.title = kind === 'row' ? 'Insert row above' : 'Insert repository before';
  button.setAttribute('aria-label', button.title);
  const plus = document.createElement('span');
  plus.textContent = '+';
  button.append(plus);
  return button;
}

export function render() {
  const { repos, rows } = state.board;
  const slots = new Map(repos.map((repo) => [repo.id, columnSlots(repo.id)]));
  const tracks = repos
    .map((repo) => `calc(${slots.get(repo.id)} * (var(--card) + var(--gap)) + var(--add) + 2 * var(--pad))`)
    .join(' ');
  grid.style.gridTemplateColumns = `36px ${tracks} 36px`;
  const frame = document.createDocumentFragment();

  const bucketHead = document.createElement('div');
  bucketHead.className = 'rowhead bucket';
  bucketHead.dataset.row = ARCHIVE;
  const mark = document.createElement('span');
  mark.className = 'ord';
  mark.textContent = '−1';
  bucketHead.append(mark);
  frame.append(bucketHead);
  for (const repo of repos) frame.append(buildBucket(repo.id));
  const bucketFiller = document.createElement('div');
  bucketFiller.className = 'filler';
  frame.append(bucketFiller);

  const corner = document.createElement('div');
  corner.className = 'corner';
  frame.append(corner);

  repos.forEach((repo, index) => {
    const head = document.createElement('div');
    head.className = 'colhead';
    head.dataset.repo = repo.id;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = repo.name;
    name.title = repo.id;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = state.pulls.has(repo.id) ? String(state.pulls.get(repo.id).open) : '·';
    head.append(name, count, killer('kill-repo'));
    head.append(insertionEdge('repo', index));
    frame.append(head);
  });

  const addCol = document.createElement('div');
  addCol.className = 'addcol';
  addCol.dataset.role = 'add-repo';
  addCol.textContent = '+';
  frame.append(addCol);

  rows.forEach((row, index) => {
    const head = document.createElement('div');
    head.className = 'rowhead';
    head.dataset.row = row.id;
    const ord = document.createElement('span');
    ord.className = 'ord';
    ord.textContent = String(index + 1);
    head.append(ord, killer('kill-row'));
    head.append(insertionEdge('row', index));
    frame.append(head);
    repos.forEach((repo, repoIndex) => {
      const cell = buildCell(repo.id, row.id, slots.get(repo.id));
      cell.append(insertionEdge('row', index), insertionEdge('repo', repoIndex));
      frame.append(cell);
    });
    const filler = document.createElement('div');
    filler.className = 'filler';
    frame.append(filler);
  });

  const addRow = document.createElement('div');
  addRow.className = 'addrow';
  addRow.dataset.role = 'add-row';
  addRow.style.gridColumn = '1 / -1';
  addRow.textContent = '+';
  frame.append(addRow);

  grid.replaceChildren(frame);
  renderBundles();
  renderTags();
  markFocus();
}

import { api } from './api.js';
import {
  state, COLORS, boot, refresh, subscribe, emit, report, card, tag,
  addRepo, dropRepo, addRow, addRowAt, dropRow, addCard, dropCard, loadPulls,
  addTag, dropTag, nameTag, colorTag, toggleTag,
  addBundle, dropBundle, nameBundle, useBundle, adoptBundle
} from './state.js';
import { render, flags, markFocus, labelControl } from './render.js';
import { encode, decode, summary } from './share.js';
import { draw } from './wires.js';
import * as picker from './picker.js';
import { install } from './drag.js';

const stage = document.getElementById('stage');
const bar = document.getElementById('tags');
const strip = document.getElementById('bundles');
const menu = document.getElementById('menu');
const who = document.getElementById('who');
const refreshButton = document.getElementById('refresh');
const shareButton = document.getElementById('share');
const adoptButton = document.getElementById('adopt');
const isolateButton = document.getElementById('isolate');

function frame() {
  render();
  draw();
  who.textContent = state.viewer?.login ?? '';
}

function flash(button) {
  button.dataset.ok = '1';
  setTimeout(() => delete button.dataset.ok, 900);
}

function beginEdit(node) {
  node.contentEditable = 'plaintext-only';
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function wireEditing(container, role, apply) {
  container.addEventListener('dblclick', (event) => {
    if (event.target.dataset.role !== role) return;
    beginEdit(event.target);
  });
  container.addEventListener('focusout', (event) => {
    if (event.target.dataset.role !== role) return;
    event.target.contentEditable = 'false';
    apply(event.target.closest('[data-id]').dataset.id, event.target.textContent.trim());
  });
  container.addEventListener('keydown', (event) => {
    if (event.target.dataset.role !== role) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.target.blur();
  });
}

function editName(container, selector) {
  const node = container.querySelector(selector);
  if (node) beginEdit(node);
}

function place(anchor) {
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  const left = Math.min(box.left, window.innerWidth - menu.offsetWidth - 8);
  let top = box.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = box.top - menu.offsetHeight - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function row(color, text, on) {
  const node = document.createElement('button');
  labelControl(node, `${on ? 'Remove' : 'Apply'} tag${text ? `: ${text}` : ''}`);
  node.className = 'row';
  if (on) node.dataset.on = '1';
  const swatch = document.createElement('i');
  swatch.className = 'dot';
  if (color) swatch.style.background = COLORS[color];
  else swatch.dataset.empty = '1';
  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = text;
  node.append(swatch, label);
  return node;
}

function openCardTags(cardId) {
  const anchor = stage.querySelector(`.card[data-id="${cardId}"] .chips`);
  if (!anchor) return;
  const item = card(cardId);
  if (!item) return;
  menu.replaceChildren();
  for (const held of state.board.tags) {
    const node = row(held.color, held.name, item.tags.includes(held.id));
    node.addEventListener('click', () => {
      toggleTag(cardId, held.id);
      openCardTags(cardId);
    });
    menu.append(node);
  }
  const add = document.createElement('button');
  add.className = 'row add';
  labelControl(add, 'New tag');
  add.textContent = 'new tag +';
  add.addEventListener('click', () => {
    const fresh = addTag();
    toggleTag(cardId, fresh.id);
    menu.hidden = true;
    editName(bar, `.tag[data-id="${fresh.id}"] .name`);
  });
  menu.append(add);
  place(anchor);
}

function openTagColors(tagId) {
  const anchor = bar.querySelector(`.tag[data-id="${tagId}"] .dot`);
  if (!anchor) return;
  menu.replaceChildren();
  const swatches = document.createElement('div');
  swatches.className = 'strip';
  for (const key of Object.keys(COLORS)) {
    const swatch = document.createElement('i');
    labelControl(swatch, { a: 'Red', b: 'Orange', c: 'Yellow', d: 'Green', e: 'Cyan', f: 'Blue', g: 'Purple', h: 'Pink' }[key]);
    swatch.className = 'dot';
    swatch.style.background = COLORS[key];
    if (tag(tagId)?.color === key) swatch.dataset.on = '1';
    swatch.addEventListener('click', () => {
      colorTag(tagId, key);
      menu.hidden = true;
    });
    swatches.append(swatch);
  }
  menu.append(swatches);
  place(anchor);
}

function pickRepo(index = state.board.repos.length) {
  picker.open({
    load: async (query) => {
      const { repos } = await api.repos(query);
      const used = new Set(state.board.repos.map((item) => item.id));
      return repos.map((repo) => ({
        main: repo.name,
        sub: repo.owner,
        used: used.has(repo.fullName),
        value: repo
      }));
    },
    pick: (repo) => addRepo(repo, index)
  });
}

function pickPull(repoId, rowId, slot = 0) {
  const rank = { OPEN: 0, MERGED: 1 };
  picker.open({
    live: false,
    load: async (query) => {
      const data = state.pulls.get(repoId) ?? await loadPulls(repoId);
      const used = new Set(state.board.cards.filter((item) => item.repo === repoId).map((item) => item.number));
      const needle = query.toLowerCase();
      return data.pulls
        .filter((item) => !needle || `${item.number} ${item.title} ${item.head} ${item.base} ${item.author}`.toLowerCase().includes(needle))
        .sort((left, right) => rank[left.state] - rank[right.state])
        .map((item) => ({
          lead: `#${item.number}`,
          main: item.title,
          sub: `${item.head} ▸ ${item.base}`,
          flags: flags(item),
          used: used.has(item.number),
          value: item
        }));
    },
    pick: (item) => addCard(repoId, rowId, item.number, slot)
  });
}

function addParent(cardId, number) {
  const item = card(cardId);
  if (!item) return;
  const index = state.board.rows.findIndex((row) => row.id === item.row);
  const above = index > 0 ? state.board.rows[index - 1] : addRowAt(0);
  addCard(item.repo, above.id, number, item.slot ?? 0);
}

stage.addEventListener('click', (event) => {
  const edge = event.target.closest('.insert-edge');
  if (edge?.dataset.role === 'insert-row') return addRowAt(Number(edge.dataset.index));
  if (edge?.dataset.role === 'insert-repo') return pickRepo(Number(edge.dataset.index));
  const role = event.target.dataset.role;
  const cell = event.target.closest('.cell');
  const head = event.target.closest('.colhead');
  const rowHead = event.target.closest('.rowhead');
  const node = event.target.closest('.card');

  if (role === 'add-repo') return pickRepo();
  if (role === 'add-row') return addRow();
  if (role === 'add-card' && cell) return pickPull(cell.dataset.repo, cell.dataset.row, Number(event.target.dataset.slot ?? 0));
  if (role === 'kill-repo' && head) return dropRepo(head.dataset.repo);
  if (role === 'kill-row' && rowHead) return dropRow(rowHead.dataset.row);
  if (role === 'kill-card' && node) return dropCard(node.dataset.id);
  if (role === 'add-parent' && node) return addParent(node.dataset.id, Number(event.target.dataset.number));
  if (node && (role === 'tags' || event.target.closest('.chips'))) return openCardTags(node.dataset.id);
});

bar.addEventListener('click', (event) => {
  const role = event.target.dataset.role;
  const pill = event.target.closest('.tag');

  if (role === 'add-tag') {
    const fresh = addTag();
    editName(bar, `.tag[data-id="${fresh.id}"] .name`);
    return;
  }
  if (!pill) return;
  if (role === 'tag-kill') return dropTag(pill.dataset.id);
  if (role === 'tag-color') return openTagColors(pill.dataset.id);
  if (event.target.isContentEditable) return;
  state.focus = state.focus === pill.dataset.id ? null : pill.dataset.id;
  markFocus();
});

strip.addEventListener('click', (event) => {
  const role = event.target.dataset.role;
  const pill = event.target.closest('.bundle');

  if (role === 'add-bundle') {
    const fresh = addBundle('');
    editName(strip, `.bundle[data-id="${fresh.id}"] .name`);
    return;
  }
  if (!pill) return;
  if (role === 'bundle-kill') return dropBundle(pill.dataset.id);
  if (event.target.isContentEditable) return;
  useBundle(pill.dataset.id);
});

wireEditing(bar, 'tag-name', nameTag);
wireEditing(strip, 'bundle-name', nameBundle);

document.addEventListener('pointerdown', (event) => {
  if (menu.hidden || menu.contains(event.target)) return;
  if (event.target.dataset.role === 'tags' || event.target.closest('.chips')) return;
  menu.hidden = true;
});

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  stage.dataset.busy = '1';
  await refresh().catch(report);
  delete stage.dataset.busy;
  refreshButton.disabled = false;
});

shareButton.addEventListener('click', async () => {
  try {
    const text = await encode(state.board);
    await navigator.clipboard.writeText(text);
    flash(shareButton);
  } catch (error) {
    const text = await encode(state.board).catch(() => '');
    picker.open({ live: false, initial: text, load: async () => [], pick: () => {} });
    report(error);
  }
});

adoptButton.addEventListener('click', () => {
  picker.open({
    live: false,
    load: async (query) => {
      if (!query) return [];
      try {
        const shared = await decode(query);
        return [{ main: shared.name || '·', sub: summary(shared), value: shared }];
      } catch {
        return [];
      }
    },
    pick: (shared) => adoptBundle(shared)
  });
});

isolateButton.addEventListener('click', () => {
  state.focus = null;
  markFocus();
});

window.addEventListener('keydown', (event) => {
  const editing = document.activeElement?.isContentEditable || document.activeElement?.tagName === 'INPUT';
  if (picker.isOpen() || editing) return;
  if ((event.key === 'Backspace' || event.key === 'Delete') && state.selected) {
    dropCard(state.selected);
    event.preventDefault();
  } else if (event.key === 'Escape') {
    state.selected = null;
    state.focus = null;
    menu.hidden = true;
    emit();
  } else if (event.key === 'r') {
    refreshButton.click();
  }
});

window.addEventListener('resize', draw);

subscribe(frame);
install();
boot().catch(report);

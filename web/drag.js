import { state, card, moveCard, link, reorder, toggleTag, ARCHIVE } from './state.js';
import { buildCard, markSelection } from './render.js';
import { point, startLive, moveLive, stopLive, draw } from './wires.js';

const stage = document.getElementById('stage');
const bar = document.getElementById('tags');
const THRESHOLD = 4;

let drag = null;
let wiring = null;
let shift = null;
let tagging = null;

function cellUnder(event, repo) {
  const node = document.elementFromPoint(event.clientX, event.clientY);
  const cell = node?.closest('.cell');
  if (!cell || cell.dataset.repo !== repo) return null;
  return cell;
}

function cardUnder(event) {
  const node = document.elementFromPoint(event.clientX, event.clientY);
  return node?.closest('.card') ?? null;
}

function clearCells() {
  for (const cell of stage.querySelectorAll('.cell[data-over]')) delete cell.dataset.over;
}

function clearTargets() {
  for (const node of stage.querySelectorAll('.card[data-target]')) delete node.dataset.target;
}

function slotAt(cell, event) {
  const rect = cell.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(cell).paddingLeft) || 0;
  const root = getComputedStyle(document.documentElement);
  const step = (parseFloat(root.getPropertyValue('--card')) || 330) + (parseFloat(root.getPropertyValue('--gap')) || 8);
  const slots = cell.querySelectorAll('.card, .hole').length;
  const offset = event.clientX - rect.left - pad;
  return Math.max(0, Math.min(slots, Math.floor(offset / step)));
}

function endDrag(commitDrop, event) {
  if (!drag) return;
  drag.node.removeAttribute('data-drag');
  drag.ghost?.remove();
  delete stage.dataset.dragging;
  clearCells();
  const done = drag;
  drag = null;
  if (!commitDrop || !done.moved) return;
  const cell = cellUnder(event, done.repo);
  if (!cell) return;
  moveCard(done.id, cell.dataset.row, cell.dataset.row === ARCHIVE ? 0 : slotAt(cell, event));
}

function endWiring(commitLink, event) {
  if (!wiring) return;
  stopLive();
  clearTargets();
  delete stage.dataset.wiring;
  const done = wiring;
  wiring = null;
  if (!commitLink) return draw();
  const target = cardUnder(event);
  if (target && target.dataset.id !== done.id) link(done.id, target.dataset.id);
  else draw();
}

function under(event, attribute) {
  const node = document.elementFromPoint(event.clientX, event.clientY);
  return node?.closest(`[data-${attribute}]`)?.dataset[attribute] ?? null;
}

function endTagging(commitDrop, event) {
  if (!tagging) return;
  tagging.ghost?.remove();
  clearTargets();
  const done = tagging;
  tagging = null;
  if (!commitDrop || !done.moved) return;
  const target = cardUnder(event);
  const held = target ? card(target.dataset.id) : null;
  if (held && !held.tags.includes(done.id)) toggleTag(held.id, done.id);
}

function onMove(event) {
  if (tagging) {
    const dx = event.clientX - tagging.x;
    const dy = event.clientY - tagging.y;
    if (!tagging.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    if (!tagging.moved) {
      tagging.moved = true;
      document.activeElement?.blur?.();
      const ghost = tagging.node.cloneNode(true);
      ghost.id = 'tagghost';
      document.body.append(ghost);
      tagging.ghost = ghost;
    }
    tagging.ghost.style.left = `${event.clientX + 8}px`;
    tagging.ghost.style.top = `${event.clientY - 10}px`;
    clearTargets();
    const target = cardUnder(event);
    if (target) target.dataset.target = '1';
    return;
  }
  if (shift) {
    const over = under(event, shift.kind === 'rows' ? 'row' : 'repo');
    if (over) reorder(shift.kind, shift.id, over);
    return;
  }
  if (wiring) {
    moveLive(wiring.id, point(event));
    clearTargets();
    const target = cardUnder(event);
    if (target && target.dataset.id !== wiring.id) target.dataset.target = '1';
    return;
  }
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < THRESHOLD) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.node.dataset.drag = '1';
    const ghost = buildCard(card(drag.id));
    ghost.id = 'ghost';
    document.body.append(ghost);
    drag.ghost = ghost;
  }
  drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
  clearCells();
  const cell = cellUnder(event, drag.repo);
  if (cell) cell.dataset.over = '1';
}

export function install() {
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.insert-edge')) return;
    if (event.target.dataset.role?.startsWith('kill')) return;

    const rowHead = event.target.closest('.rowhead');
    if (rowHead && rowHead.dataset.row !== ARCHIVE) {
      shift = { kind: 'rows', id: rowHead.dataset.row };
      event.preventDefault();
      return;
    }

    const head = event.target.closest('.colhead');
    if (head) {
      shift = { kind: 'repos', id: head.dataset.repo };
      event.preventDefault();
      return;
    }

    const node = event.target.closest('.card');
    if (!node) return;
    const role = event.target.dataset.role;
    if (role === 'open' || event.target.closest('button')) return;
    if (event.target.closest('.chips')) return;

    if (role === 'plug') {
      wiring = { id: node.dataset.id };
      stage.dataset.wiring = '1';
      startLive();
      moveLive(wiring.id, point(event));
      event.preventDefault();
      return;
    }

    const rect = node.getBoundingClientRect();
    drag = {
      id: node.dataset.id,
      repo: node.dataset.repo,
      node,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    state.selected = node.dataset.id;
    markSelection();
    event.preventDefault();
  });

  bar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const pill = event.target.closest('.tag');
    if (!pill) return;
    const role = event.target.dataset.role;
    if (role === 'tag-kill' || role === 'tag-color' || event.target.isContentEditable) return;
    tagging = { id: pill.dataset.id, node: pill, x: event.clientX, y: event.clientY, moved: false };
  });

  window.addEventListener('pointermove', onMove);

  window.addEventListener('pointerup', (event) => {
    shift = null;
    endTagging(true, event);
    endWiring(true, event);
    endDrag(true, event);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    shift = null;
    endTagging(false, event);
    endWiring(false, event);
    endDrag(false, event);
  });
}

import { state, pull, unlink, archived } from './state.js';

const stage = document.getElementById('stage');
const svg = document.getElementById('wires');
const NS = 'http://www.w3.org/2000/svg';
const GUT = 6;
const DEEP = 9;
const PAD = 2;

let live = null;

export function point(event) {
  const box = stage.getBoundingClientRect();
  return {
    x: event.clientX - box.left + stage.scrollLeft,
    y: event.clientY - box.top + stage.scrollTop
  };
}

function boxes() {
  const frame = stage.getBoundingClientRect();
  const found = new Map();
  for (const node of stage.querySelectorAll('.card')) {
    const rect = node.getBoundingClientRect();
    const left = rect.left - frame.left + stage.scrollLeft;
    const top = rect.top - frame.top + stage.scrollTop;
    found.set(node.dataset.id, {
      left,
      top,
      right: left + rect.width,
      bottom: top + rect.height,
      cx: left + rect.width / 2,
      cy: top + rect.height / 2
    });
  }
  return found;
}

function hits(from, to, rect) {
  const left = Math.min(from[0], to[0]);
  const right = Math.max(from[0], to[0]);
  const top = Math.min(from[1], to[1]);
  const bottom = Math.max(from[1], to[1]);
  return left < rect.right - PAD && right > rect.left + PAD
    && top < rect.bottom - PAD && bottom > rect.top + PAD;
}

function open(points, blocks) {
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const rect of blocks) {
      if (hits(points[index], points[index + 1], rect)) return false;
    }
  }
  return true;
}

function route(from, to, blocks) {
  const down = to.cy > from.cy;

  if (Math.abs(from.cx - to.cx) < 12) {
    const x = Math.round((from.cx + to.cx) / 2);
    const straight = [[x, down ? from.bottom : from.top], [x, down ? to.top : to.bottom]];
    if (open(straight, blocks)) return straight;
  }

  if (Math.abs(from.cy - to.cy) < 12) {
    const right = to.cx > from.cx;
    const y = Math.round((from.cy + to.cy) / 2);
    const straight = [[right ? from.right : from.left, y], [right ? to.left : to.right, y]];
    if (open(straight, blocks)) return straight;
  }

  const channel = down ? from.bottom + DEEP : from.top - DEEP;
  const right = to.cx >= from.cx;
  const gutter = right ? to.left - GUT : to.right + GUT;
  return [
    [from.cx, down ? from.bottom : from.top],
    [from.cx, channel],
    [gutter, channel],
    [gutter, to.cy],
    [right ? to.left : to.right, to.cy]
  ];
}

function toPath(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point[0]} ${point[1]}`).join(' ');
}

function stackLinks() {
  const cards = state.board.cards;
  const explicit = new Set(state.board.links.flatMap((item) => [`${item.from}|${item.to}`, `${item.to}|${item.from}`]));
  const derived = [];
  for (const above of cards) {
    if (archived(above.id)) continue;
    const head = pull(above.repo, above.number);
    if (!head) continue;
    for (const below of cards) {
      if (below === above || below.repo !== above.repo || archived(below.id)) continue;
      const base = pull(below.repo, below.number);
      if (!base || base.head !== head.base) continue;
      if (explicit.has(`${above.id}|${below.id}`)) continue;
      derived.push({ id: `stack:${above.id}:${below.id}`, from: above.id, to: below.id, kind: 'stack' });
    }
  }
  return derived;
}

export function draw() {
  const width = Math.max(stage.scrollWidth, stage.clientWidth);
  const height = Math.max(stage.scrollHeight, stage.clientHeight);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;

  const defs = svg.querySelector('defs');
  svg.replaceChildren(defs);

  const found = boxes();
  const all = [...state.board.links.map((item) => ({ ...item, kind: 'depends' })), ...stackLinks()];

  for (const item of all) {
    if (archived(item.from) || archived(item.to)) continue;
    const from = found.get(item.from);
    const to = found.get(item.to);
    if (!from || !to) continue;
    const blocks = [...found.entries()]
      .filter(([id]) => id !== item.from && id !== item.to)
      .map(([, rect]) => rect);
    const d = toPath(route(from, to, blocks));

    if (item.kind === 'depends') {
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'hit');
      hit.dataset.link = item.id;
      const title = document.createElementNS(NS, 'title');
      title.textContent = 'Remove dependency';
      hit.append(title);
      hit.addEventListener('click', () => unlink(item.id));
      svg.append(hit);
    }

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'wire');
    path.dataset.kind = item.kind;
    svg.append(path);
  }

  if (live) svg.append(live);
}

export function startLive() {
  live = document.createElementNS(NS, 'path');
  live.setAttribute('class', 'wire live');
  svg.append(live);
}

export function moveLive(fromCardId, to) {
  if (!live) return;
  const from = boxes().get(fromCardId);
  if (!from) return;
  const right = to.x >= from.right;
  const x1 = right ? from.right : from.left;
  const mid = Math.round((x1 + to.x) / 2);
  live.setAttribute('d', `M${x1} ${from.cy} L${mid} ${from.cy} L${mid} ${to.y} L${to.x} ${to.y}`);
}

export function stopLive() {
  live?.remove();
  live = null;
}

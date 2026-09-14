import { report } from './state.js';

const modal = document.getElementById('modal');
const query = document.getElementById('query');
const results = document.getElementById('results');

let session = null;
let active = 0;
let timer = null;
let token = 0;

function paint(items) {
  results.replaceChildren();
  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.dataset.index = String(index);
    li.title = [item.lead, item.main, item.sub].filter(Boolean).join(' · ');
    if (index === active) li.dataset.active = '1';
    if (item.used) li.dataset.used = '1';
    if (item.lead) {
      const lead = document.createElement('span');
      lead.className = 'lead';
      lead.textContent = item.lead;
      li.append(lead);
    }
    const main = document.createElement('span');
    main.className = 'main';
    main.textContent = item.main;
    li.append(main);
    if (item.sub) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = item.sub;
      li.append(sub);
    }
    if (item.flags) li.append(item.flags);
    results.append(li);
  });
}

function highlight() {
  for (const li of results.children) {
    if (Number(li.dataset.index) === active) li.dataset.active = '1';
    else delete li.dataset.active;
  }
  results.children[active]?.scrollIntoView({ block: 'nearest' });
}

async function reload() {
  if (!session) return;
  const mine = token += 1;
  try {
    const items = await session.load(query.value.trim());
    if (!session || mine !== token) return;
    session.items = items;
    active = 0;
    paint(items);
  } catch (error) {
    if (!session || mine !== token) return;
    paint([]);
    report(error);
  }
}

export function open(config) {
  session = { ...config, items: [] };
  token += 1;
  active = 0;
  query.value = config.initial ?? '';
  results.replaceChildren();
  modal.hidden = false;
  query.focus();
  reload();
}

export function close() {
  session = null;
  modal.hidden = true;
}

export function isOpen() {
  return !modal.hidden;
}

function pick(index) {
  const item = session?.items[index];
  if (!item) return;
  const chosen = session.pick;
  close();
  chosen(item.value);
}

query.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(reload, session?.live === false ? 0 : 160);
});

query.addEventListener('keydown', (event) => {
  if (!session) return;
  if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
    active = Math.min(active + 1, session.items.length - 1);
    highlight();
    event.preventDefault();
  } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
    active = Math.max(active - 1, 0);
    highlight();
    event.preventDefault();
  } else if (event.key === 'Enter') {
    pick(active);
    event.preventDefault();
  } else if (event.key === 'Escape') {
    close();
    event.preventDefault();
  }
});

results.addEventListener('click', (event) => {
  const li = event.target.closest('li');
  if (li) pick(Number(li.dataset.index));
});

modal.addEventListener('pointerdown', (event) => {
  if (event.target === modal) close();
});

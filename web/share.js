import { id } from './state.js';

const ZIP = 'spaghetti1.';
const RAW = 'spaghetti0.';

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

async function squeeze(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function expand(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function pack(board) {
  const repos = board.repos.map((item) => item.id);
  const rowAt = new Map(board.rows.map((row, at) => [row.id, at]));
  const tagAt = new Map(board.tags.map((tag, at) => [tag.id, at]));
  const cardAt = new Map(board.cards.map((item, at) => [item.id, at]));
  const cards = board.cards.map((item) => [
    repos.indexOf(item.repo),
    rowAt.has(item.row) ? rowAt.get(item.row) : -1,
    item.number,
    item.slot ?? 0,
    item.tags.map((held) => tagAt.get(held)).filter((at) => at !== undefined)
  ]);
  const links = board.links
    .filter((item) => cardAt.has(item.from) && cardAt.has(item.to))
    .map((item) => [cardAt.get(item.from), cardAt.get(item.to)]);
  return [1, board.name ?? '', repos, board.rows.length, board.tags.map((tag) => [tag.name, tag.color]), cards, links];
}

function unpack(wire) {
  const [version, name, repos, rowCount, tags, cards, links] = wire;
  if (version !== 1) throw new Error(`unknown bundle format ${version}`);

  const rows = Array.from({ length: Math.max(1, rowCount) }, () => ({ id: id('row') }));
  const marks = tags.map(([label, color]) => ({ id: id('tag'), name: label ?? '', color: color ?? 'a' }));
  const held = cards
    .filter(([repoAt]) => repos[repoAt])
    .map(([repoAt, rowAt, number, slot, tagged]) => ({
      id: id('card'),
      repo: repos[repoAt],
      row: rowAt < 0 ? 'merged' : rows[Math.min(rowAt, rows.length - 1)].id,
      number,
      slot: slot ?? 0,
      tags: (tagged ?? []).map((at) => marks[at]?.id).filter(Boolean)
    }));

  return {
    name: name ?? '',
    repos: repos.map((full) => {
      const [owner, short] = full.split('/');
      return { id: full, owner, name: short };
    }),
    rows,
    cards: held,
    tags: marks,
    links: (links ?? [])
      .filter(([from, to]) => held[from] && held[to] && from !== to)
      .map(([from, to]) => ({ id: id('link'), from: held[from].id, to: held[to].id })),
    snapshot: {}
  };
}

export async function encode(board) {
  const text = JSON.stringify(pack(board));
  if (typeof CompressionStream === 'undefined') {
    return RAW + toBase64(new TextEncoder().encode(text));
  }
  return ZIP + toBase64(await squeeze(text));
}

export async function decode(input) {
  const text = input.trim();
  if (text.startsWith(ZIP)) return unpack(JSON.parse(await expand(fromBase64(text.slice(ZIP.length)))));
  if (text.startsWith(RAW)) return unpack(JSON.parse(new TextDecoder().decode(fromBase64(text.slice(RAW.length)))));
  throw new Error('not a bundle string');
}

export function summary(board) {
  return `${board.repos.length} repos · ${board.cards.length} cards · ${board.links.length} links · ${board.tags.length} tags`;
}

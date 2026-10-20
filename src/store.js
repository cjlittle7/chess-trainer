// Collections & lines, kept in memory and saved to IndexedDB (this device's browser storage).
import { parsePgn } from "chessops/pgn";
import { parseSan } from "chessops/san";
import * as E from "./engine.js";

const DB_NAME = "opening-trainer", STORE = "kv", KEY = "data";
const SAMPLE_PGN = `[Event "Italian Game (sample)"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 (3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7) 3... Bc5 (3... Nf6 4. d3 Bc5 5. c3 d6)
4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Bxc3 9. d5 Bf6 10. Re1 Ne7 *`;

let data = { app: "opening-trainer", version: 1, nextId: 1, seeded: false, collections: [] };
let storageWorks = true;
const bookCache = new Map();

// ------------------------------------------------------------------ persistence
const openDb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function persist() {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(data)), KEY);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
    storageWorks = true;
  } catch { storageWorks = false; }
}

export const canPersist = () => storageWorks;

export async function load() {
  try {
    const db = await openDb();
    const saved = await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    db.close();
    if (saved && Array.isArray(saved.collections)) data = saved;
  } catch { storageWorks = false; }
  if (!data.seeded && !data.collections.length) {          // first run: add the sample collection
    data.seeded = true;
    const parsed = linesFromPgn(SAMPLE_PGN);
    addCollection("Italian Game (sample)", "white", parsed.lines);
    await persist();
  }
}

// --------------------------------------------------------------------- queries
export const collections = () => data.collections;
export const collection = (id) => data.collections.find((c) => c.id === id);
const newId = () => data.nextId++;

/** position -> Map(uci -> san) built from every line of a collection (used by the random drill and hints). */
export function book(c) {
  if (bookCache.has(c.id)) return bookCache.get(c.id);
  const out = new Map();
  for (const line of c.lines) {
    const pos = E.newPos();
    for (const uci of line.moves) {
      const k = E.key(pos);
      const san = E.play(pos, uci);
      if (!out.has(k)) out.set(k, new Map());
      out.get(k).set(uci, san);
    }
  }
  bookCache.set(c.id, out);
  return out;
}

// ------------------------------------------------------------------ PGN -> lines
/** Every leaf path of every game (mainline + variations) becomes one line. */
export function linesFromPgn(text) {
  const lines = [];
  let games = 0, errors = 0;
  for (const game of parsePgn(text)) {
    games++;
    const fen = game.headers.get("FEN");
    if (fen && fen.split(" ")[0] !== E.START_BOARD) { errors++; continue; }   // standard start only
    const paths = [];
    const walk = (node, pos, path) => {
      let advanced = false;
      for (const child of node.children) {
        const move = parseSan(pos, child.data.san);
        if (!move) { errors++; continue; }
        advanced = true;
        const next = pos.clone();
        const uci = E.standardUci(next, move);
        next.play(move);
        walk(child, next, [...path, uci]);
      }
      if (!advanced && path.length) paths.push(path);
    };
    walk(game.moves, E.newPos(), []);
    let title = (game.headers.get("Event") || "").trim();
    if (["", "?", "Casual Game"].includes(title)) title = `Game ${games}`;
    paths.forEach((moves, i) => lines.push({ name: paths.length === 1 ? title : `${title} (${i + 1}/${paths.length})`, moves }));
  }
  return { lines, games, errors };
}

/** Drop exact duplicates and lines that are only the opening part of a longer line. */
function prune(c) {
  const prefixes = new Set();
  for (const l of c.lines) for (let i = 1; i < l.moves.length; i++) prefixes.add(l.moves.slice(0, i).join(" "));
  const seen = new Set();
  c.lines = c.lines.filter((l) => {
    const k = l.moves.join(" ");
    if (prefixes.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function addCollection(name, color, parsedLines) {
  const c = { id: newId(), name, color, lines: parsedLines.map((l) => ({ id: newId(), name: l.name, moves: l.moves })) };
  data.collections.push(c);
  prune(c);
  return c;
}

// ------------------------------------------------------------------- mutations
export async function createCollection(name, color, pgn) {
  name = (name || "").trim();
  if (!name || !["white", "black"].includes(color) || !(pgn || "").trim()) throw new Error("Name, colour and PGN are all required.");
  const parsed = linesFromPgn(pgn);
  if (!parsed.lines.length) throw new Error("No playable moves found in that PGN.");
  const c = addCollection(name, color, parsed.lines);
  await persist();
  return { id: c.id, games: parsed.games, parsed: parsed.lines.length, total: c.lines.length, errors: parsed.errors };
}

export async function addPgn(collId, pgn) {
  const c = collection(collId);
  if (!c) throw new Error("Collection not found.");
  if (!(pgn || "").trim()) throw new Error("Paste some PGN first.");
  const parsed = linesFromPgn(pgn);
  if (!parsed.lines.length) throw new Error("No playable moves found in that PGN.");
  for (const l of parsed.lines) c.lines.push({ id: newId(), name: l.name, moves: l.moves });
  prune(c);
  bookCache.delete(c.id);
  await persist();
  return { id: c.id, games: parsed.games, parsed: parsed.lines.length, total: c.lines.length, errors: parsed.errors };
}

export async function deleteCollection(id) {
  data.collections = data.collections.filter((c) => c.id !== id);
  bookCache.delete(id);
  await persist();
}

export async function deleteLine(collId, lineId) {
  const c = collection(collId);
  if (!c) return;
  c.lines = c.lines.filter((l) => l.id !== lineId);
  bookCache.delete(c.id);
  await persist();
}

/** Save a recorded line (new, or an edit of lineId). Merges duplicates / shorter prefixes. */
export async function saveLine({ collId, newCollection, name, moves, lineId = null }) {
  if (!moves.length) throw new Error("Play at least one move first.");
  E.replay(moves);                                              // throws if illegal
  name = (name || "").trim().slice(0, 200);
  let c;
  if (newCollection) {
    const n = (newCollection.name || "").trim();
    if (!n || !["white", "black"].includes(newCollection.color)) throw new Error("Give the new collection a name and a colour.");
    c = { id: newId(), name: n, color: newCollection.color, lines: [] };
    data.collections.push(c);
  } else {
    c = collection(collId);
    if (!c) throw new Error("Choose a collection to save into.");
  }
  let line;
  if (lineId !== null) {
    line = c.lines.find((l) => l.id === lineId);
    if (!line) throw new Error("Line not found.");
    line.moves = moves.slice();
    if (name) line.name = name;
  } else {
    line = { id: newId(), name: name || `Line ${c.lines.length + 1}`, moves: moves.slice() };
    c.lines.push(line);
  }
  const before = c.lines.filter((l) => l !== line).map((l) => ({ id: l.id, name: l.name }));
  prune(c);
  bookCache.delete(c.id);
  const saved = c.lines.includes(line);
  const replaced = before.filter((b) => !c.lines.some((l) => l.id === b.id)).map((b) => b.name);
  await persist();
  return { saved, lineId: saved ? line.id : null, replaced, total: c.lines.length, collection: c.name, collId: c.id };
}

// ---------------------------------------------------------------- backup files
export const exportJson = () =>
  JSON.stringify({ app: "opening-trainer", version: 1, exported: new Date().toISOString(), collections: data.collections }, null, 1);

/** Replace ALL data with the contents of a backup file. */
export async function importJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error("That file isn't valid JSON."); }
  if (!obj || obj.app !== "opening-trainer" || !Array.isArray(obj.collections))
    throw new Error("That doesn't look like an Opening Trainer backup.");
  let nextId = 1, dropped = 0, lineTotal = 0;
  const cols = [];
  for (const c of obj.collections) {
    if (!c || typeof c.name !== "string" || !["white", "black"].includes(c.color) || !Array.isArray(c.lines)) { dropped++; continue; }
    const lines = [];
    for (const l of c.lines) {
      try {
        if (!l || !Array.isArray(l.moves) || !l.moves.length) throw new Error();
        E.replay(l.moves);
        lines.push({ id: nextId++, name: String(l.name || "Line").slice(0, 200), moves: l.moves.slice() });
      } catch { dropped++; }
    }
    lineTotal += lines.length;
    cols.push({ id: nextId++, name: c.name.slice(0, 200), color: c.color, lines });
  }
  data = { app: "opening-trainer", version: 1, nextId, seeded: true, collections: cols };
  bookCache.clear();
  await persist();
  return { collections: cols.length, lines: lineTotal, dropped };
}

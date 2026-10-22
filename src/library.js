// Game libraries: big collections of real games (master games, your own games) kept as an opening tree.
// For every position the tree stores each move played from it and how many games ended in a White win,
// a draw or a Black win. Only the first few moves of each game are kept, so thousands of games stay small.
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import * as E from "./engine.js";

const DB_NAME = "opening-trainer-games";

// ------------------------------------------------------------------ hashing
/** 53-bit string hash of a position key (cheap, collisions are negligible at this size). */
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}
export const posHash = (pos) => hashKey(E.key(pos));

// ------------------------------------------------------------------ building
const RESULT_INDEX = { "1-0": 0, "1/2-1/2": 1, "0-1": 2 };

/**
 * Collects games into a tree.
 * opts: { depth (plies), minElo, user, color ("white" | "black" | null), maxGames }
 */
export function createBuilder(opts = {}) {
  const depth = Math.max(2, Math.min(80, Math.round(opts.depth || 30)));
  const minElo = opts.minElo || 0, maxGames = opts.maxGames || Infinity;
  const user = (opts.user || "").trim().toLowerCase();
  const color = opts.color === "white" || opts.color === "black" ? opts.color : null;
  const tree = new Map();                          // hash -> Map(uci -> [w, d, b])
  const st = { seen: 0, used: 0, skipped: 0, errors: 0 };
  const info = [], hashes = [], starts = [];       // one entry per game: details, and the numeric hashes of every position it visited

  function addGame(game) {
    st.seen++;
    if (st.used >= maxGames) { st.skipped++; return; }
    const h = game.headers;
    const ri = RESULT_INDEX[(h.get("Result") || "").trim()];
    if (ri === undefined) { st.skipped++; return; }                              // unfinished / unknown result
    if (user && color) {
      const who = color === "white" ? h.get("White") : h.get("Black");
      if ((who || "").trim().toLowerCase() !== user) { st.skipped++; return; }
    }
    if (minElo) {
      const w = parseInt(h.get("WhiteElo"), 10), b = parseInt(h.get("BlackElo"), 10);
      if (!(w >= minElo && b >= minElo)) { st.skipped++; return; }
    }
    const sp = startingPosition(h);
    if (sp.isErr) { st.errors++; return; }
    const pos = sp.unwrap();
    if (E.key(pos) !== E.key(E.newPos())) { st.skipped++; return; }              // only games from the standard start
    let node = game.moves, plies = 0;
    const seen = new Set();                                    // a game counts once per position, even if it repeats it
    const visited = [];
    while (plies < depth && node.children.length) {
      const child = node.children[0];
      const move = parseSan(pos, child.data.san);
      if (!move) { if (plies === 0) st.errors++; break; }
      const k = posHash(pos), uci = E.standardUci(pos.clone(), move);
      if (!seen.has(k)) {
        seen.add(k); visited.push(Number(k));
        let m = tree.get(k);
        if (!m) tree.set(k, (m = new Map()));
        let c = m.get(uci);
        if (!c) m.set(uci, (c = [0, 0, 0]));
        c[ri]++;
      }
      pos.play(move);
      node = child; plies++;
    }
    if (plies) {
      st.used++;
      const k = posHash(pos);                                   // the game ends here (game over, or the depth limit): count it as having reached this position
      if (!seen.has(k)) {
        visited.push(Number(k));
        let m = tree.get(k);
        if (!m) tree.set(k, (m = new Map()));
        let c = m.get("");
        if (!c) m.set("", (c = [0, 0, 0]));
        c[ri]++;
      }
      const link = (h.get("Link") || h.get("Site") || "").trim();
      let date = (h.get("UTCDate") || h.get("Date") || "").trim();
      if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date)) date = /^\d{4}\.\?\?\.\?\?$/.test(date) ? date.slice(0, 4) : "";
      starts.push(hashes.length); for (const v of visited) hashes.push(v);
      info.push([(h.get("White") || "?").slice(0, 60), (h.get("Black") || "?").slice(0, 60), parseInt(h.get("WhiteElo"), 10) || 0, parseInt(h.get("BlackElo"), 10) || 0,
                 ri, date, /^https?:\/\/[^\s"'<>]+$/.test(link) ? link : "", (h.get("Event") || "").slice(0, 80)]);
    } else st.skipped++;
  }

  return {
    stats: st,
    full: () => st.used >= maxGames,
    /** Add the games in a chunk of PGN text. */
    add(text) {
      try { for (const g of parsePgn(text)) addGame(g); } catch { st.errors++; }
    },
    finish(name, source) {
      const out = {};
      for (const [k, m] of tree) { const a = []; for (const [u, c] of m) a.push(u, c[0], c[1], c[2]); out[k] = a; }
      starts.push(hashes.length);
      return { name, source, color, depth, games: st.used, created: Date.now(), ver: 3, tree: out,
               gameData: { info, hashes: Float64Array.from(hashes), starts: Uint32Array.from(starts) } };
    },
  };
}

/** Split a big PGN text into chunks of about n games, without parsing it. */
export function* chunkPgn(text, n = 150) {
  const re = /\n\s*\n(?=\[Event )/g;
  let start = 0, count = 0, m;
  while ((m = re.exec(text))) {
    if (++count % n === 0) { yield text.slice(start, m.index); start = m.index; }
  }
  if (start < text.length) yield text.slice(start);
}

// ------------------------------------------------------------------ querying
/** Moves played from a position: [{ uci, w, d, b, n }] sorted by games. */
export function movesAt(lib, key) {
  const a = lib.tree[key];
  if (!a) return [];
  const out = [];
  for (let i = 0; i < a.length; i += 4) if (a[i] !== "") out.push({ uci: a[i], w: a[i + 1], d: a[i + 2], b: a[i + 3], n: a[i + 1] + a[i + 2] + a[i + 3] });
  return out.sort((x, y) => y.n - x.n);
}

/** How many games reached a position: those that continued from it plus those that ended there. */
export function gamesAt(lib, key) {
  const a = lib.tree[key];
  if (!a) return 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) n += a[i + 1] + a[i + 2] + a[i + 3];
  return n;
}

// ------------------------------------------------------------------ storage
const openDb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 2);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
    if (!db.objectStoreNames.contains("tree")) db.createObjectStore("tree");
    if (!db.objectStoreNames.contains("games")) db.createObjectStore("games");
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const treeCache = new Map(), gameCache = new Map();

export async function list() {
  const db = await openDb();
  try { return (await wrap(db.transaction("meta").objectStore("meta").getAll())).sort((a, b) => b.created - a.created); }
  finally { db.close(); }
}

export async function save(lib) {
  const db = await openDb();
  try {
    const id = lib.id || Date.now() + Math.floor(Math.random() * 1000);
    const { tree, gameData, ...meta } = lib;
    meta.id = id;
    await new Promise((res, rej) => {
      const tx = db.transaction(["meta", "tree", "games"], "readwrite");
      tx.objectStore("meta").put(meta);
      tx.objectStore("tree").put(tree, id);
      if (gameData) tx.objectStore("games").put(gameData, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
    treeCache.set(id, tree); gameCache.delete(id);
    return id;
  } finally { db.close(); }
}

/** A library with its tree loaded. */
export async function get(id) {
  const db = await openDb();
  try {
    const meta = await wrap(db.transaction("meta").objectStore("meta").get(id));
    if (!meta) throw new Error("That game library no longer exists.");
    let tree = treeCache.get(id);
    if (!tree) { tree = await wrap(db.transaction("tree").objectStore("tree").get(id)); treeCache.set(id, tree); }
    return { ...meta, tree: tree || {} };
  } finally { db.close(); }
}

export async function remove(id) {
  const db = await openDb();
  try {
    await new Promise((res, rej) => {
      const tx = db.transaction(["meta", "tree", "games"], "readwrite");
      tx.objectStore("meta").delete(id); tx.objectStore("tree").delete(id); tx.objectStore("games").delete(id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    treeCache.delete(id); gameCache.delete(id);
  } finally { db.close(); }
}

/**
 * The games that reached a position (numeric position hash), newest first.
 * Returns { total, games: [{ white, black, whiteElo, blackElo, result, date, url, event }] } or null if this library
 * was imported before game details were saved.
 */
export async function findGames(id, hash, limit = 50) {
  let gd = gameCache.get(id);
  if (gd === undefined) {
    const db = await openDb();
    try { gd = (await wrap(db.transaction("games").objectStore("games").get(id))) || null; } finally { db.close(); }
    gameCache.set(id, gd);
  }
  if (!gd) return null;
  const found = [];
  const { hashes, starts, info } = gd;
  for (let g = 0; g < info.length; g++) {
    for (let i = starts[g]; i < starts[g + 1]; i++) if (hashes[i] === hash) { found.push(g); break; }
  }
  found.sort((a, b) => (info[b][5] || "").localeCompare(info[a][5] || "") || b - a);
  const RES = ["1-0", "1/2-1/2", "0-1"];
  return { total: found.length, games: found.slice(0, limit).map((g) => {
    const [white, black, whiteElo, blackElo, ri, date, url, event] = info[g];
    return { white, black, whiteElo, blackElo, result: RES[ri], date, url, event };
  }) };
}

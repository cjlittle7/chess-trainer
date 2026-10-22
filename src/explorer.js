// Opening explorer logic (no DOM).
//
// You pick a side and a set of collections. From the current position the explorer lists every move
// that any selected line plays next ("hints"). Lines are matched by POSITION, not move order, so
// lines that transpose into each other are combined.
//
//   phase "explore": several different continuations remain, so every option is shown.
//   phase "test":    only one continuation remains, so it is tested like an ordinary line.
//
// The opponent's moves are played automatically when there is only one option, and are chosen
// by the user (choose / chooseRandom) when there are several.
import * as E from "./engine.js";
import * as L from "./library.js";

/** Build an explorer over the opening lines (standard start, not puzzles) of these collections. */
export function create(collections, color) {
  const lines = [];
  for (const c of collections) {
    for (const l of c.lines) {
      if (l.start || !l.moves.length) continue;
      const pos = E.newPos(), keys = [E.key(pos)];
      for (const u of l.moves) { E.play(pos, u); keys.push(E.key(pos)); }
      lines.push({ id: l.id, name: l.name, coll: c.name, moves: l.moves, keys, result: l.result || null });
    }
  }
  if (!lines.length) throw new Error("There are no opening lines in the selected collections.");

  // position key -> [{ li: line index, k: ply at which that line reaches the position }]  (every visit, so lines that repeat a position are handled)
  const index = new Map();
  lines.forEach((ln, li) => ln.keys.forEach((k, i) => {
    let arr = index.get(k);
    if (!arr) index.set(k, (arr = []));
    arr.push({ li, k: i });
  }));

  const pos = E.newPos();
  const ex = { color, lines, index, pos, key: E.key(pos), moves: [], sans: [], last: null,
               phase: "explore", path: null, pathIdx: 0, testLis: [], switched: false, colls: collections };
  enterTestIfUnique(ex);
  return ex;
}

/** Moves played next from a position by any line: Map(uci -> [line indexes]). */
function nextAt(ex, key) {
  const groups = new Map();
  for (const e of ex.index.get(key) || []) {
    const mv = ex.lines[e.li].moves;
    if (e.k >= mv.length) continue;
    const ln = ex.lines[e.li];
    if (e.k < mv.length && ln.keys[mv.length] === key) continue;   // this line finishes right here (a repeated position): it ends on first arrival
    if (!groups.has(mv[e.k])) groups.set(mv[e.k], []);
    const g = groups.get(mv[e.k]);
    if (!g.includes(e.li)) g.push(e.li);
  }
  return groups;
}

/** Walk the position graph from here. unique = it never branches before the lines end. */
function uniquePath(ex) {
  const pos = ex.pos.clone(), path = [], lis = new Set(), seen = new Set();
  let key = ex.key;
  while (!seen.has(key)) {
    seen.add(key);
    const next = nextAt(ex, key);
    if (next.size === 0) return { unique: true, path, lis: [...lis] };
    if (next.size > 1) return { unique: false };
    const [[u, who]] = next;
    who.forEach((li) => lis.add(li));
    path.push(u);
    E.play(pos, u);
    key = E.key(pos);
  }
  return { unique: false };           // a repeated position: never treat a loop as one line
}

function enterTestIfUnique(ex) {
  if (ex.phase !== "explore" || ex.lib) return;
  const u = uniquePath(ex);
  if (u.unique && u.path.length) {
    ex.phase = "test"; ex.path = u.path; ex.pathIdx = 0; ex.testLis = u.lis; ex.switched = true;
  }
}

function apply(ex, uci) {
  const san = E.play(ex.pos, uci);
  ex.moves.push(uci); ex.sans.push(san); ex.last = uci; ex.key = E.key(ex.pos);
  if (ex.phase === "test") ex.pathIdx++;
  else enterTestIfUnique(ex);
  return san;
}

/** The moves available here: [{ uci, san, from, to, count, names }], most-used first. */
export function options(ex) {
  if (ex.lib) {                                         // game library: every move played here, with its results
    return L.movesAt(ex.lib, L.hashKey(ex.key)).filter((m) => m.n >= ex.minGames).map((m) => {
      const san = E.play(ex.pos.clone(), m.uci);
      return { uci: m.uci, san, from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), count: m.n, names: [], res: { w: m.w, d: m.d, b: m.b } };
    });
  }
  const make = (uci, lis) => {
    const san = E.play(ex.pos.clone(), uci);
    const res = { w: 0, d: 0, b: 0 };
    for (const li of lis) { const r = ex.lines[li].result; if (r === "1-0") res.w++; else if (r === "0-1") res.b++; else if (r) res.d++; }
    return { uci, san, from: uci.slice(0, 2), to: uci.slice(2, 4), count: lis.length,
             names: lis.map((li) => ex.lines[li].name), res: res.w + res.d + res.b ? res : null };
  };
  if (ex.phase === "test") {
    const u = ex.path[ex.pathIdx];
    return u ? [make(u, ex.testLis)] : [];
  }
  return [...nextAt(ex, ex.key)].map(([u, lis]) => make(u, lis)).sort((a, b) => b.count - a.count || a.san.localeCompare(b.san));
}

/** "done" (no moves left) | "user" (your move) | "auto" (one opponent move) | "choose" (several opponent moves). */
export function turn(ex) {
  const opts = options(ex);
  if (!opts.length) return "done";
  if (ex.pos.turn === ex.color) return "user";
  return opts.length === 1 ? "auto" : "choose";
}

/** How many lines still continue from here (explore phase) */
export function linesLeft(ex) {
  if (ex.lib) return L.gamesAt(ex.lib, L.hashKey(ex.key));
  if (ex.phase === "test") return ex.testLis.length;
  return new Set((ex.index.get(ex.key) || []).filter((e) => e.k < ex.lines[e.li].moves.length).map((e) => e.li)).size;
}

/** Check and play the user's drag. Wrong moves reveal nothing. */
export function userMove(ex, from, to) {
  if (ex.pos.turn !== ex.color) return { error: "It isn't your move." };
  const cands = E.legalFromTo(ex.pos, from, to);
  if (!cands.length) return { error: "Illegal move." };
  const opts = options(ex);
  const hit = cands.find((u) => opts.some((o) => o.uci === u));
  if (!hit) return { correct: false };
  const wasTest = ex.phase === "test";
  const san = apply(ex, hit);
  return { correct: true, uci: hit, san, wasTest };
}

/** Play the opponent's only move. */
export function autoReply(ex) {
  const opts = options(ex);
  if (ex.pos.turn === ex.color || opts.length !== 1) return null;
  return { uci: opts[0].uci, san: apply(ex, opts[0].uci) };
}

/** The user picks which opponent move to play. */
export function choose(ex, uci) {
  const opts = options(ex);
  if (ex.pos.turn === ex.color || !opts.some((o) => o.uci === uci)) return null;
  return { uci, san: apply(ex, uci) };
}

export function chooseRandom(ex) {
  const opts = options(ex);
  if (ex.pos.turn === ex.color || !opts.length) return null;
  if (ex.lib) {                                          // weighted by how often each reply was played
    let r = Math.random() * opts.reduce((a, o) => a + o.count, 0);
    for (const o of opts) { r -= o.count; if (r <= 0) return choose(ex, o.uci); }
  }
  return choose(ex, opts[Math.floor(Math.random() * opts.length)].uci);
}

/** The arrow for Hint (test phase only; in the explore phase every option is already shown). */
export function hint(ex) {
  if (ex.phase !== "test" || ex.pos.turn !== ex.color) return null;
  const [o] = options(ex);
  return o || null;
}

/** Names of the lines that finish at the current position. */
export function endedLines(ex) {
  if (ex.lib) return [];
  return (ex.index.get(ex.key) || []).filter((e) => e.k === ex.lines[e.li].moves.length).map((e) => ({ name: ex.lines[e.li].name, coll: ex.lines[e.li].coll, result: ex.lines[e.li].result }));
}

/** Name(s) of the line(s) being tested. */
export function testLineName(ex) {
  const names = [...new Set(ex.testLis.map((li) => ex.lines[li].name))];
  return names.length > 2 ? `${names[0]} (+${names.length - 1} similar)` : names.join(" / ");
}

/** An explorer over a game library (see library.js). minGames hides moves played in fewer games. */
export function createLib(lib, color, minGames = 1) {
  const pos = E.newPos();
  const ex = { color, lib, minGames, lines: [], index: new Map(), pos, key: E.key(pos), moves: [], sans: [], last: null,
               phase: "explore", path: null, pathIdx: 0, testLis: [], switched: false };
  if (!options(ex).length) throw new Error("There are no games in this library for the chosen settings.");
  return ex;
}

/** Rebuild an explorer at an earlier point by replaying moves (used for Back). */
export function rebuild(ex, moves) {
  const nx = ex.lib ? createLib(ex.lib, ex.color, ex.minGames) : create(ex.colls, ex.color);
  for (const u of moves) apply(nx, u);
  return nx;
}

export function replay(collections, color, moves) {
  const ex = create(collections, color);
  for (const u of moves) apply(ex, u);
  return ex;
}

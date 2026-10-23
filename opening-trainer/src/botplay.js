// Chess playing for the tournament hall: the game record, the weak "silly" engines, a tiny search engine and opening books.
// Pure logic on top of chessops (no DOM). Stockfish lives in sfengine.js; everything here is cheap enough for the main thread.
import { Chess } from "chessops/chess";
import { parseUci, squareRank, parseSquare } from "chessops/util";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { chessgroundDests } from "chessops/compat";

export const MAX_PLIES = 300;                          // a game that goes on this long is adjudicated a draw

const VAL = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };
const isRank = (sq, r) => squareRank(parseSquare(sq)) === r;

/** All legal moves as standard UCI strings (castling as e1g1, promotions to a queen). */
export function legalUcis(pos) {
  const out = [];
  for (const [from, tos] of chessgroundDests(pos)) {
    const piece = pos.board.get(parseSquare(from));
    for (const to of tos) {
      if (piece.role === "king") {                     // chessops offers castling twice (king to g1 and king takes rook): keep the g1 form
        const t = pos.board.get(parseSquare(to));
        if (t && t.color === piece.color) continue;
      }
      if (piece.role === "pawn" && (isRank(to, 0) || isRank(to, 7))) out.push(from + to + "q");
      else out.push(from + to);
    }
  }
  return out;
}

const play = (pos, uci) => { const q = pos.clone(); q.play(parseUci(uci)); return q; };
const victim = (pos, uci) => {                         // value of what the move captures (en passant counts as a pawn)
  const t = pos.board.get(parseSquare(uci.slice(2, 4)));
  if (t) return VAL[t.role];
  const mover = pos.board.get(parseSquare(uci.slice(0, 2)));
  return mover && mover.role === "pawn" && uci[0] !== uci[2] ? VAL.pawn : 0;
};

// ------------------------------------------------------------------ evaluation (centipawns, from White's point of view)
const centre = (sq) => { const f = sq & 7, r = sq >> 3; return 3 - Math.max(Math.abs(f - 3.5) - 0.5, Math.abs(r - 3.5) - 0.5); };   // 0 at the rim .. 3 in the middle
export function evaluate(pos) {
  let s = 0;
  for (const [sq, p] of pos.board) {
    let v = VAL[p.role];
    const rank = p.color === "white" ? sq >> 3 : 7 - (sq >> 3);
    if (p.role === "pawn") v += rank * 6 + centre(sq) * 3;
    else if (p.role === "knight" || p.role === "bishop") v += centre(sq) * 7;
    else if (p.role === "queen") v += centre(sq);
    else if (p.role === "king") v += rank === 0 ? 8 : -rank * 4;               // keep the king at home
    s += p.color === "white" ? v : -v;
  }
  return s;
}

// ------------------------------------------------------------------ the game record
const posKey = (pos) => makeFen(pos.toSetup(), { epd: true });

export function newGame(fen) {
  const pos = Chess.default();
  return { pos, ucis: [], reps: new Map([[posKey(pos), 1]]), over: null };
}

/** Play a UCI move. Returns false (and changes nothing) if it is illegal. */
export function applyMove(game, uci) {
  const m = parseUci(uci);
  if (!m || !game.pos.isLegal(m)) return false;
  game.pos.play(m); game.ucis.push(uci);
  const k = posKey(game.pos); game.reps.set(k, (game.reps.get(k) || 0) + 1);
  return true;
}

/** null while the game goes on, else { score: 1 | 0.5 | 0 (for White), reason } */
export function gameResult(game) {
  const pos = game.pos;
  if (pos.isCheckmate()) return { score: pos.turn === "white" ? 0 : 1, reason: "checkmate" };
  if (pos.isStalemate()) return { score: 0.5, reason: "stalemate" };
  if (pos.isInsufficientMaterial()) return { score: 0.5, reason: "insufficient material" };
  if (pos.halfmoves >= 100) return { score: 0.5, reason: "50-move rule" };
  if ((game.reps.get(posKey(pos)) || 0) >= 3) return { score: 0.5, reason: "repetition" };
  if (game.ucis.length >= MAX_PLIES) return { score: 0.5, reason: "move limit" };
  return null;
}

// ------------------------------------------------------------------ the silly engines
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
const givesMate = (pos, uci) => play(pos, uci).isCheckmate();
const givesCheck = (pos, uci) => play(pos, uci).isCheck();
const sanOf = (pos, uci) => makeSan(pos, parseUci(uci));

/**
 * cfg.style: "alphaFirst" | "alphaLast" | "random" | "pacifist" | "greedy" | "checker" | "search"
 * Everybody, however silly, plays a checkmate in one when it is there.
 */
export function pickJs(pos, cfg, rng = Math.random) {
  const moves = legalUcis(pos);
  if (!moves.length) return null;
  if (cfg.mate1 !== false) for (const m of moves) if (givesMate(pos, m)) return m;
  switch (cfg.style) {
    case "alphaFirst": case "alphaLast": {
      const sorted = moves.map((m) => [sanOf(pos, m), m]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return (cfg.style === "alphaFirst" ? sorted[0] : sorted[sorted.length - 1])[1];
    }
    case "pacifist": { const calm = moves.filter((m) => !victim(pos, m)); return pick(calm.length ? calm : moves, rng); }
    case "greedy": {
      let best = 0, top = [];
      for (const m of moves) { const v = victim(pos, m); if (v > best) { best = v; top = [m]; } else if (v === best && v > 0) top.push(m); }
      return top.length ? pick(top, rng) : pick(moves, rng);
    }
    case "checker": {
      const checks = moves.filter((m) => givesCheck(pos, m));
      if (checks.length) return pick(checks, rng);
      const caps = moves.filter((m) => victim(pos, m));
      return pick(caps.length ? caps : moves, rng);
    }
    case "search": return search(pos, moves, cfg, rng);
    default: return pick(moves, rng);
  }
}

// ------------------------------------------------------------------ a small alpha-beta searcher
const MATE = 100000;
function search(pos, moves, cfg, rng) {
  const depth = cfg.depth || 1, noise = cfg.noise || 0, budget = { n: cfg.nodes || 4000 };
  const sign = pos.turn === "white" ? 1 : -1;
  const ordered = orderMoves(pos, moves);
  let best = null, bestScore = -Infinity;
  for (const m of ordered) {
    const q = play(pos, m);
    const s = -negamax(q, depth - 1, -Infinity, Infinity, -sign, budget, 0, cfg.quiet || 0) + (noise ? (rng() - 0.5) * 2 * noise : 0);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}
function orderMoves(pos, moves) {
  return moves.map((m) => [victim(pos, m) + (m.length === 5 ? 800 : 0), m]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}
// Score from the point of view of the side to move in `pos` (colour = +1 for White, -1 for Black).
function negamax(pos, depth, alpha, beta, colour, budget, ply, quiet) {
  if (pos.isCheckmate()) return -MATE + ply;
  if (pos.isStalemate() || pos.isInsufficientMaterial()) return 0;
  if (depth <= 0) return quiet > 0 ? quiesce(pos, alpha, beta, colour, budget, quiet) : colour * evaluate(pos);
  if (budget.n <= 0) return colour * evaluate(pos);
  const moves = orderMoves(pos, legalUcis(pos));
  let best = -Infinity;
  for (const m of moves) {
    budget.n--;
    const s = -negamax(play(pos, m), depth - 1, -beta, -alpha, -colour, budget, ply + 1, quiet);
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function quiesce(pos, alpha, beta, colour, budget, left) {
  const stand = colour * evaluate(pos);
  if (left <= 0 || budget.n <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const caps = legalUcis(pos).filter((m) => victim(pos, m) > 0).map((m) => [victim(pos, m), m]).sort((a, b) => b[0] - a[0]);
  for (const [, m] of caps) {
    budget.n--;
    const s = -quiesce(play(pos, m), -beta, -alpha, -colour, budget, left - 1);
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

// ------------------------------------------------------------------ opening books
/** Lines are SAN strings like "1. e4 e5 2. Nf3 Nc6" (move numbers optional). Returns { ok, ucis } or { ok:false, error }. */
export function parseLine(text) {
  const toks = String(text || "").replace(/\{[^}]*\}/g, " ").replace(/\d+\s*\.(\.\.)?/g, " ").split(/\s+/).filter(Boolean);
  if (!toks.length) return { ok: false, error: "That line is empty." };
  const pos = Chess.default(), ucis = [];
  for (const t of toks) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) break;
    let mv = null;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) { const u = parseUci(t); if (u && pos.isLegal(u)) mv = u; }
    if (!mv) mv = parseSan(pos, t.replace(/[!?]+$/, ""));
    if (!mv) return { ok: false, error: `“${t}” isn't a legal move there.` };
    const uci = mvToUci(pos, mv); ucis.push(uci); pos.play(mv);
  }
  return { ok: true, ucis };
}
function mvToUci(pos, mv) {
  const p = pos.board.get(mv.from);
  if (p && p.role === "king" && Math.abs((mv.to & 7) - (mv.from & 7)) > 1) {         // castling written king-takes-rook by chessops
    const file = (mv.to & 7) > (mv.from & 7) ? 6 : 2, rank = mv.from >> 3;
    return sq(mv.from) + sq(rank * 8 + file);
  }
  return sq(mv.from) + sq(mv.to) + (mv.promotion ? { queen: "q", rook: "r", bishop: "b", knight: "n" }[mv.promotion] : "");
}
const sq = (n) => "abcdefgh"[n & 7] + (1 + (n >> 3));

/** Turn UCI back into a "1. e4 e5 2. Nf3" string for display. */
export function lineToSan(ucis) {
  const pos = Chess.default(), out = [];
  for (const u of ucis) {
    const m = parseUci(u);
    if (!m || !pos.isLegal(m)) break;
    const s = makeSan(pos, m); pos.play(m);
    out.push(pos.turn === "black" ? `${Math.floor(out.length / 2) + 1}. ${s}` : s);
  }
  return out.join(" ");
}

/**
 * The book move for the side to move, if some line of this colour's book still matches the game so far.
 * book = { white: [[uci...]], black: [[uci...]] } (each line starts at the beginning of the game).
 */
export function bookMove(book, ucis, color, rng = Math.random) {
  if (!book) return null;
  const lines = book[color] || [], n = ucis.length, options = [];
  for (const l of lines) {
    if (l.length <= n) continue;
    let ok = true;
    for (let i = 0; i < n; i++) if (l[i] !== ucis[i]) { ok = false; break; }
    if (ok) options.push(l[n]);
  }
  return options.length ? pick(options, rng) : null;
}

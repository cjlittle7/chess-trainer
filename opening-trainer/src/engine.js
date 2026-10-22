// Chess rules helpers on top of chessops. All moves are stored as standard UCI (castling = e1g1).
// A line may carry a custom starting position (a FEN); without one it starts from the standard position.
import { Chess, castlingSide } from "chessops/chess";
import { parseUci, makeUci, parseSquare, squareRank, kingCastlesTo } from "chessops/util";
import { makeSanAndPlay } from "chessops/san";
import { makeFen, parseFen } from "chessops/fen";
import { chessgroundDests } from "chessops/compat";

export const START_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
export const START_FEN = `${START_BOARD} w KQkq - 0 1`;
export const EMPTY_BOARD = "8/8/8/8/8/8/8/8";

/** A position from a FEN (throws a plain-English Error if it can't be used), or the standard position. */
export function newPos(start) {
  if (!start) return Chess.default();
  const parsed = parseFen(start);
  if (parsed.isErr) throw new Error("That isn't a valid FEN.");
  const res = Chess.fromSetup(parsed.unwrap());
  if (res.isErr) throw new Error(explain(res.error));
  return res.unwrap();
}

function explain(err) {
  const m = String(err && err.message);
  if (m.includes("ERR_EMPTY")) return "The board is empty.";
  if (m.includes("ERR_KINGS")) return "Each side needs exactly one king.";
  if (m.includes("ERR_PAWNS_ON_BACKRANK")) return "Pawns can't stand on the first or last rank.";
  if (m.includes("ERR_OPPOSITE_CHECK")) return "The side that is not to move is in check. Change whose turn it is, or move a piece.";
  return "That isn't a legal chess position.";
}

/** Check a FEN for use as a starting position -> { ok:true, fen } or { ok:false, error }. */
export function validateStart(fen) {
  try {
    const pos = newPos(fen);
    if (!pos.hasDests()) return { ok: false, error: "This position has no legal moves (checkmate or stalemate)." };
    return { ok: true, fen: makeFen(pos.toSetup()) };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Normalise a start: undefined for the standard position, otherwise a clean full FEN. Throws if unusable. */
export function normalizeStart(start) {
  if (!start) return undefined;
  const pos = newPos(start);
  return key(pos) === key(Chess.default()) ? undefined : makeFen(pos.toSetup());
}

/** Position identity for transpositions: placement, side to move, castling, en passant. */
export const key = (pos) => makeFen(pos.toSetup(), { epd: true });
export const startKey = (start) => (start ? key(newPos(start)) : "standard");

/** "white" / "black": who moves first from a start (white for the standard position). */
export const sideToMove = (start) => (start && start.split(" ")[1] === "b" ? "black" : "white");

/** Play a UCI move, return its SAN. Throws if illegal. */
export function play(pos, uci) {
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) throw new Error(`Illegal move: ${uci}`);
  return makeSanAndPlay(pos, move);
}

/** Replay a list of UCI moves from the start (or a custom start). -> { pos, sans } */
export function replay(ucis, start) {
  const pos = newPos(start), sans = [];
  for (const u of ucis) sans.push(play(pos, u));
  return { pos, sans };
}

/** What Chessground needs to draw a position and allow legal drags. */
export function view(pos, lastUci) {
  return {
    fen: makeFen(pos.toSetup()),
    turn: pos.turn,
    dests: chessgroundDests(pos),
    check: pos.isCheck(),
    lastMove: lastUci ? [lastUci.slice(0, 2), lastUci.slice(2, 4)] : undefined,
  };
}

/** Legal UCI moves for a drag from->to (several when a pawn promotes). */
export function legalFromTo(pos, from, to) {
  if (!chessgroundDests(pos).get(from)?.includes(to)) return [];
  const rank = squareRank(parseSquare(to));
  if (pos.board.getRole(parseSquare(from)) === "pawn" && (rank === 0 || rank === 7))
    return ["q", "r", "b", "n"].map((p) => from + to + p);
  return [from + to];
}

/** UCI for a move produced by chessops' parseSan (which encodes castling as king-takes-rook). */
export function standardUci(pos, move) {
  const side = castlingSide(pos, move);
  return side ? makeUci({ from: move.from, to: kingCastlesTo(pos.turn, side) }) : makeUci(move);
}

/** "1. e4 e5 2. Nf3", or "23... Qxh7+ 24. Rxh7" when the line starts with Black to move from a custom position. */
export function sanLine(sans, start) {
  let num = 1, blackFirst = false;
  if (start) {
    const f = start.split(" ");
    blackFirst = f[1] === "b";
    num = parseInt(f[5], 10) || 1;
  }
  return sans.map((s, i) => {
    const whiteMove = blackFirst ? i % 2 === 1 : i % 2 === 0;
    const n = blackFirst ? num + Math.floor((i + 1) / 2) : num + Math.floor(i / 2);
    if (whiteMove) return `${n}. ${s}`;
    return i === 0 ? `${n}... ${s}` : s;
  }).join(" ");
}

/** Move number label for the editor list: [number-label | null] for ply i. */
export function plyLabel(i, start) {
  let num = 1, blackFirst = false;
  if (start) { const f = start.split(" "); blackFirst = f[1] === "b"; num = parseInt(f[5], 10) || 1; }
  const whiteMove = blackFirst ? i % 2 === 1 : i % 2 === 0;
  const n = blackFirst ? num + Math.floor((i + 1) / 2) : num + Math.floor(i / 2);
  if (whiteMove) return `${n}.`;
  return i === 0 ? `${n}...` : null;
}

/** Which castling rights a board can have: { K, Q, k, q } booleans (king and rook on their home squares). */
export function castlingAvailable(boardFen) {
  const rows = boardFen.split("/");
  const expand = (r) => r.replace(/\d/g, (d) => ".".repeat(Number(d)));
  if (rows.length !== 8) return { K: false, Q: false, k: false, q: false };
  const r8 = expand(rows[0]), r1 = expand(rows[7]);
  return { K: r1[4] === "K" && r1[7] === "R", Q: r1[4] === "K" && r1[0] === "R",
           k: r8[4] === "k" && r8[7] === "r", q: r8[4] === "k" && r8[0] === "r" };
}

/** Full FEN of the position after the first `ply` moves of a line (used to start a puzzle from an opening line). */
export function fenAfter(ucis, ply, start) {
  const { pos } = replay(ucis.slice(0, ply), start);
  return makeFen(pos.toSetup());
}

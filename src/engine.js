// Chess rules helpers on top of chessops. All moves are stored as standard UCI (castling = e1g1).
import { Chess, castlingSide } from "chessops/chess";
import { parseUci, makeUci, parseSquare, squareRank, kingCastlesTo } from "chessops/util";
import { makeSanAndPlay } from "chessops/san";
import { makeFen } from "chessops/fen";
import { chessgroundDests } from "chessops/compat";

export const START_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
export const newPos = () => Chess.default();

/** Position identity for transpositions: placement, side to move, castling, en passant. */
export const key = (pos) => makeFen(pos.toSetup(), { epd: true });

/** Play a UCI move, return its SAN. Throws if illegal. */
export function play(pos, uci) {
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) throw new Error(`Illegal move: ${uci}`);
  return makeSanAndPlay(pos, move);
}

/** Replay a list of UCI moves from the start. -> { pos, sans } */
export function replay(ucis) {
  const pos = newPos(), sans = [];
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
  const t = parseSquare(to);
  const rank = squareRank(t);
  if (pos.board.getRole(parseSquare(from)) === "pawn" && (rank === 0 || rank === 7))
    return ["q", "r", "b", "n"].map((p) => from + to + p);
  return [from + to];
}

/** UCI for a move produced by chessops' parseSan (which encodes castling as king-takes-rook). */
export function standardUci(pos, move) {
  const side = castlingSide(pos, move);
  return side ? makeUci({ from: move.from, to: kingCastlesTo(pos.turn, side) }) : makeUci(move);
}

/** "1. e4 e5 2. Nf3" from a list of SANs. */
export const sanLine = (sans) => sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");

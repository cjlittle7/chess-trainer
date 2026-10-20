// Training logic (no DOM): the same rules the Flask version applied on the server.
import * as E from "./engine.js";
import * as S from "./store.js";

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const options = (c, pos) => S.book(c).get(E.key(pos)) || new Map();      // Map(uci -> san)
const userToMove = (t) => (t.moves.length % 2 === 0) === (t.color === "white");

function finished(c, t, pos) {
  return t.mode === "line" ? t.moves.length >= t.line.moves.length : options(c, pos).size === 0;
}

/** Start a specific line, or (line = null) a random walk through the collection. */
export function begin(c, line = null) {
  const t = { mode: line ? "line" : "random", color: c.color, line, moves: [] };
  const pos = E.newPos();
  let opponent = null;
  if (!userToMove(t)) {                                    // you play Black: White opens
    const uci = line ? line.moves[0] : pick([...options(c, pos).keys()]);
    if (uci) { const san = E.play(pos, uci); t.moves.push(uci); opponent = { uci, san }; }
  }
  return { t, orientation: c.color, start: E.view(E.newPos()), opponent,
           position: E.view(pos, opponent?.uci), finished: finished(c, t, pos) };
}

/** Check the user's drag. Wrong moves reveal nothing about the right answer. */
export function checkMove(c, t, from, to) {
  const { pos } = E.replay(t.moves);
  const cands = E.legalFromTo(pos, from, to);
  if (!cands.length) return { error: "Illegal move." };
  const opts = options(c, pos);
  const matched = t.mode === "line" ? cands.find((u) => u === t.line.moves[t.moves.length]) : cands.find((u) => opts.has(u));
  if (!matched) return { correct: false, inRepertoire: t.mode === "line" && cands.some((u) => opts.has(u)) };

  const san = E.play(pos, matched);
  t.moves.push(matched);
  const afterUser = E.view(pos, matched);
  const reply = t.mode === "line" ? t.line.moves[t.moves.length] : (() => { const k = [...options(c, pos).keys()]; return k.length ? pick(k) : null; })();
  let opponent = null;
  if (reply) { opponent = { uci: reply, san: E.play(pos, reply) }; t.moves.push(reply); }
  return { correct: true, san, afterUser, opponent,
           finished: !reply || finished(c, t, pos), position: E.view(pos, reply || matched) };
}

/** Only called when the user presses Hint. */
export function hint(c, t) {
  const { pos } = E.replay(t.moves);
  let uci, san, alternatives = 0;
  if (t.mode === "line") {
    uci = t.line.moves[t.moves.length];
    if (!uci) return { error: "No move to hint." };
    san = E.replay(t.moves.concat(uci)).sans.slice(-1)[0];
  } else {
    const opts = [...options(c, pos)];
    if (!opts.length) return { error: "No book move here." };
    [uci, san] = opts[0];
    alternatives = opts.length - 1;
  }
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), san, alternatives };
}

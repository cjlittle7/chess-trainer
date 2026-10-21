import { Chessground } from "@lichess-org/chessground";
import { parseFen } from "chessops/fen";
import * as E from "./engine.js";
import * as S from "./store.js";
import * as T from "./trainer.js";
import * as X from "./explorer.js";

const VERSION = "1.6.0";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How quickly the opponent replies: pause before the reply, and move animation length (ms).
const SPEEDS = { normal: { delay: 550, anim: 220 }, fast: { delay: 150, anim: 110 }, instant: { delay: 0, anim: 0 } };
let speed = "fast";
try { const saved = localStorage.getItem("opponentSpeed"); if (SPEEDS[saved]) speed = saved; } catch { /* storage unavailable */ }
function applySpeed(name) {
  speed = SPEEDS[name] ? name : "fast";
  $("speedSel").value = speed;
  ground.set({ animation: { enabled: SPEEDS[speed].anim > 0, duration: SPEEDS[speed].anim || 1 } });
  try { localStorage.setItem("opponentSpeed", speed); } catch { /* ignore */ }
}

let ground;
let state = null;      // the line being drilled: { t (trainer state), c, busy, active, missedHere, stats, view, lineId, name }
let session = null;    // { queue:[lineIds], i, results:[] } when practicing in sequence
let editor = null;     // the line being recorded: { moves, redo, sans, view, pending, lineId, start }
let explorer = null;   // the opening explorer: { ex, colls, side, ids, busy, active, stats, missedHere }
let setup = null;      // the position being set up: { tool, castle, turn, fullmove, carry, valid }

const coll = () => S.collection(Number($("repSelect").value));
const setStatus = (msg, cls = "") => { const s = $("status"); s.textContent = msg; s.className = cls; };
const setProgress = (msg) => { $("progress").textContent = msg; };

// ------------------------------------------------------------------ board
function showPosition(v, { interactive }) {
  ground.setAutoShapes([]);
  ground.set({
    fen: v.fen, turnColor: v.turn, check: v.check, lastMove: v.lastMove,
    movable: { color: interactive ? v.turn : undefined, dests: interactive ? v.dests : new Map() },
  });
}

function initBoard() {
  ground = Chessground($("board"), {
    fen: E.START_BOARD,
    animation: { duration: 220 },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    movable: { free: false, showDests: true, color: undefined, events: { after: onUserMove } },
    highlight: { lastMove: true, check: true },
  });
  if (location.hash === "#debug") window.__ground = ground;   // lets automated tests inspect the board
}

function onUserMove(from, to) {
  if (setup) return;                         // free piece moves while setting up a position
  if (editor) return onEditorMove(from, to);
  if (explorer) return onExplorerMove(from, to);
  return onTrainMove(from, to);
}

// ------------------------------------------------------- starting training
async function launch(c, line) {
  exHide();
  hideResult();
  const b = T.begin(c, line);
  const st = state = { t: b.t, c, busy: true, active: true, missedHere: false, view: b.start,
                       stats: { moves: 0, first: 0, wrong: 0, hints: 0 }, lineId: line?.id, name: line?.name };
  ground.set({ orientation: b.orientation });
  showPosition(b.start, { interactive: false });
  if (b.opponent) { await sleep(SPEEDS[speed].delay); if (state !== st) return; }      // you play Black: White opens
  st.view = b.position;
  showPosition(b.position, { interactive: !b.finished });
  st.busy = false;
  $("hintBtn").disabled = false;
  $("skipBtn").disabled = !session;
  setStatus(b.t.start ? `Puzzle: find the best move for ${b.t.color}.` : `Your move (${b.t.color}).`);
  if (b.finished) finishLine();
}

function startRandom() {
  const c = coll();
  if (!c || !c.lines.length) return setStatus("This collection has no lines yet.", "bad");
  if (!c.lines.some((l) => !l.start)) return setStatus("This collection only has puzzles. Use \"Practice all lines in order\" instead.", "bad");
  session = null;
  setProgress("Random drill: a random path through the collection");
  return launch(c, null);
}

async function beginSessionLine() {
  const c = coll();
  const line = c?.lines.find((l) => l.id === session.queue[session.i]);
  if (!line) return nextLine();
  setProgress(`Line ${session.i + 1} of ${session.queue.length}: ${line.name}`);
  await launch(c, line);
}

async function startSession(ids) {
  if (!ids.length) return setStatus("There are no lines to practice in this collection yet.", "bad");
  session = { queue: ids, i: 0, results: [], recorded: new Set() };   // recorded: which lines already have a result (retries don't count twice)
  await beginSessionLine();
}

function practiceAll() {
  const c = coll();
  const ids = c ? c.lines.map((l) => l.id) : [];
  if ($("shuffleChk").checked) for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return startSession(ids);
}

// ----------------------------------------------------------------- playing
async function onTrainMove(from, to) {
  const st = state;
  if (!st || !st.active || st.busy) return;
  st.busy = true;
  const res = T.checkMove(st.c, st.t, from, to);

  if (res.error) { showPosition(st.view, { interactive: true }); st.busy = false; return; }
  if (!res.correct) {                                  // wrong: snap back, reveal nothing
    st.stats.wrong++; st.missedHere = true;
    showPosition(st.view, { interactive: true });
    setStatus(res.inRepertoire
      ? "That's in your collection, but it isn't the move for this line. Try again, or press Hint."
      : "Not the book move. Try again, or press Hint.", "bad");
    st.busy = false; return;
  }

  st.stats.moves++;
  if (!st.missedHere) st.stats.first++;
  st.missedHere = false;
  setStatus(`Correct: ${res.san}`, "good");
  showPosition(res.afterUser, { interactive: false });
  if (res.opponent) {
    await sleep(SPEEDS[speed].delay);
    if (state !== st) return;
  }
  st.view = res.position;
  showPosition(res.position, { interactive: !res.finished });
  st.busy = false;
  if (res.finished) finishLine();
}

function hint() {
  if (explorer) return exHint();
  const st = state;
  if (!st?.active || st.busy) return;
  const res = T.hint(st.c, st.t);
  if (res.error) return setStatus(res.error, "bad");
  st.stats.hints++;
  ground.setAutoShapes([{ orig: res.from, dest: res.to, brush: "green" }]);
  setStatus(res.alternatives ? `Hint: ${res.san} (one of ${res.alternatives + 1} book moves)` : `Hint: ${res.san}`);
}

// ------------------------------------------------------------------ results
function lockBoard() {
  $("hintBtn").disabled = true; $("skipBtn").disabled = true;
  ground.set({ movable: { color: undefined, dests: new Map() } });
}
function hideResult() { const r = $("result"); r.classList.add("hidden"); r.innerHTML = ""; }
function showResult(html) { const r = $("result"); r.innerHTML = html; r.classList.remove("hidden"); }

function finishLine() {
  state.active = false;
  lockBoard();
  const s = state.stats;
  const table = `<table class="stats">
      <tr><td>Your moves</td><td>${s.moves}</td></tr>
      <tr><td>Correct on first try</td><td>${s.first}</td></tr>
      <tr><td>Wrong attempts</td><td>${s.wrong}</td></tr>
      <tr><td>Hints used</td><td>${s.hints}</td></tr></table>`;
  setStatus("End of the line. Well done!", "good");
  if (!session) {
    showResult(`<h2>Line complete</h2>${table}<button id="nextBtn">Drill again</button>`);
    $("nextBtn").onclick = startRandom;
    return;
  }
  if (!session.recorded.has(session.i)) {            // the first attempt is what the final results show
    session.recorded.add(session.i);
    session.results.push({ lineId: state.lineId, name: state.name, ...s, skipped: false });
  }
  const single = session.queue.length === 1;
  const last = session.i === session.queue.length - 1;
  showResult(`<h2>Line complete</h2>${table}<div class="row"><button id="nextBtn">${
      single ? "Practice again" : last ? "See collection results" : "Next line →"}</button>${
      single ? "" : '<button id="retryLineBtn" class="secondary">Retry this line</button>'}</div>`);
  $("nextBtn").onclick = single ? () => startSession(session.queue) : nextLine;
  if (!single) $("retryLineBtn").onclick = beginSessionLine;
}

function skipLine() {
  if (!state?.active || !session) return;
  state.active = false;
  lockBoard();
  session.results.push({ lineId: state.lineId, name: state.name, ...state.stats, skipped: true });
  nextLine();
}

function nextLine() {
  session.i++;
  if (session.i >= session.queue.length) return showCollectionSummary();
  return beginSessionLine();
}

function showCollectionSummary() {
  hideResult();
  const rs = session.results;
  const missed = rs.filter((r) => r.wrong || r.hints || r.skipped);
  const sum = (k) => rs.reduce((a, r) => a + r[k], 0);
  setProgress("");
  setStatus(missed.length ? `Collection finished: ${rs.length - missed.length} of ${rs.length} lines were clean.`
                          : "Collection finished with a perfect run!", "good");
  showResult(`<h2>Collection results</h2>
    <table class="stats">
      <tr><th>Line</th><th>Wrong</th><th>Hints</th></tr>
      ${rs.map((r) => `<tr><td>${esc(r.name)}${r.skipped ? ' <span class="muted">(skipped)</span>' : ""}</td>
                           <td>${r.wrong}</td><td>${r.hints}</td></tr>`).join("")}
      <tr><td><strong>Total</strong></td><td>${sum("wrong")}</td><td>${sum("hints")}</td></tr>
    </table>
    <div class="row">
      ${missed.length ? `<button id="retryBtn">Retry ${missed.length} line${missed.length > 1 ? "s" : ""} with problems</button>` : ""}
      <button id="againBtn" class="secondary">Practice all again</button>
    </div>`);
  if (missed.length) $("retryBtn").onclick = () => startSession(missed.map((r) => r.lineId));
  $("againBtn").onclick = practiceAll;
}

function resetTraining() {
  state = null; session = null; exHide();
  hideResult(); setProgress("");
  $("hintBtn").disabled = true; $("skipBtn").disabled = true;
  if (editor || setup) return;           // keep the editor's / setup board as it is
  ground.set({ fen: E.START_BOARD, lastMove: undefined, check: false, orientation: "white",
               movable: { color: undefined, dests: new Map() } });
  ground.setAutoShapes([]);
  setStatus("Choose a collection and press a practice button.");
}

// ----------------------------------------------------------- opening explorer
const exSide = () => document.querySelector('input[name="exSide"]:checked').value;
const exMsg = (t, bad = false) => { const m = $("exSetupMsg"); m.textContent = t; m.style.color = bad ? "var(--bad)" : ""; };

let exHints = true;
try { exHints = localStorage.getItem("exHints") !== "off"; } catch { /* ignore */ }

function exHide() {
  explorer = null;
  $("exPanel").classList.add("hidden");
}

function exOpenings(c) { return c.lines.filter((l) => !l.start && l.moves.length).length; }

function exRenderColls(checkedIds) {
  const side = exSide(), cs = S.collections().filter((c) => c.color === side);
  const prev = checkedIds ?? new Set([...document.querySelectorAll("#exColls input:checked")].map((i) => Number(i.value)));
  $("exColls").innerHTML = cs.length ? cs.map((c) => {
    const n = exOpenings(c);
    return `<label class="${n ? "" : "off"}"><input type="checkbox" value="${c.id}" ${n && prev.has(c.id) ? "checked" : ""} ${n ? "" : "disabled"}>
      <span>${esc(c.name)} <span class="muted">(${n} opening${n === 1 ? "" : "s"})</span></span></label>`;
  }).join("") : `<div class="muted" style="padding:8px 0">You have no collections for ${side === "white" ? "White" : "Black"} yet.</div>`;
  exUpdateStart();
}

function exUpdateStart() {
  const n = document.querySelectorAll("#exColls input:checked").length;
  $("exStart").disabled = n === 0;
  exMsg(n ? "" : "Tick at least one collection.");
}

function openExplorer() {
  if (!guardEditor()) return;
  state = null; session = null; hideResult(); setProgress("");
  $("hintBtn").disabled = true; $("skipBtn").disabled = true;
  explorer = { setupOpen: true };
  const c = coll(), side = c?.color || "white";
  document.querySelector(`input[name="exSide"][value="${side}"]`).checked = true;
  $("exSetup").classList.remove("hidden"); $("exRun").classList.add("hidden");
  $("exPanel").classList.remove("hidden");
  exRenderColls(new Set(S.collections().filter((x) => x.color === side && (!c || x.id === c.id)).map((x) => x.id)));
  ground.set({ fen: E.START_BOARD, orientation: side, lastMove: undefined, check: false, movable: { color: undefined, dests: new Map() } });
  ground.setAutoShapes([]);
  setStatus("Choose your side and which collections to explore.");
  $("exPanel").scrollIntoView?.({ block: "nearest" });
}

function exStart() {
  const ids = [...document.querySelectorAll("#exColls input:checked")].map((i) => Number(i.value));
  const side = exSide();
  const colls = S.collections().filter((c) => ids.includes(c.id));
  let ex;
  try { ex = X.create(colls, side); } catch (e) { return exMsg(e.message, true); }
  launchExplorer({ colls, side, ids, ex });
}

function launchExplorer({ colls, side, ids, ex }) {
  const stats = explorer?.stats || { explored: 0, tested: 0, first: 0, wrong: 0, hints: 0 };
  explorer = { ex, colls, side, ids, busy: true, active: true, missedHere: false, stats };
  hideResult();
  $("exSetup").classList.add("hidden"); $("exRun").classList.remove("hidden"); $("exPanel").classList.remove("hidden");
  $("hintBtn").disabled = false; $("skipBtn").disabled = true;
  ground.set({ orientation: side });
  setProgress(`Opening explorer · ${side === "white" ? "White" : "Black"} · ${colls.length} collection${colls.length === 1 ? "" : "s"}`);
  exContinue();
}

function exView() { return E.view(explorer.ex.pos, explorer.ex.last); }

/** Play the opponent's forced moves, then stop at the next decision. */
async function exContinue() {
  const st = explorer;
  if (!st) return;
  st.busy = true;
  for (;;) {
    const t = X.turn(st.ex);
    if (t === "auto") {
      exRender(false);
      await sleep(SPEEDS[speed].delay);
      if (explorer !== st) return;
      X.autoReply(st.ex);
      showPosition(exView(), { interactive: false });
      continue;
    }
    break;
  }
  st.busy = false;
  exRender(true);
}

function exRender(ready) {
  const st = explorer, ex = st.ex, t = X.turn(ex);
  const v = exView();
  const mine = t === "user";
  showPosition(v, { interactive: ready && mine });
  st.review = null;
  $("exReturn").classList.add("hidden");
  $("exMoves").innerHTML = ex.moves.length ? ex.sans.map((m, i) =>
    `${i % 2 === 0 ? `<span class="num">${i / 2 + 1}.</span> ` : ""}<span class="mv" data-i="${i}">${esc(m)}</span> `).join("") : "Starting position";
  $("exBack").disabled = ex.moves.length === 0; $("exRandom").disabled = false;
  $("exHints").innerHTML = ""; $("exChoose").classList.add("hidden");
  if (!ready) return;
  const opts = X.options(ex);
  if (t === "done") return exFinish();
  const note = ex.switched && ex.phase === "test"
    ? `Only one line is left: ${X.testLineName(ex)}. From here it tests you. ` : "";
  ex.switched = false;
  if (t === "choose") {
    setStatus(`${note}Your opponent has ${opts.length} replies in your lines. Drag one of their pieces, or use the buttons.`);
    $("exInfo").textContent = "";
    $("exChoose").classList.remove("hidden");
    $("exChoices").innerHTML = opts.map((o) => rowHtml(o, "button", ` data-uci="${o.uci}"`)).join("");
    ground.setAutoShapes(exHints ? opts.map((o) => ({ orig: o.from, dest: o.to, brush: "blue" })) : []);
    const dests = new Map();                           // drag the opponent's piece to pick its reply
    for (const o of opts) dests.set(o.from, [...(dests.get(o.from) || []), o.to]);
    ground.set({ movable: { color: v.turn, dests } });
    return;
  }
  // your move
  if (ex.phase === "test") {
    $("exInfo").textContent = `Testing: ${X.testLineName(ex)}`;
    ground.setAutoShapes([]);
    setStatus(`${note}Your move: play the book move.`);
  } else {
    const n = X.linesLeft(ex);
    if (exHints) {
      $("exInfo").textContent = `${n} line${n === 1 ? "" : "s"} continue from here. Play one of these moves:`;
      $("exHints").innerHTML = opts.map((o) => rowHtml(o, "div", "")).join("");
      ground.setAutoShapes(opts.map((o) => ({ orig: o.from, dest: o.to, brush: "green" })));
      setStatus(`${note}Your move: ${opts.length} option${opts.length === 1 ? "" : "s"} in your lines.`);
    } else {
      $("exInfo").textContent = "Hints are off.";
      ground.setAutoShapes([]);
      setStatus(`${note}Your move. Hints are off: play a move from your lines.`);
    }
  }
}

function rowHtml(o, tag, attrs) {
  if (!exHints) return `<${tag} class="exrow"${attrs}><span class="san">${esc(o.san)}</span></${tag}>`;
  const names = o.names.length > 3 ? o.names.slice(0, 3).join(", ") + ` +${o.names.length - 3}` : o.names.join(", ");
  return `<${tag} class="exrow"${attrs}><span class="san">${esc(o.san)}</span><span class="cnt">${o.count} line${o.count === 1 ? "" : "s"}</span><span class="nm">${esc(names)}</span></${tag}>`;
}

function onExplorerMove(from, to) {
  const st = explorer;
  if (!st?.active || st.busy || st.review != null) return;
  if (X.turn(st.ex) === "choose") {                    // dragging an opponent piece chooses its reply
    const o = X.options(st.ex).find((x) => x.from === from && x.to === to);
    if (!o) return exRender(true);
    return exChoose(o.uci);
  }
  const wasTest = st.ex.phase === "test";
  const res = X.userMove(st.ex, from, to);
  if (res.error) return showPosition(exView(), { interactive: true }), exShapes();
  if (!res.correct) {
    st.stats.wrong++; st.missedHere = true;
    showPosition(exView(), { interactive: true }); exShapes();
    setStatus(wasTest ? "Not the book move. Try again, or press Hint."
                      : "That move isn't in your selected lines. Pick one of the highlighted moves.", "bad");
    return;
  }
  if (res.wasTest) { st.stats.tested++; if (!st.missedHere) st.stats.first++; } else st.stats.explored++;
  st.missedHere = false;
  setStatus(`Correct: ${res.san}`, "good");
  showPosition(exView(), { interactive: false });
  exContinue();
}

function exShapes() {                                  // keep the arrows on after a snap-back
  const ex = explorer.ex;
  if (exHints && ex.phase === "explore" && X.turn(ex) === "user")
    ground.setAutoShapes(X.options(ex).map((o) => ({ orig: o.from, dest: o.to, brush: "green" })));
}

function exHint() {
  const st = explorer;
  if (!st?.active || st.busy) return;
  if (st.review != null) return;
  if (!exHints && st.ex.phase === "explore" && X.turn(st.ex) === "user") {
    st.stats.hints++;
    ground.setAutoShapes(X.options(st.ex).map((o) => ({ orig: o.from, dest: o.to, brush: "green" })));
    return setStatus("Hint: the moves in your lines are shown.");
  }
  const h = X.hint(st.ex);
  if (!h) return setStatus("All your options are already shown: the arrows are the moves in your lines.");
  st.stats.hints++;
  ground.setAutoShapes([{ orig: h.from, dest: h.to, brush: "green" }]);
  setStatus(`Hint: ${h.san}`);
}

function exReview(i) {
  const st = explorer;
  if (!st?.ex || st.busy || i < 0 || i >= st.ex.moves.length) return;
  if (i === st.ex.moves.length - 1 && st.review == null) return;        // already looking at the live position
  if (i === st.ex.moves.length - 1) return exReturn();
  if (st.review == null) st.savedStatus = [$("status").textContent, $("status").className];
  st.review = i;
  const moves = st.ex.moves.slice(0, i + 1);
  const r = E.replay(moves);
  showPosition(E.view(r.pos, moves[i]), { interactive: false });
  ground.setAutoShapes([]);
  $("exMoves").querySelectorAll(".mv").forEach((m) => m.classList.toggle("cur", Number(m.dataset.i) === i));
  $("exReturn").classList.remove("hidden");
  $("exBack").disabled = true; $("exRandom").disabled = true;
  setStatus(`Viewing the position after move ${Math.floor(i / 2) + 1}${i % 2 ? "..." : "."} ${st.ex.sans[i]}. Your explorer line is saved.`);
}

function exReturn() {
  const st = explorer;
  if (!st || st.review == null) return;
  st.review = null;
  $("exReturn").classList.add("hidden");
  $("exMoves").querySelectorAll(".mv.cur").forEach((m) => m.classList.remove("cur"));
  $("exBack").disabled = st.ex.moves.length === 0; $("exRandom").disabled = false;
  if (st.active) exRender(true);
  else { showPosition(exView(), { interactive: false }); if (st.savedStatus) setStatus(...st.savedStatus); }
}

function exSetHints(on) {
  exHints = on;
  try { localStorage.setItem("exHints", on ? "on" : "off"); } catch { /* ignore */ }
  const st = explorer;
  if (st?.ex && st.active && !st.busy && st.review == null) exRender(true);
}

function exChoose(uci) {
  const st = explorer;
  if (!st?.active || st.busy || st.review != null) return;
  const r = uci ? X.choose(st.ex, uci) : X.chooseRandom(st.ex);
  if (!r) return;
  setStatus(`Opponent plays ${r.san}.`);
  showPosition(exView(), { interactive: false });
  exContinue();
}

function exBack() {
  const st = explorer;
  if (!st?.ex || st.busy || st.review != null || !st.ex.moves.length) return;
  const moves = st.ex.moves.slice();
  moves.pop();
  let ex = X.replay(st.colls, st.side, moves);
  while (moves.length && X.turn(ex) === "auto") { moves.pop(); ex = X.replay(st.colls, st.side, moves); }
  ex.switched = false;
  st.ex = ex; st.active = true; st.missedHere = false;
  hideResult();
  $("hintBtn").disabled = false;
  exContinue();
}

function exRestart() {
  const st = explorer;
  if (!st?.colls) return;
  let ex;
  try { ex = X.create(st.colls, st.side); } catch (e) { return setStatus(e.message, "bad"); }
  launchExplorer({ colls: st.colls, side: st.side, ids: st.ids, ex });
}

function exFinish() {
  const st = explorer, ex = st.ex, s = st.stats;
  st.active = false;
  lockBoard();
  ground.setAutoShapes([]);
  $("exInfo").textContent = "";
  const ended = X.endedLines(ex);
  const names = [...new Set(ended.map((e) => e.name))];
  setStatus(names.length ? `End of the line: ${names.join(" / ")}` : "End of the line.", "good");
  showResult(`<h2>Explorer: line complete</h2>
    <div class="muted" style="margin-bottom:8px">${esc(E.sanLine(ex.sans))}</div>
    <table class="stats">
      <tr><td>Moves explored</td><td>${s.explored}</td></tr>
      <tr><td>Moves tested</td><td>${s.tested}</td></tr>
      <tr><td>Tested moves right first time</td><td>${s.first}</td></tr>
      <tr><td>Wrong attempts</td><td>${s.wrong}</td></tr>
      <tr><td>Hints used</td><td>${s.hints}</td></tr></table>
    <div class="row"><button id="exAgain">Explore again</button>
      <button id="exSettings" class="secondary">Change settings</button>
      <button id="exDone" class="secondary">Close explorer</button></div>`);
  $("exAgain").onclick = () => { st.stats = { explored: 0, tested: 0, first: 0, wrong: 0, hints: 0 }; explorer = st; exRestart(); };
  $("exSettings").onclick = openExplorer;
  $("exDone").onclick = closeExplorer;
}

function closeExplorer() { exHide(); resetTraining(); }

// ------------------------------------------------------ collections & lines
const sanCache = new Map();
function lineSan(l) {
  const k = (l.start || "") + "|" + l.moves.join(" ");
  if (!sanCache.has(k)) sanCache.set(k, E.sanLine(E.replay(l.moves, l.start).sans, l.start));
  return sanCache.get(k);
}

function refresh(selectId) {
  const sel = $("repSelect"), prev = sel.value, keepTarget = $("edTarget").value;
  sel.innerHTML = S.collections().map((c) =>
    `<option value="${c.id}">${esc(c.name)} (${c.color}, ${c.lines.length} line${c.lines.length === 1 ? "" : "s"})</option>`).join("");
  if (selectId != null) sel.value = String(selectId);
  else if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  renderEditorTargets(selectId != null ? String(selectId) : keepTarget);
  renderLines();
  if (setup) renderSetupLines();
  if (explorer?.setupOpen) exRenderColls();
}

function renderLines() {
  const c = coll(), lines = c ? c.lines : [];
  $("lineCount").textContent = lines.length;
  $("lineList").innerHTML = lines.length ? lines.map((l, i) => `
    <div class="line">
      <div class="info"><div class="name">${i + 1}. ${esc(l.name)}${l.start ? `<span class="tag">Puzzle · ${E.sideToMove(l.start)} to move</span>` : ""}</div><div class="san">${esc(lineSan(l))}</div></div>
      <button class="small" data-practice="${l.id}">Practice</button>
      <button class="small secondary" data-edit="${l.id}">Edit</button>
      <button class="small danger" data-delete="${l.id}" title="Delete this line">✕</button>
    </div>`).join("") : '<span class="muted">No lines yet.</span>';
}

$("lineList").onclick = async (e) => {
  const p = e.target.closest("[data-practice]"), d = e.target.closest("[data-delete]"), ed = e.target.closest("[data-edit]");
  const c = coll();
  if (p && guardEditor()) await startSession([Number(p.dataset.practice)]);
  if (ed) {
    const l = c.lines.find((x) => x.id === Number(ed.dataset.edit));
    if (l) openEditor({ lineId: l.id, moves: l.moves, name: l.name, targetId: c.id, start: l.start });
  }
  if (d && confirm("Delete this line from the collection?")) {
    const id = Number(d.dataset.delete);
    await S.deleteLine(c.id, id);
    if (editor && editor.lineId === id) closeEditor();
    resetTraining();
    refresh(c.id);
  }
};

function importMessage(res, created) {
  $("impMsg").innerHTML = `<small>${created ? "Created" : "Updated"}: ${res.parsed} line(s) from ${res.games} game(s)` +
    `${res.errors ? `, ${res.errors} issue(s) skipped` : ""}. The collection now has ${res.total} line(s).</small>`;
}
const importError = (e) => { $("impMsg").innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; };

async function createCollection() {
  try {
    const res = await S.createCollection($("impName").value, $("impColor").value, $("impPgn").value);
    importMessage(res, true); resetTraining(); refresh(res.id);
  } catch (e) { importError(e); }
}

async function createEmpty() {
  try {
    const res = await S.createEmptyCollection($("impName").value, $("impColor").value);
    $("impMsg").innerHTML = "<small>Created an empty collection. Press \"Record a line\" to add lines to it.</small>";
    $("impName").value = "";
    resetTraining(); refresh(res.id);
  } catch (e) { importError(e); }
}

async function extendCollection() {
  const c = coll();
  if (!c) return;
  try {
    const res = await S.addPgn(c.id, $("impPgn").value);
    importMessage(res, false); resetTraining(); refresh(res.id);
  } catch (e) { importError(e); }
}

async function deleteCollection() {
  const c = coll();
  if (!c || !confirm(`Delete "${c.name}" and all its lines?`)) return;
  await S.deleteCollection(c.id);
  resetTraining();
  refresh();
}

// -------------------------------------------------------------- line editor
function guardEditor() {
  if (setup) { closeSetup(); resetTraining(); return true; }
  if (!editor) return true;
  if (editor.moves.length && !confirm("Discard the line you're recording?")) return false;
  closeEditor();
  return true;
}

function editorMsg(text, bad = false) {
  const m = $("edMsg"); m.textContent = text; m.className = text ? (bad ? "bad" : "good") : "";
}

function renderEditorTargets(selected) {
  const sel = $("edTarget"), cs = S.collections();
  sel.innerHTML = cs.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.color})</option>`).join("") +
                  '<option value="new">➕ New collection…</option>';
  sel.value = [...sel.options].some((o) => o.value === String(selected)) ? String(selected) : (cs[0] ? String(cs[0].id) : "new");
  syncEditorTarget();
}

function syncEditorTarget() {
  const v = $("edTarget").value;
  $("edNew").classList.toggle("hidden", v !== "new");
  const color = v === "new" ? $("edNewColor").value : (S.collection(Number(v))?.color || "white");
  if (editor && !editor.start) ground.set({ orientation: color });
}

function openEditor({ lineId = null, moves = [], name = "", targetId = coll()?.id, start = null, orientation } = {}) {
  if (!guardEditor()) return;
  state = null; session = null; exHide(); hideResult(); setProgress("");
  $("hintBtn").disabled = true; $("skipBtn").disabled = true;
  editor = { moves: [], redo: [], sans: [], view: null, pending: null, lineId, start: start || null };
  $("edStartRow").classList.toggle("hidden", !start);
  $("edStartLabel").textContent = start ? `Custom position · ${E.sideToMove(start) === "white" ? "White" : "Black"} to move` : "";
  $("editorPanel").classList.remove("hidden");
  $("edName").value = name;
  editorMsg("");
  renderEditorTargets(targetId);
  $("edTarget").disabled = lineId !== null;        // an edited line stays in its own collection
  $("edSave").textContent = lineId !== null ? "Save changes" : "Save line";
  if (start) ground.set({ orientation: orientation || E.sideToMove(start) });
  setStatus(lineId !== null ? "Editing a saved line. Undo or tap moves to change it."
          : start ? "Recording a puzzle: play the solution for both sides."
          : "Recording: play the moves for both sides.");
  editorSet(moves, []);
  $("editorPanel").scrollIntoView?.({ block: "nearest" });
}

function closeEditor() {
  editor = null;
  $("editorPanel").classList.add("hidden");
  $("edPromo").classList.add("hidden");
  resetTraining();
}

function editorSet(moves, redo) {
  let r;
  try { r = E.replay(moves, editor.start || undefined); } catch (e) { return editorMsg(e.message, true); }
  editor.moves = moves; editor.redo = redo; editor.sans = r.sans;
  editor.view = E.view(r.pos, moves[moves.length - 1]);
  showPosition(editor.view, { interactive: !editor.pending });
  renderMoveList();
  $("edUndo").disabled = !moves.length;
  $("edClear").disabled = !moves.length;
  $("edRedo").disabled = !redo.length;
}

function renderMoveList() {
  const box = $("edMoves"), s = editor.sans;
  if (!s.length) { box.innerHTML = '<span class="muted">No moves yet. Drag a piece on the board.</span>'; return; }
  box.innerHTML = s.map((san, i) =>
    (E.plyLabel(i, editor.start) ? `<span class="num">${E.plyLabel(i, editor.start)}</span>` : "") +
    `<span class="mv${i === s.length - 1 ? " last" : ""}" data-i="${i}" title="Delete this move and everything after it">${esc(san)}</span>`
  ).join(" ");
  box.scrollTop = box.scrollHeight;
}

function onEditorMove(from, to, promotion) {
  const ed = editor;
  if (!ed) return;
  const { pos } = E.replay(ed.moves, ed.start || undefined);
  const cands = E.legalFromTo(pos, from, to);
  if (!cands.length) { showPosition(ed.view, { interactive: true }); return; }
  let uci = cands[0];
  if (cands.length > 1) {                          // a pawn reaching the last rank: ask which piece
    if (!promotion) {
      ed.pending = { from, to };
      showPosition(ed.view, { interactive: false });
      $("edPromo").classList.remove("hidden");
      return;
    }
    uci = from + to + promotion;
  }
  editorMsg("");
  editorSet([...ed.moves, uci], []);               // a new move discards the redo history
}

function editorTruncate(n) {                       // delete move n and everything after it
  const removed = editor.moves.slice(n);
  if (!removed.length) return;
  if (removed.length > 1 && !confirm(`Delete this move and everything after it (${removed.length} moves)?`)) return;
  editorMsg("");
  editorSet(editor.moves.slice(0, n), editor.redo.concat(removed.reverse()));
}

async function saveEditorLine() {
  const ed = editor;
  if (!ed) return;
  if (!ed.moves.length) return editorMsg("Play at least one move first.", true);
  const target = $("edTarget").value;
  const args = { moves: ed.moves, name: $("edName").value, lineId: ed.lineId, start: ed.start || undefined };
  if (target === "new") args.newCollection = { name: $("edNewName").value, color: $("edNewColor").value };
  else args.collId = Number(target);
  let res;
  try { res = await S.saveLine(args); } catch (e) { return editorMsg(e.message, true); }
  if (editor !== ed) return;

  refresh(res.collId);
  const note = res.replaced.length ? ` It replaced the shorter line "${res.replaced.join('", "')}".` : "";
  if (!res.saved) return editorMsg("Nothing new saved: that line is already covered by a line in this collection.", true);
  if (ed.lineId !== null) {                        // finished editing an existing line
    closeEditor();
    setStatus(`Line updated in "${res.collection}".${note}`, "good");
    return;
  }
  $("edName").value = ""; $("edNewName").value = "";
  editorSet([], []);
  editorMsg(`Saved to "${res.collection}" (${res.total} lines now).${note} Record another, or close the editor.`);
}

// ------------------------------------------------------------ position setup (puzzles)
const ROLES = ["king", "queen", "rook", "bishop", "knight", "pawn"];
const suMsg = (t, bad = false) => { const m = $("suMsg"); m.textContent = t; m.className = bad ? "bad" : ""; };

function buildPalette() {
  const cells = (color) => ROLES.map((role) =>
    `<button class="pal" data-color="${color}" data-role="${role}" aria-label="${color} ${role}" title="${color} ${role}"><piece class="${role} ${color}"></piece></button>`).join("");
  $("palette").innerHTML = cells("white") + '<button class="pal" data-tool="hand" aria-label="Move pieces" title="Move pieces on the board"><span class="glyph">✋</span></button>' +
                           cells("black") + '<button class="pal" data-tool="erase" aria-label="Eraser" title="Tap squares to remove pieces"><span class="glyph">🗑</span></button>';
}

// tool: null = move pieces, "erase", or { color, role } = tap squares to place that piece
function setTool(tool) {
  setup.tool = tool;
  for (const b of $("palette").querySelectorAll(".pal")) {
    b.classList.toggle("on", tool === null ? b.dataset.tool === "hand"
      : tool === "erase" ? b.dataset.tool === "erase"
      : b.dataset.color === tool.color && b.dataset.role === tool.role);
  }
  const placing = tool !== null;
  ground.set({ draggable: { enabled: !placing }, selectable: { enabled: !placing }, movable: { color: placing ? undefined : "both" } });
}

function setupFen() {
  const board = ground.getFen(), avail = E.castlingAvailable(board);
  const c = ["K", "Q", "k", "q"].filter((x) => setup.castle[x] && avail[x]).join("") || "-";
  return `${board} ${setup.turn === "white" ? "w" : "b"} ${c} - 0 ${setup.fullmove}`;
}

function refreshSetup() {
  if (!setup) return;
  const fen = setupFen(), avail = E.castlingAvailable(ground.getFen());
  for (const x of ["K", "Q", "k", "q"]) { const el = $("su" + x); el.disabled = !avail[x]; el.checked = !!setup.castle[x] && avail[x]; }
  $("suTurn").value = setup.turn;
  if (document.activeElement !== $("suFen")) $("suFen").value = fen;
  const v = E.validateStart(fen);
  setup.valid = v.ok;
  suMsg(v.ok ? "Position looks good." : v.error, !v.ok);
  $("suMsg").classList.toggle("good", v.ok);
  $("suRecord").disabled = !v.ok;
}

function loadSetupFen(fen) {
  const f = (fen || "").trim().split(/\s+/);
  if (!f[0] || parseFen(fen.trim()).isErr) { suMsg("That isn't a valid FEN.", true); return false; }
  setup.turn = f[1] === "b" ? "black" : "white";
  const cr = f[2] || "-";
  setup.castle = { K: cr.includes("K"), Q: cr.includes("Q"), k: cr.includes("k"), q: cr.includes("q") };
  setup.fullmove = parseInt(f[5], 10) > 0 ? parseInt(f[5], 10) : 1;
  ground.set({ fen: f[0], lastMove: undefined, check: false });
  refreshSetup();
  return true;
}

function enterSetup({ fen = E.START_FEN, carry = {}, orientation = "white" } = {}) {
  state = null; session = null; editor = null; exHide(); hideResult(); setProgress("");
  $("hintBtn").disabled = true; $("skipBtn").disabled = true;
  $("editorPanel").classList.add("hidden"); $("edPromo").classList.add("hidden");
  $("setupPanel").classList.remove("hidden");
  setup = { tool: null, castle: { K: true, Q: true, k: true, q: true }, turn: "white", fullmove: 1, carry, valid: false };
  ground.set({
    orientation, lastMove: undefined, check: false,
    highlight: { lastMove: false, check: false },
    movable: { free: true, color: "both", showDests: false, dests: new Map() },
    draggable: { enabled: true, deleteOnDropOff: true }, selectable: { enabled: true },
    events: { change: refreshSetup },
  });
  ground.setAutoShapes([]);
  setTool(null);
  loadSetupFen(fen);
  renderSetupLines();
  setStatus("Set up the position, then press Start recording.");
  $("setupPanel").scrollIntoView?.({ block: "nearest" });
}

function closeSetup() {
  setup = null;
  $("setupPanel").classList.add("hidden");
  ground.set({
    highlight: { lastMove: true, check: true },
    movable: { free: false, color: undefined, dests: new Map() },
    draggable: { enabled: true, deleteOnDropOff: false }, selectable: { enabled: true },
    events: { change: undefined },
  });
}

function startRecording() {
  if (!setup) return;
  const v = E.validateStart(setupFen());
  if (!v.ok) return suMsg(v.error, true);
  const { carry } = setup, orientation = ground.state.orientation;
  closeSetup();
  openEditor({ ...carry, start: E.normalizeStart(v.fen), orientation });
}

function renderSetupLines() {
  const c = coll(), lines = c ? c.lines : [];
  $("suLineBox").classList.toggle("hidden", !lines.length);
  $("suLine").innerHTML = lines.map((l, i) => `<option value="${l.id}">${i + 1}. ${esc(l.name)}</option>`).join("");
  syncSetupPly(true);
}

function syncSetupPly(reset) {
  const c = coll(), l = c && c.lines.find((x) => x.id === Number($("suLine").value)), r = $("suPly");
  if (!l) { $("suPlyLabel").textContent = ""; return; }
  r.max = l.moves.length;
  if (reset) r.value = l.moves.length;
  const n = Number(r.value);
  const text = n === 0 ? "" : E.sanLine(E.replay(l.moves.slice(0, n), l.start).sans, l.start).split(" ").slice(-3).join(" ");
  $("suPlyLabel").textContent = n === 0 ? "Before the first move" : `After … ${text}`;
}

function chooseTool(b) {
  if (b.dataset.tool === "hand") setTool(null);
  else if (b.dataset.tool === "erase") setTool("erase");
  else setTool({ color: b.dataset.color, role: b.dataset.role });
}
$("palette").addEventListener("click", (e) => {
  const b = e.target.closest(".pal");
  if (b && setup) chooseTool(b);
});
const startPaletteDrag = (e) => {            // pressing a palette piece and dragging drops a new piece on the board
  const b = e.target.closest(".pal");
  if (!b || !setup || !b.dataset.role) return;
  setTool(null);
  ground.dragNewPiece({ color: b.dataset.color, role: b.dataset.role }, e, true);
};
$("palette").addEventListener("mousedown", startPaletteDrag);
// On touch screens Chessground cancels the browser's click while a drag is active, so detect taps ourselves.
let tapAt = null;
$("palette").addEventListener("touchstart", (e) => {
  startPaletteDrag(e);
  const t = e.touches[0];
  tapAt = t ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
$("palette").addEventListener("touchend", (e) => {
  const b = e.target.closest(".pal"), t = e.changedTouches[0];
  if (b && setup && tapAt && t && Math.hypot(t.clientX - tapAt.x, t.clientY - tapAt.y) < 10) chooseTool(b);
  tapAt = null;
});
$("board").addEventListener("pointerdown", (e) => {   // tap-to-place with a palette tool selected
  if (!setup || !setup.tool) return;
  const key = ground.getKeyAtDomPos([e.clientX, e.clientY]);
  if (!key) return;
  e.preventDefault();
  ground.setPieces(new Map([[key, setup.tool === "erase" ? undefined : { color: setup.tool.color, role: setup.tool.role }]]));
  refreshSetup();
}, true);

$("puzzleBtn").onclick = () => { if (guardEditor()) enterSetup({ carry: { targetId: coll()?.id } }); };
$("suStandard").onclick = () => setup && loadSetupFen(E.START_FEN);
$("suEmpty").onclick = () => setup && loadSetupFen("8/8/8/8/8/8/8/8 w - - 0 1");
$("suFlip").onclick = () => setup && ground.toggleOrientation();
$("suTurn").onchange = () => { if (setup) { setup.turn = $("suTurn").value; refreshSetup(); } };
for (const x of ["K", "Q", "k", "q"]) $("su" + x).onchange = () => { if (setup) { setup.castle[x] = $("su" + x).checked; refreshSetup(); } };
$("suLoadFen").onclick = () => setup && loadSetupFen($("suFen").value);
$("suFen").onkeydown = (e) => { if (e.key === "Enter" && setup) loadSetupFen($("suFen").value); };
$("suCopyFen").onclick = async () => {
  try { await navigator.clipboard.writeText($("suFen").value); suMsg("FEN copied."); }
  catch { $("suFen").select(); suMsg("Copy the selected FEN with your device's copy command."); }
};
$("suLine").onchange = () => syncSetupPly(true);
$("suPly").oninput = () => syncSetupPly(false);
$("suUseLine").onclick = () => {
  const c = coll(), l = c && c.lines.find((x) => x.id === Number($("suLine").value));
  if (setup && l) loadSetupFen(E.fenAfter(l.moves, Number($("suPly").value), l.start));
};
$("suRecord").onclick = startRecording;
$("suCancel").onclick = () => { closeSetup(); resetTraining(); };
$("edChangePos").onclick = () => {
  if (!editor || !editor.start) return;
  if (editor.moves.length && !confirm("Changing the position clears the moves you've recorded. Continue?")) return;
  const carry = { lineId: editor.lineId, name: $("edName").value, targetId: $("edTarget").value };
  enterSetup({ fen: editor.start, carry, orientation: ground.state.orientation });
};

// ------------------------------------------------------------ backup & sync
const dataMsg = (t, bad = false) => { const m = $("dataMsg"); m.textContent = t; m.className = t ? (bad ? "bad" : "good") : ""; };

async function exportBackup() {
  const name = `opening-trainer-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([S.exportJson()], name, { type: "application/json" });
  try {                                            // iPhone: the share sheet (Files, AirDrop, iCloud Drive…)
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Opening Trainer backup" }); dataMsg("Backup shared."); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  dataMsg(`Backup saved as ${name}.`);
}

async function importBackup(file) {
  if (!file) return;
  if (!confirm("This REPLACES all collections on this device with the contents of the backup file. Continue?")) return;
  try {
    const res = await S.importJson(await file.text());
    closeEditor(); resetTraining(); refresh();
    dataMsg(`Imported ${res.collections} collection(s) with ${res.lines} line(s)${res.dropped ? `; ${res.dropped} invalid item(s) skipped` : ""}.`);
  } catch (e) { dataMsg(e.message, true); }
}

async function showStorage() {
  let txt = "";
  try {
    const ok = await navigator.storage?.persist?.();
    txt = ok ? "Storage: protected from automatic clearing." : "Storage: not guaranteed by this browser, so export a backup now and then.";
  } catch { /* ignore */ }
  if (!S.canPersist()) txt = "Warning: this browser blocked storage (private browsing?). Changes will be lost when you close the page.";
  $("storageInfo").textContent = txt;
}

// ------------------------------------------------------------------- wiring
$("explorerBtn").onclick = openExplorer;
document.querySelectorAll('input[name="exSide"]').forEach((r) => { r.onchange = () => exRenderColls(new Set(S.collections().filter((c) => c.color === exSide()).map((c) => c.id))); });
$("exColls").onchange = exUpdateStart;
$("exAll").onclick = () => { document.querySelectorAll("#exColls input:not(:disabled)").forEach((i) => { i.checked = true; }); exUpdateStart(); };
$("exNone").onclick = () => { document.querySelectorAll("#exColls input").forEach((i) => { i.checked = false; }); exUpdateStart(); };
$("exStart").onclick = exStart;
$("exCancel").onclick = closeExplorer;
$("exClose").onclick = closeExplorer;
$("exBack").onclick = exBack;
$("exReturn").onclick = exReturn;
$("exMoves").onclick = (e) => { const m = e.target.closest("[data-i]"); if (m) exReview(Number(m.dataset.i)); };
$("exHintsChk").checked = exHints;
$("exHintsChk").onchange = () => exSetHints($("exHintsChk").checked);
$("exRestart").onclick = () => { if (explorer) { explorer.stats = { explored: 0, tested: 0, first: 0, wrong: 0, hints: 0 }; exRestart(); } };
$("exRandom").onclick = () => exChoose(null);
$("exChoices").onclick = (e) => { const b = e.target.closest("[data-uci]"); if (b) exChoose(b.dataset.uci); };
$("hintBtn").onclick = hint;
$("speedSel").onchange = () => applySpeed($("speedSel").value);
$("skipBtn").onclick = skipLine;
$("allBtn").onclick = () => guardEditor() && practiceAll();
$("randomBtn").onclick = () => guardEditor() && startRandom();
$("recordBtn").onclick = () => openEditor();
$("deleteBtn").onclick = deleteCollection;
$("createBtn").onclick = createCollection;
$("extendBtn").onclick = extendCollection;
$("emptyBtn").onclick = createEmpty;
$("newCollBtn").onclick = () => {
  const box = $("createBox"); box.open = true;
  box.scrollIntoView?.({ block: "nearest" });
  $("impName").focus();
  $("impMsg").innerHTML = "<small>Type a name, choose your colour, then press \"Create empty collection\".</small>";
};
$("repSelect").onchange = () => { resetTraining(); renderLines(); if (setup) renderSetupLines(); };
$("exportBtn").onclick = exportBackup;
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => { await importBackup(e.target.files[0]); e.target.value = ""; };

$("edClose").onclick = () => guardEditor();
$("edSave").onclick = saveEditorLine;
$("edUndo").onclick = () => editor && editorTruncate(editor.moves.length - 1);
$("edClear").onclick = () => editor && editorTruncate(0);
$("edRedo").onclick = () => {
  if (!editor || !editor.redo.length) return;
  const redo = editor.redo.slice(), next = redo.pop();
  editorSet([...editor.moves, next], redo);
};
$("edMoves").onclick = (e) => { const m = e.target.closest("[data-i]"); if (m && editor) editorTruncate(Number(m.dataset.i)); };
$("edPromo").onclick = (e) => {
  const ed = editor, b = e.target.closest("button");
  if (!ed || !ed.pending || !b) return;
  const { from, to } = ed.pending;
  ed.pending = null;
  $("edPromo").classList.add("hidden");
  if (b.dataset.p) onEditorMove(from, to, b.dataset.p);
  else showPosition(ed.view, { interactive: true });          // cancelled
};
$("edTarget").onchange = syncEditorTarget;
$("edNewColor").onchange = syncEditorTarget;

async function main() {
  initBoard();
  buildPalette();
  applySpeed(speed);
  $("version").textContent = `Opening Trainer v${VERSION}`;
  await S.load();
  refresh();
  showStorage();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}
main();

// The tournament hall: tables with live boards, the engine loop for every table, and the shop.
import { Chessground } from "@lichess-org/chessground";
import { makeFen } from "chessops/fen";
import { newGame, applyMove, gameResult, pickJs, bookMove, evaluate, legalUcis, lineToSan } from "./botplay.js";
import { LADDER, TYC, ITEMS, STAGES, engineCost, samplePacks, bossReward } from "./tycoon.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coin = '<span class="coin"></span>';
const START_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const clock = (ms) => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const evalPct = (cp) => Math.max(4, Math.min(96, 50 + 50 * Math.tanh(cp / 450)));
const evalText = (cp, mate) => (mate ? (mate > 0 ? "M" : "-M") + Math.abs(mate) : (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1));

/**
 * T: the tycoon (src/tycoon.js)   sf: the Stockfish adapter (src/sfengine.js)
 * notify(text, kind), fx(kind, amount, fromEl)   - messages and "+N" popups supplied by the page
 * changed(): called after anything that changes gold, EXP or the saved game   collections(): the player's own opening collections
 */
export function createHall({ root, T, sf, notify, fx, changed, collections = () => [], tycoonLeft = () => null }) {
  let visible = false, shopTab = "engines", editor = null, lastShop = 0, shopTimer = 0;
  const cards = [], runners = [], cur = [];
  let waiters = [];
  const canRun = () => (visible || T.state.bg) && !document.hidden;
  const canDraw = () => visible && !document.hidden;
  const gate = async () => { while (!canRun()) await new Promise((r) => waiters.push(r)); };
  const wake = () => { const w = waiters; waiters = []; for (const f of w) f(); };
  let sfBroken = false;

  // ------------------------------------------------------------------ the quack
  let actx = null, lastQuack = 0;
  function quack() {
    if (!T.state.sound) return;
    const t0 = Date.now(); if (t0 - lastQuack < 400) return; lastQuack = t0;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const t = actx.currentTime;
      for (const [d, f] of [[0, 520], [0.17, 430]]) {
        const o = actx.createOscillator(), g = actx.createGain(), bp = actx.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.setValueAtTime(f, t + d); o.frequency.exponentialRampToValueAtTime(f * 0.62, t + d + 0.12);
        bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 2;
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.15);
        o.connect(bp); bp.connect(g); g.connect(actx.destination); o.start(t + d); o.stop(t + d + 0.17);
      }
    } catch { /* no sound available */ }
  }

  // ------------------------------------------------------------------ the page
  root.innerHTML = `
    <h1>Chess Tournament Tycoon</h1>
    <p class="muted hall-intro">Your engines play for you. Wins earn <b>bot EXP</b> (100 bot EXP = 1 gold) and beating a stage's boss pays gold and EXP. Spend them on better engines, speed, openings and items.</p>
    <div class="panel hallbank" id="hallBank"></div>
    <div id="hallTables" class="tables"></div>
    <div class="panel hallshop">
      <div class="row shoptabs" id="shopTabs">
        <button data-act="shoptab" data-tab="engines" class="small">Engines</button>
        <button data-act="shoptab" data-tab="openings" class="small secondary">Openings</button>
        <button data-act="shoptab" data-tab="items" class="small secondary">Items</button>
      </div>
      <div id="hallShop"></div>
    </div>
    <div><button id="hallExit" class="secondary" style="margin-top:14px">Back to study</button></div>`;
  const $ = (sel) => root.querySelector(sel);

  // ---- bank
  function renderBank() {
    const b = T.balance(), left = tycoonLeft();
    $("#hallBank").innerHTML = `<div class="bankline"><span><span class="coin"></span> <b>${fmt(b.gold)}</b> gold</span><span>🤖 <b>${fmt(b.bot)}</b> bot EXP <small class="muted">(= ${fmt(Math.floor(b.bot / TYC.botPerGold))} gold)</small></span></div>
      <div class="row paybar"><span class="muted">Pay with</span>
        ${[["auto", "Bot EXP first"], ["bot", "Bot EXP only"], ["gold", "Gold only"]].map(([m, l]) => `<button class="small${T.state.pay === m ? "" : " secondary"}" data-act="pay" data-m="${m}">${l}</button>`).join("")}</div>
      <div class="row hallopts"><label class="check"><input type="checkbox" data-act="bg"${T.state.bg ? " checked" : ""}> Keep playing while I'm on other tabs</label>
        <label class="check"><input type="checkbox" data-act="sound"${T.state.sound ? " checked" : ""}> Sound</label></div>
      ${left ? `<small class="muted">Boss rewards left today: ${fmt(left.gold)} gold, ${fmt(left.exp)} EXP.</small>` : ""}`;
  }

  // ------------------------------------------------------------------ tables
  function buildCards() {
    const host = $("#hallTables"), n = T.state.tables.length;
    while (cards.length < n) {
      const i = cards.length, el = document.createElement("section");
      el.className = "tcard"; el.dataset.t = String(i);
      el.innerHTML = `<div class="tbw"><div class="evalcol" title="Evaluation (White at the bottom)"><div class="evalbar"><div class="evalfill"></div></div><span class="evaltxt">0.0</span></div><div class="tboard"></div></div>
        <div class="tmain"><div class="ttitle">Table ${i + 1}</div><div class="tplayers"></div><div class="tstate muted"></div><div class="tprog"></div><div class="tctl"></div></div><div class="tfx" aria-hidden="true"></div>`;
      host.insertBefore(el, $("#hallLocked"));
      const ground = Chessground(el.querySelector(".tboard"), {
        fen: START_BOARD, viewOnly: true, coordinates: false, animation: { enabled: true, duration: 140 }, highlight: { lastMove: true, check: true },
        draggable: { enabled: false }, selectable: { enabled: false }, premovable: { enabled: false }, drawable: { enabled: false }, movable: { free: false, color: undefined },
      });
      cards.push({ el, ground, sig: "", dirty: true, drawTimer: 0, shownFen: "" });
      startRunner(i);
    }
  }
  function renderLocked() {
    let el = $("#hallLocked");
    if (!el) { el = document.createElement("section"); el.id = "hallLocked"; el.className = "tcard locked"; $("#hallTables").append(el); }
    const nx = T.nextSlot(), b = T.balance();
    if (!nx) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    const n = T.state.tables.length + 1, can = T.payPlan(nx.cost);
    el.innerHTML = nx.unlocked
      ? `<div class="lockbody"><b>Table ${n}</b><div class="muted">Open another table and put another engine to work.</div><button data-act="buyslot"${can ? "" : " disabled"}>Open for ${coin} ${fmt(nx.cost)}</button>${can ? "" : `<small class="muted">${esc(T.tooPoor(nx.cost))}</small>`}</div>`
      : `<div class="lockbody"><b>🔒 Table ${n}</b><div class="muted">Unlocks at level ${nx.level}.<br>Then it costs ${coin} ${fmt(nx.cost)}.</div></div>`;
  }

  const nameOf = (id) => (id ? T.engineName(id) : "—");
  function playersHtml(i) {
    const c = cur[i], t = T.state.tables[i];
    const eng = T.engineById(t.engine);
    if (!eng) return '<span class="muted">No engine at this table. Choose one below.</span>';
    const plan = c && c.plan;
    if (!plan) return `<span class="pl me">${esc(nameOf(eng.id))}</span>`;
    const w = plan.color === "white";
    const meHtml = `<span class="pl me">${esc(plan.name)} <small>${plan.elo}</small>${plan.beadsOn ? " 📿" : ""}</span>`;
    const opHtml = `<span class="pl op">${plan.boss ? '<span class="bosstag">BOSS</span> ' : ""}${esc(plan.opp.name)} <small>${plan.opp.elo}</small></span>`;
    return `<span class="dot ${w ? "wh" : "bl"}"></span>${meHtml}<span class="vs">vs</span><span class="dot ${w ? "bl" : "wh"}"></span>${opHtml}`;
  }

  function progHtml(i) {
    const t = T.state.tables[i]; if (!T.engineById(t.engine)) return "";
    const si = T.stageInfo(i), pips = Array.from({ length: TYC.bossAfter }, (_, k) => `<i class="${k < si.wins ? "on" : ""}"></i>`).join("");
    const reward = bossReward(si.stage, si.first);
    return `<div class="stagerow"><button class="small secondary" data-act="stage" data-t="${i}" data-d="-1"${si.stage <= 0 ? " disabled" : ""} aria-label="Previous stage">◀</button>
        <span>Stage <b>${si.stage + 1}</b>/${STAGES}: <b>${esc(si.rung.name)}</b></span>
        <button class="small secondary" data-act="stage" data-t="${i}" data-d="1"${si.stage >= si.maxStage ? " disabled" : ""} aria-label="Next stage">▶</button></div>
      <div class="pips" title="Wins needed before the boss appears">${pips}<span class="muted"> ${si.boss ? "Boss fight next!" : `${si.wins}/${TYC.bossAfter} wins to the boss`}</span></div>
      <small class="muted">Boss ${esc(si.bossRung.name)} pays ${coin} ${fmt(reward.gold)} + ${fmt(reward.exp)} EXP${si.first ? "" : " (repeat)"}.</small>`;
  }

  function itemLabel(it) {
    const d = ITEMS[it.type];
    if (it.type === "beads") { const b = T.beadsStatus(it); return `${d.icon} ${d.name} · ${b.state === "ready" ? "ready" : b.state === "active" ? "active " + clock(b.left) : "sore " + clock(b.left)}`; }
    return `${d.icon} ${d.name}`;
  }
  function ctlHtml(i) {
    const t = T.state.tables[i], eng = T.engineById(t.engine), sp = T.speedInfo(i);
    const seat = (id) => { const k = T.state.tables.findIndex((x) => x.engine === id); return k >= 0 && k !== i ? ` (table ${k + 1})` : ""; };
    const engOpts = `<option value="">— none —</option>` + T.state.engines.map((e) => `<option value="${e.id}"${e.id === t.engine ? " selected" : ""}>${esc(T.engineName(e.id))} · ${LADDER[e.tier].elo}${seat(e.id)}</option>`).join("");
    const can = sp.maxed ? null : T.payPlan(sp.cost);
    let html = `<label class="lbl">Engine<select data-act="engine" data-t="${i}">${engOpts}</select></label>
      <div class="speedrow"><span>⚡ <b>${(sp.delay / 1000).toFixed(sp.delay < 100 ? 2 : 1)} s</b> per move</span>${sp.maxed ? '<span class="muted">top speed</span>'
        : `<button class="small" data-act="speed" data-t="${i}"${can ? "" : " disabled"} title="${can ? "" : esc(T.tooPoor(sp.cost))}">Faster (${(sp.nextDelay / 1000).toFixed(sp.nextDelay < 100 ? 2 : 1)} s) · ${coin} ${fmt(sp.cost)}</button>`}</div>`;
    if (eng) {
      const packs = T.packList(), stash = T.stash();
      const slotSel = (s) => {
        const have = eng.items[s] ? T.state.items[eng.items[s]] : null;
        const opts = [`<option value="">— empty —</option>`, ...(have ? [`<option value="${have.id}" selected>${esc(itemLabel(have))}</option>`] : []), ...stash.map((x) => `<option value="${x.id}">${esc(itemLabel(x))}</option>`)];
        return `<label class="lbl">Item ${s + 1}<select data-act="slot" data-t="${i}" data-s="${s}">${opts.join("")}</select></label>`;
      };
      html += `<div class="invgrid"><label class="lbl">Opening<select data-act="book" data-t="${i}"><option value="">— none —</option>${packs.map((p) => `<option value="${p.id}"${p.id === eng.book ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>${slotSel(0)}${slotSel(1)}</div>
        <label class="check"><input type="checkbox" data-act="auto" data-t="${i}"${t.auto ? " checked" : ""}> Move up a stage after beating a boss</label>
        <small class="muted">${esc(nameOf(eng.id))}: ${eng.w}W ${eng.d}D ${eng.l}L · this table ${t.w}W ${t.d}D ${t.l}L</small>`;
    }
    return html;
  }
  const focusInside = (el) => { const a = document.activeElement; return a && el.contains(a) && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName); };
  function renderCard(i, force = false) {
    const c = cards[i]; if (!c) return;
    c.el.querySelector(".tplayers").innerHTML = playersHtml(i);
    c.el.querySelector(".tprog").innerHTML = progHtml(i);
    const ctl = c.el.querySelector(".tctl"), html = ctlHtml(i);
    if (force || html !== c.sig) { if (focusInside(ctl) && !force) { c.dirty = true; } else { ctl.innerHTML = html; c.sig = html; c.dirty = false; } }
  }
  function renderAllCards(force) { for (let i = 0; i < cards.length; i++) renderCard(i, force); }

  // ---- drawing a game
  const setState = (i, text, cls = "") => { const el = cards[i] && cards[i].el.querySelector(".tstate"); if (el) { el.textContent = text; el.className = "tstate " + (cls || "muted"); } };
  function drawNow(i) {
    const c = cards[i], g = cur[i]; if (!c || !g || !canDraw()) return;
    const pos = g.game.pos, fen = makeFen(pos.toSetup()).split(" ")[0];
    const last = g.game.ucis.length ? g.game.ucis[g.game.ucis.length - 1] : null;
    const sp = T.speedInfo(i);
    c.ground.set({ fen, lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined, check: pos.isCheck() ? pos.turn : false, animation: { enabled: sp.delay >= 200, duration: Math.min(180, Math.round(sp.delay * 0.7)) } });
    const fill = c.el.querySelector(".evalfill"), txt = c.el.querySelector(".evaltxt");
    fill.style.height = evalPct(g.cp) + "%"; txt.textContent = evalText(g.cp, g.mate);
    if (!g.over) setState(i, `Move ${Math.floor(g.game.ucis.length / 2) + 1} · ${pos.turn === "white" ? "White" : "Black"} to move${g.book ? " · in the opening book" : ""}`);
  }
  function queueDraw(i) {
    const c = cards[i]; if (!c || c.drawTimer || !canDraw()) return;
    c.drawTimer = setTimeout(() => { c.drawTimer = 0; drawNow(i); }, 70);
  }
  function redrawAll() {
    for (let i = 0; i < cards.length; i++) { cards[i].ground.redrawAll(); drawNow(i); }
  }

  // ------------------------------------------------------------------ playing
  const movetimeFor = (cfg, delay) => Math.round(Math.max(cfg.elo === null ? 80 : 25, Math.min(cfg.elo === null ? 400 : 300, delay * 0.6)));
  async function pickMove(i, plan, game, workerTurn) {
    const color = game.pos.turn;
    if (workerTurn && plan.book) {
      const b = bookMove(plan.book, game.ucis, color);
      if (b && legalUcis(game.pos).includes(b)) return { uci: b, book: true };
    }
    let cfg = workerTurn ? plan.cfg : plan.opp.cfg;
    if (cfg.style === "sf" && !sfBroken) {
      try {
        const r = await sf.think({ fen: makeFen(game.pos.toSetup()), elo: cfg.elo, skill: cfg.skill, movetime: movetimeFor(cfg, T.speedInfo(i).delay) });
        return { uci: r.uci, cp: r.mate ? Math.sign(r.mate) * (10000 - Math.abs(r.mate)) : r.cp, mate: r.mate || 0 };
      } catch {
        sfBroken = true; notify("The Stockfish engine couldn't be loaded, so the strong engines play at reduced strength for now.");
      }
    }
    if (cfg.style === "sf") cfg = { style: "search", depth: 3, noise: 10, nodes: 5000, quiet: 2 };
    await sleep(0);                                       // let the page breathe before a search
    return { uci: pickJs(game.pos, cfg) };
  }
  const outcomeFor = (plan, res) => { const mine = plan.color === "white" ? res.score : 1 - res.score; return mine === 1 ? "win" : mine === 0 ? "loss" : "draw"; };

  async function oneGame(run) {
    const i = run.i, plan = T.planGame(i);
    if (!plan) { cur[i] = null; renderCard(i); setState(i, "Waiting for an engine."); await sleep(600); return; }
    plan.name = nameOf(plan.engineId);
    const gen = run.gen, game = newGame();
    const g = cur[i] = { plan, game, cp: 0, mate: 0, over: false, book: false };
    renderCard(i); drawNow(i);
    if (plan.paintball) {
      g.over = true; paint(i, true);
      setState(i, `💥 The Instant Resignation Device fires. ${plan.opp.name} resigns!`, "good");
      await sleep(Math.min(1400, 500 + plan.delay)); if (run.dead || run.gen !== gen) return;
      afterGame(i, plan, "win", T.finishGame(i, plan, "win", { paintball: true }), "the paintball gun");
      await sleep(600); return;
    }
    let res = null;
    for (;;) {
      await gate();
      if (run.dead || run.gen !== gen) return;                // the table changed under the game: it doesn't count
      res = gameResult(game);
      if (res) break;
      const workerTurn = (game.pos.turn === "white") === (plan.color === "white");
      const t0 = performance.now();
      const mv = await pickMove(i, plan, game, workerTurn);
      if (run.dead || run.gen !== gen) return;
      const left = T.speedInfo(i).delay - (performance.now() - t0);
      if (left > 4) await sleep(left);
      if (run.dead || run.gen !== gen) return;
      if (!applyMove(game, mv.uci)) applyMove(game, pickJs(game.pos, { style: "random" }));
      g.book = !!mv.book && workerTurn;
      if (mv.cp != null) { g.cp = mv.cp; g.mate = mv.mate || 0; } else { g.cp = evaluate(game.pos); g.mate = 0; }
      queueDraw(i);
    }
    g.over = true;
    const outcome = outcomeFor(plan, res);
    g.cp = res.score === 1 ? 10000 : res.score === 0 ? -10000 : 0; g.mate = res.reason === "checkmate" ? (res.score === 1 ? 1 : -1) : 0;
    drawNow(i);
    afterGame(i, plan, outcome, T.finishGame(i, plan, outcome), res.reason);
    await sleep(Math.max(250, Math.min(1500, plan.delay * 2)));
  }

  function afterGame(i, plan, outcome, r, how) {
    const c = cards[i]; if (!c) return;
    if (!r.ok) return;
    const me = plan.name, op = plan.opp.name;
    const line = outcome === "win" ? `${me} beat ${op} (${how})` : outcome === "loss" ? `${me} lost to ${op} (${how})` : `${me} drew with ${op} (${how})`;
    setState(i, `${line}${r.bot ? ` · +${fmt(r.bot)} bot EXP` : ""}`, outcome === "win" ? "good" : outcome === "loss" ? "bad" : "muted");
    c.el.classList.remove("win", "loss", "draw"); void c.el.offsetWidth; c.el.classList.add(outcome);
    if (r.quack) { quack(); duckFx(i); }
    if (r.boss) {
      const b = r.boss;
      notify(`🏆 Boss beaten: ${plan.opp.name}! +${fmt(b.gotGold)} gold, +${fmt(b.gotExp)} EXP${b.capped ? " (today's boss-reward limit reached)" : ""}`, "achievement");
      fx("gold", b.gotGold, c.el); setTimeout(() => fx("exp", b.gotExp, c.el), 250);
    }
    if (r.advanced) notify(`Table ${i + 1} moves up to stage ${r.stage + 1}: ${LADDER[r.stage].name}.`);
    if (r.paintball) renderShopSoon(true);
    renderCard(i); renderBank(); renderShopSoon(); changed();
  }
  function duckFx(i) { const f = cards[i].el.querySelector(".tfx"); f.innerHTML = '<span class="duck">🦆 Quack!</span>'; setTimeout(() => { if (f.firstChild) f.firstChild.remove(); }, 1400); }
  function paint(i, on) { const f = cards[i].el.querySelector(".tfx"); f.innerHTML = on ? '<span class="splat s1"></span><span class="splat s2"></span><span class="splat s3"></span>' : ""; if (on) setTimeout(() => { f.innerHTML = ""; }, 1600); }

  function startRunner(i) {
    const run = runners[i] = { i, gen: 0, dead: false };
    (async () => {
      while (!run.dead) {
        try { await gate(); if (run.dead) break; await oneGame(run); } catch (e) { console.error(e); await sleep(1000); }
      }
    })();
  }
  const abort = (i) => { if (runners[i]) runners[i].gen++; };

  // ------------------------------------------------------------------ shop
  const priceHtml = (g) => `${coin} ${fmt(g)} <small class="muted">or ${fmt(g * TYC.botPerGold)} bot EXP</small>`;
  function shopEngines() {
    const owned = T.state.engines, seat = (id) => { const k = T.state.tables.findIndex((t) => t.engine === id); return k >= 0 ? `table ${k + 1}` : "bench"; };
    const mine = owned.map((e) => `<div class="mini"><b>${esc(T.engineName(e.id))}</b> <small class="muted">${LADDER[e.tier].elo} · ${seat(e.id)} · ${e.w}W ${e.d}D ${e.l}L</small></div>`).join("");
    const rows = LADDER.map((r, tier) => {
      const cost = engineCost(tier), can = T.payPlan(cost), n = owned.filter((e) => e.tier === tier).length;
      return `<div class="shoprow"><div class="sr-main"><b>${esc(r.name)}</b> <small class="muted">~${r.elo}${n ? ` · you own ${n}` : ""}</small><br><small>${esc(r.blurb)}</small></div>
        <div class="sr-buy"><div>${priceHtml(cost)}</div><button class="small" data-act="buy-engine" data-tier="${tier}"${can ? "" : " disabled"}>Buy</button></div></div>`;
    }).join("");
    return `<h2>Your engines</h2><div class="minis">${mine}</div><h2>Buy an engine</h2><small class="muted">Seat engines at tables with the Engine menu on each table. Ratings are nominal.</small>${rows}`;
  }
  function shopOpenings() {
    const lvl = T.level(), own = new Set(T.state.packs);
    let html = '<small class="muted">An opening pack tells an engine which moves to play as White and as Black. The engine follows a line while the game keeps to it, then thinks for itself. Choose a pack in the Opening menu of an engine.</small>';
    for (const moves of [3, 5, 10, 15]) {
      html += `<h2>${moves}-move packs <small class="muted">· level ${TYC.packLevels[moves]}</small></h2>`;
      for (const p of samplePacks().filter((x) => x.moves === moves)) {
        const can = T.payPlan(p.price), locked = lvl < p.level;
        html += `<div class="shoprow"><div class="sr-main"><b>${esc(p.family)}</b> <small class="muted">${p.white.length} lines as White, ${p.black.length} as Black</small></div><div class="sr-buy">${own.has(p.id) ? '<span class="muted">Owned</span>'
          : locked ? `<span class="muted">🔒 level ${p.level}</span>` : `<div>${priceHtml(p.price)}</div><button class="small" data-act="buy-pack" data-id="${p.id}"${can ? "" : " disabled"}>Buy</button>`}</div></div>`;
      }
    }
    html += `<h2>Your own packs <small class="muted">· level ${TYC.customPackLevel}</small></h2>`;
    if (lvl < TYC.customPackLevel) return html + `<small class="muted">🔒 Reach level ${TYC.customPackLevel} to write openings for your engines.</small>`;
    html += T.state.custom.map((c) => `<div class="shoprow"><div class="sr-main"><b>${esc(c.name)}</b> <small class="muted">${c.white.length} White · ${c.black.length} Black lines</small></div><div class="sr-buy"><button class="small secondary" data-act="edit-pack" data-id="${c.id}">Edit</button> <button class="small danger" data-act="del-pack" data-id="${c.id}">Delete</button></div></div>`).join("")
      || '<small class="muted">None yet.</small>';
    if (T.state.custom.length < TYC.maxCustomPacks) html += '<div style="margin-top:8px"><button class="small" data-act="new-pack">New pack</button></div>';
    return html;
  }
  function shopItems() {
    const stash = T.stash(), eng = T.state.engines;
    const where = (id) => { for (const e of eng) if (e.items.includes(id)) return T.engineName(e.id); return null; };
    let html = '<small class="muted">Each engine holds an opening pack and two items. Put items on an engine with its Item menus on the table.</small>';
    for (const [type, d] of Object.entries(ITEMS)) {
      const cost = TYC.itemPrices[type], can = T.payPlan(cost);
      html += `<div class="shoprow"><div class="sr-main"><b>${d.icon} ${d.name}</b><br><small>${esc(d.blurb)}</small></div><div class="sr-buy"><div>${priceHtml(cost)}</div><button class="small" data-act="buy-item" data-type="${type}"${can ? "" : " disabled"}>Buy</button></div></div>`;
    }
    const all = Object.values(T.state.items);
    html += `<h2>Your items</h2>` + (all.length ? all.map((it) => `<div class="mini">${esc(itemLabel(it))} <small class="muted">${where(it.id) ? "on " + esc(where(it.id)) : "in the stash"}</small></div>`).join("") : '<small class="muted">Nothing yet.</small>');
    return html + (stash.length ? "" : "");
  }
  function renderShop(force = false) {
    const el = $("#hallShop"); if (!el) return;
    for (const b of root.querySelectorAll("#shopTabs button")) b.classList.toggle("secondary", b.dataset.tab !== shopTab);
    if (editor) { if (force || !el.querySelector("#packEditor")) el.innerHTML = editorHtml(); return; }
    el.innerHTML = shopTab === "engines" ? shopEngines() : shopTab === "openings" ? shopOpenings() : shopItems();
    lastShop = Date.now();
  }
  function renderShopSoon(now = false) {
    if (editor) return;
    if (now) { renderShop(); return; }
    if (shopTimer) return;
    shopTimer = setTimeout(() => { shopTimer = 0; renderShop(); }, Math.max(0, 1500 - (Date.now() - lastShop)));
  }

  // ---- the opening pack editor
  function editorHtml() {
    const e = editor, cols = collections().filter((c) => c.lines.length);
    return `<div id="packEditor"><h2>${e.id ? "Edit" : "New"} opening pack</h2>
      <input type="text" id="pkName" placeholder="Pack name" maxlength="30" value="${esc(e.name)}">
      <label class="lbl">Lines as White <small class="muted">(one per row, up to ${TYC.maxLinesPerSide}; e.g. 1. e4 e5 2. Nf3 Nc6)</small><textarea id="pkWhite" rows="5" spellcheck="false">${esc(e.white)}</textarea></label>
      <label class="lbl">Lines as Black <small class="muted">(start from move 1 and include White's moves)</small><textarea id="pkBlack" rows="5" spellcheck="false">${esc(e.black)}</textarea></label>
      ${cols.length ? `<div class="row"><select id="pkCol" style="width:auto;flex:1;margin:0">${cols.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.color}, ${c.lines.length} lines)</option>`).join("")}</select><button class="small secondary" data-act="pk-import">Add its lines</button></div>` : ""}
      <div id="pkMsg" class="bad" style="min-height:22px;margin:6px 0"></div>
      <div class="row"><button data-act="pk-save">Save pack</button><button class="secondary" data-act="pk-cancel">Cancel</button></div></div>`;
  }
  const readEditor = () => { editor.name = $("#pkName").value; editor.white = $("#pkWhite").value; editor.black = $("#pkBlack").value; };

  // ------------------------------------------------------------------ events
  const say = (r) => { if (!r.ok) notify(r.error); return r.ok; };
  const refreshAll = () => { buildCards(); renderLocked(); renderBank(); renderAllCards(); renderShop(); changed(); };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT" || b.type === "checkbox") return;
    const a = b.dataset.act, i = Number(b.dataset.t);
    if (actx && actx.state === "suspended") actx.resume();
    switch (a) {
      case "pay": T.setPay(b.dataset.m); renderBank(); renderAllCards(true); renderShop(); break;
      case "shoptab": shopTab = b.dataset.tab; editor = null; renderShop(true); break;
      case "buyslot": if (say(T.buySlot())) refreshAll(); break;
      case "speed": if (say(T.upgradeSpeed(i))) { renderBank(); renderAllCards(true); renderShop(); changed(); } break;
      case "stage": { const t = T.state.tables[i]; T.setStage(i, t.stage + Number(b.dataset.d)); abort(i); renderCard(i, true); break; }
      case "buy-engine": if (say(T.buyEngine(Number(b.dataset.tier)))) { renderBank(); renderAllCards(true); renderShop(true); changed(); } break;
      case "buy-pack": if (say(T.buyPack(b.dataset.id))) { renderBank(); renderAllCards(true); renderShop(true); changed(); } break;
      case "buy-item": if (say(T.buyItem(b.dataset.type))) { renderBank(); renderAllCards(true); renderShop(true); changed(); } break;
      case "new-pack": editor = { id: null, name: "", white: "", black: "" }; renderShop(true); break;
      case "edit-pack": { const c = T.state.custom.find((x) => x.id === b.dataset.id); if (c) { editor = { id: c.id, name: c.name, white: c.white.join("\n"), black: c.black.join("\n") }; renderShop(true); } break; }
      case "del-pack": if (confirm("Delete this opening pack?")) { T.deleteCustomPack(b.dataset.id); renderAllCards(true); renderShop(true); changed(); } break;
      case "pk-cancel": editor = null; renderShop(true); break;
      case "pk-save": {
        readEditor();
        const r = T.saveCustomPack({ id: editor.id, name: editor.name, white: editor.white.split("\n"), black: editor.black.split("\n") });
        if (!r.ok) { $("#pkMsg").textContent = r.error; break; }
        editor = null; renderAllCards(true); renderShop(true); changed(); notify("Opening pack saved."); break;
      }
      case "pk-import": {
        readEditor();
        const c = collections().find((x) => x.id === $("#pkCol").value); if (!c) break;
        const key = c.color === "black" ? "black" : "white", have = editor[key].split("\n").filter((x) => x.trim()), add = [];
        for (const l of c.lines) {
          if (have.length + add.length >= TYC.maxLinesPerSide) break;
          if (l.start) continue;
          const uc = l.moves.slice(0, TYC.maxLineMoves * 2), san = lineToSan(uc);
          if (san && uc.length) add.push(san);
        }
        editor[key] = [...have, ...add].join("\n"); renderShop(true);
        notify(add.length ? `Added ${add.length} line${add.length === 1 ? "" : "s"} to the ${key} lines.` : "Nothing to add (lines from custom positions are skipped, and each side holds up to " + TYC.maxLinesPerSide + ").");
        break;
      }
      default:
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const a = el.dataset.act, i = Number(el.dataset.t), eng = () => T.state.tables[i] && T.state.tables[i].engine;
    switch (a) {
      case "bg": T.setBackground(el.checked); wake(); changed(); break;
      case "sound": T.setSound(el.checked); changed(); break;
      case "auto": T.setAuto(i, el.checked); changed(); break;
      case "engine": T.assignEngine(i, el.value || null); for (let k = 0; k < runners.length; k++) abort(k); renderAllCards(true); renderShop(true); changed(); break;
      case "book": if (eng()) say(T.setBook(eng(), el.value || null)); renderAllCards(true); changed(); break;
      case "slot": if (eng()) { const r = T.equip(eng(), Number(el.dataset.s), el.value || null); say(r); } renderAllCards(true); renderShop(true); changed(); break;
      default:
    }
  });
  $("#hallExit").onclick = () => root.dispatchEvent(new CustomEvent("hall-exit"));

  // beads timers tick, and anything that was waiting for a menu to close gets drawn
  setInterval(() => {
    if (!canDraw()) return;
    for (let i = 0; i < cards.length; i++) if (cards[i].dirty) renderCard(i);
    if (T.stash().length + T.state.engines.length && !editor) {
      for (const it of Object.values(T.state.items)) if (it.type === "beads") { renderAllCards(); break; }
    }
  }, 1000);
  document.addEventListener("visibilitychange", () => { wake(); if (canDraw()) redrawAll(); });

  // ------------------------------------------------------------------ public
  refreshAll();
  return {
    setVisible(v) { visible = !!v; if (visible) { refreshAll(); redrawAll(); } wake(); },
    refresh() { refreshAll(); },
    /** The saved game was replaced (login, logout): start over from it. */
    reload() { for (let i = 0; i < runners.length; i++) abort(i); cur.length = 0; refreshAll(); renderAllCards(true); },
    moneyChanged() { renderBank(); renderLocked(); renderAllCards(); renderShopSoon(); },
  };
}

// Chess Tournament Tycoon: the rules, the economy and the saved state. Pure logic (no DOM, no chess playing).
// The host supplies storage, the clock and a wallet (gold, level, and a way to hand out boss rewards).
import { parseLine } from "./botplay.js";
import { PACK_FAMILIES } from "./packs.js";

export const TYC = {
  botPerGold: 100,                       // 1 gold buys the same as 100 bot EXP
  slotLevels: [10, 50, 100, 200],        // player level needed to unlock table 2, 3, 4, 5
  packLevels: { 3: 2, 5: 4, 10: 10, 15: 20 },          // sample opening packs by length in moves: level needed ...
  packPrices: { 3: 150, 5: 500, 10: 2000, 15: 6000 },  // ... and gold price
  customPackLevel: 50, maxCustomPacks: 5, maxLinesPerSide: 10, maxLineMoves: 30,
  itemPrices: { beads: 1000, paintball: 10000, duck: 100 },
  beadsMs: 3600000, soreMs: 2 * 3600000,  // beads work for 1 hour, then the engine is sore for 2 more
  titledBelow: 0.05,                      // no paintball against an opponent the engine beats less than 5% of the time
  bossAfter: 5,                           // a boss appears after this many wins at a stage
  bossRetreatTo: 2,                       // after losing to the boss, 3 more wins are needed
  repeatBossShare: 0.25,                  // beating a boss again pays a quarter
  speed: { base: 1200, factor: 0.88, floor: 40 },      // ms between moves at level 0, the factor per upgrade, and the fastest possible
  maxEngines: 40, maxItems: 60,
};

// ------------------------------------------------------------------ the ladder of engines (they are both the ones you can buy and the opponents you face)
// elo is nominal: the silly engines are rated by how they score against each other and against Stockfish at low strength.
const E = (id, name, blurb, elo, cfg) => ({ id, name, blurb, elo, cfg });
export const LADDER = [
  E("alphaFirst", "Alphabet Al", "Plays the alphabetically first legal move. Loves his bishops.", 150, { style: "alphaFirst" }),
  E("pacifist", "Pacifist Pat", "Will not capture anything if there is any alternative.", 250, { style: "pacifist" }),
  E("random", "Random Rodney", "Closes his eyes and plays any legal move.", 350, { style: "random" }),
  E("checker", "Checky Chuck", "Checks whenever he can. Thinks about nothing else.", 500, { style: "checker" }),
  E("alphaLast", "Zed", "Plays the alphabetically last legal move. Pushes pawns.", 550, { style: "alphaLast" }),
  E("greedy", "Greedy Gus", "Captures the most valuable piece he can see.", 650, { style: "greedy" }),
  E("s1", "Shallow Sam", "Looks one move ahead.", 700, { style: "search", depth: 1, noise: 40, nodes: 4000 }),
  E("s2", "Deep-ish Dana", "Looks two moves ahead.", 850, { style: "search", depth: 2, noise: 25, nodes: 4000 }),
  E("s3", "Tactical Tina", "Looks three moves ahead and checks the captures.", 950, { style: "search", depth: 3, noise: 10, nodes: 5000, quiet: 2 }),
  E("sk0", "Club Kid", "Stockfish on its easiest setting.", 1100, { style: "sf", skill: 0 }),
  E("sk5", "Weekend Warrior", "Stockfish, a little more awake.", 1250, { style: "sf", skill: 5 }),
  E("e1320", "Local Hero", "Stockfish limited to about 1300.", 1320, { style: "sf", elo: 1320 }),
  E("e1500", "Club Captain", "Stockfish limited to about 1500.", 1500, { style: "sf", elo: 1500 }),
  E("e1700", "Tournament Regular", "Stockfish limited to about 1700.", 1700, { style: "sf", elo: 1700 }),
  E("e1900", "Candidate", "Stockfish limited to about 1900.", 1900, { style: "sf", elo: 1900 }),
  E("e2100", "Expert", "Stockfish limited to about 2100.", 2100, { style: "sf", elo: 2100 }),
  E("e2300", "FIDE Master", "Stockfish limited to about 2300.", 2300, { style: "sf", elo: 2300 }),
  E("e2500", "Grandmaster", "Stockfish limited to about 2500.", 2500, { style: "sf", elo: 2500 }),
  E("e2700", "Super Grandmaster", "Stockfish limited to about 2700.", 2700, { style: "sf", elo: 2700 }),
  E("e2900", "World Champion", "Stockfish limited to about 2900.", 2900, { style: "sf", elo: 2900 }),
  E("e3100", "The Machine", "Stockfish limited to about 3100.", 3100, { style: "sf", elo: 3100 }),
  E("full", "Stockfish 19", "Stockfish at full strength.", 3400, { style: "sf", elo: null }),
];
export const STARTER_TIER = 2;                                   // everyone starts with Random Rodney
export const STAGES = LADDER.length - 1;                          // stage s: regular opponents are rung s, the boss is rung s + 1

// ------------------------------------------------------------------ formulas
const nice = (n) => { if (n < 20) return Math.max(1, Math.round(n)); const p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };
export const expectedScore = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
export const engineCost = (tier) => nice(10 * Math.pow(1.5, tier));
export const speedDelay = (level) => Math.max(TYC.speed.floor, Math.round(TYC.speed.base * Math.pow(TYC.speed.factor, level)));
export const maxSpeedLevel = (() => { let n = 0; while (speedDelay(n) > TYC.speed.floor) n++; return n; })();
export const speedCost = (level) => nice(2 * Math.pow(1.5, level));       // price of going from `level` to `level + 1`
export const slotCost = (level) => Math.round((400 * Math.log(level) ** 2) / 10) * 10;
/** Bot EXP for a win against rung r (a draw pays a quarter). */
export const botReward = (rung, outcome, boss = false) => {
  const win = Math.round(30 * Math.pow(1.28, rung)) * (boss ? 3 : 1);
  return outcome === "win" ? win : outcome === "draw" ? Math.max(1, Math.floor(win / 4)) : 0;
};
/** Gold and player EXP for beating the boss of a stage; a repeat pays a quarter. */
export const bossReward = (stage, first = true) => {
  const f = first ? 1 : TYC.repeatBossShare;
  return { gold: Math.max(1, Math.round(20 * Math.pow(1.35, stage) * f)), exp: Math.max(1, Math.round(10 * Math.pow(1.3, stage) * f)) };
};

// ------------------------------------------------------------------ opening packs
let sampleCache = null;
/** The sample packs: [{ id, name, moves, level, price, white: [[uci]], black: [[uci]] }] */
export function samplePacks() {
  if (sampleCache) return sampleCache;
  sampleCache = [];
  for (const f of PACK_FAMILIES) for (const moves of [3, 5, 10, 15]) {
    const cut = (texts) => texts.map((t) => parseLine(t).ucis.slice(0, moves * 2));
    sampleCache.push({ id: `${f.id}-${moves}`, name: `${f.name} · ${moves} moves`, family: f.name, moves, level: TYC.packLevels[moves], price: TYC.packPrices[moves], white: cut(f.white), black: cut(f.black) });
  }
  return sampleCache;
}

export const ITEMS = {
  beads: { name: "Chess Beads", icon: "📿", blurb: "Plays one rung stronger for 1 hour, then is sore for 2 more." },
  paintball: { name: "Instant Resignation Device", icon: "🔫", blurb: "A paintball gun: wins one game outright. Useless against titled opponents.", consumable: true },
  duck: { name: "Duck", icon: "🦆", blurb: "Quacks every time the engine wins." },
};

// ------------------------------------------------------------------ state
const newTable = (engine = null) => ({ engine, speed: 0, stage: 0, maxStage: 0, wins: 0, games: 0, w: 0, d: 0, l: 0, auto: true });
const fresh = () => ({
  v: 1, ts: 0, nextId: 2, botExp: 0, pay: "auto", bg: false, sound: true,
  engines: [{ id: "e1", tier: STARTER_TIER, book: null, items: [null, null], w: 0, d: 0, l: 0 }],
  tables: [newTable("e1")], packs: [], custom: [], items: {}, firstClears: [],
  stats: { wins: 0, draws: 0, losses: 0, bosses: 0, botTotal: 0 },
});
const num = (x, lo, hi, d = 0) => { x = Number(x); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.floor(x))) : d; };

/** Make anything that was saved (or came from the server) safe to use. */
export function sanitize(o) {
  const s = fresh();
  if (!o || typeof o !== "object" || o.v !== 1) return s;
  s.ts = num(o.ts, 0, 9e15); s.nextId = num(o.nextId, 2, 1e9, 2); s.botExp = num(o.botExp, 0, 9e15);
  s.pay = ["auto", "gold", "bot"].includes(o.pay) ? o.pay : "auto"; s.bg = !!o.bg; s.sound = o.sound !== false;
  const ids = new Set();
  s.engines = [];
  for (const e of Array.isArray(o.engines) ? o.engines.slice(0, TYC.maxEngines) : []) {
    if (!e || typeof e.id !== "string" || ids.has(e.id) || !LADDER[e.tier]) continue;
    ids.add(e.id);
    s.engines.push({ id: e.id, tier: e.tier, book: typeof e.book === "string" ? e.book : null, items: [0, 1].map((i) => (Array.isArray(e.items) && typeof e.items[i] === "string" ? e.items[i] : null)), w: num(e.w, 0, 9e9), d: num(e.d, 0, 9e9), l: num(e.l, 0, 9e9) });
  }
  s.items = {};
  for (const [id, it] of Object.entries(o.items && typeof o.items === "object" ? o.items : {})) {
    if (Object.keys(s.items).length >= TYC.maxItems) break;
    if (it && ITEMS[it.type]) s.items[id] = { id, type: it.type, activeUntil: num(it.activeUntil, 0, 9e15), soreUntil: num(it.soreUntil, 0, 9e15) };
  }
  const used = new Set();
  for (const e of s.engines) e.items = e.items.map((id) => (id && s.items[id] && !used.has(id) ? (used.add(id), id) : null));
  s.custom = [];
  for (const c of Array.isArray(o.custom) ? o.custom.slice(0, TYC.maxCustomPacks) : []) {
    if (!c || typeof c.id !== "string") continue;
    s.custom.push({ id: c.id, name: String(c.name || "My pack").slice(0, 30), white: (Array.isArray(c.white) ? c.white : []).slice(0, TYC.maxLinesPerSide).map((x) => String(x).slice(0, 200)), black: (Array.isArray(c.black) ? c.black : []).slice(0, TYC.maxLinesPerSide).map((x) => String(x).slice(0, 200)) });
  }
  const sampleIds = new Set(samplePacks().map((p) => p.id));
  s.packs = (Array.isArray(o.packs) ? o.packs : []).filter((id, i, a) => sampleIds.has(id) && a.indexOf(id) === i);
  const bookOk = (k) => k && (s.packs.includes(k) || s.custom.some((c) => c.id === k));
  for (const e of s.engines) if (!bookOk(e.book)) e.book = null;
  s.tables = [];
  for (const t of Array.isArray(o.tables) ? o.tables.slice(0, 1 + TYC.slotLevels.length) : []) {
    if (!t) continue;
    const maxStage = num(t.maxStage, 0, STAGES - 1);
    s.tables.push({ engine: ids.has(t.engine) && !s.tables.some((x) => x.engine === t.engine) ? t.engine : null, speed: num(t.speed, 0, maxSpeedLevel), maxStage, stage: Math.min(num(t.stage, 0, STAGES - 1), maxStage), wins: num(t.wins, 0, TYC.bossAfter), games: num(t.games, 0, 9e9), w: num(t.w, 0, 9e9), d: num(t.d, 0, 9e9), l: num(t.l, 0, 9e9), auto: t.auto !== false });
  }
  if (!s.tables.length) s.tables.push(newTable(s.engines[0] ? s.engines[0].id : null));
  if (!s.engines.length) { s.engines.push({ id: "e1", tier: STARTER_TIER, book: null, items: [null, null], w: 0, d: 0, l: 0 }); s.tables[0].engine = "e1"; }
  s.firstClears = (Array.isArray(o.firstClears) ? o.firstClears : []).map((x) => num(x, 0, STAGES - 1, -1)).filter((x, i, a) => x >= 0 && a.indexOf(x) === i);
  const st = o.stats || {};
  s.stats = { wins: num(st.wins, 0, 9e12), draws: num(st.draws, 0, 9e12), losses: num(st.losses, 0, 9e12), bosses: num(st.bosses, 0, 9e12), botTotal: num(st.botTotal, 0, 9e15) };
  return s;
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

/**
 * wallet: { gold(): number, level(): number, spend(gold): void, grant({ gold, exp }): { gold, exp } }
 * load(): saved object|null, save(object), now(): ms
 */
export function createTycoon({ load, save, wallet, now = Date.now }) {
  let s = fresh();
  try { s = sanitize(load()); } catch { /* start fresh */ }
  const bookCache = new Map();
  const commit = () => { s.ts = Math.max(now(), s.ts + 1); try { save(s); } catch { /* ignore */ } };
  const engine = (id) => s.engines.find((e) => e.id === id) || null;
  const equipped = () => { const set = new Set(); for (const e of s.engines) for (const i of e.items) if (i) set.add(i); return set; };
  const newId = (p) => p + s.nextId++;

  // ---- paying: gold, bot EXP, or bot EXP first and gold for the rest
  function payPlan(cost) {
    const gold = wallet.gold(), bot = s.botExp, B = TYC.botPerGold;
    if (s.pay === "gold") return gold >= cost ? { gold: cost, bot: 0 } : null;
    if (s.pay === "bot") return bot >= cost * B ? { gold: 0, bot: cost * B } : null;
    const viaBot = Math.min(cost, Math.floor(bot / B)), rest = cost - viaBot;
    return gold >= rest ? { gold: rest, bot: viaBot * B } : null;
  }
  const charge = (cost) => {
    const plan = payPlan(cost);
    if (!plan) return null;
    if (plan.gold) wallet.spend(plan.gold);
    s.botExp -= plan.bot;
    return plan;
  };
  const tooPoor = (cost) => `Not enough ${s.pay === "bot" ? "bot EXP" : s.pay === "gold" ? "gold" : "gold or bot EXP"} (it costs ${cost.toLocaleString()} gold${s.pay === "gold" ? "" : ", or " + (cost * TYC.botPerGold).toLocaleString() + " bot EXP"}).`;

  // ---- beads
  function beadsStatus(item, t = now()) {
    if (t < item.activeUntil) return { state: "active", left: item.activeUntil - t };
    if (t < item.soreUntil) return { state: "sore", left: item.soreUntil - t };
    return { state: "ready", left: 0 };
  }
  const itemsOf = (eng) => eng.items.map((id) => (id ? s.items[id] : null));
  const has = (eng, type) => itemsOf(eng).find((i) => i && i.type === type) || null;

  const bookFor = (eng) => {
    if (!eng.book) return null;
    const hit = bookCache.get(eng.book);
    if (hit) return hit;
    let b = null;
    const sample = samplePacks().find((p) => p.id === eng.book);
    if (sample) b = { white: sample.white, black: sample.black };
    else {
      const c = s.custom.find((x) => x.id === eng.book);
      if (c) { const conv = (a) => a.map((t) => parseLine(t)).filter((r) => r.ok).map((r) => r.ucis); b = { white: conv(c.white), black: conv(c.black) }; }
    }
    if (b) bookCache.set(eng.book, b);
    return b;
  };

  return {
    get state() { return s; },
    get wallet() { return wallet; },
    /** Replace the state with one from the server if it is newer. Returns true if it was taken. */
    adopt(remote, force = false) { const r = sanitize(remote); if (!force && r.ts <= s.ts) return false; s = r; bookCache.clear(); try { save(s); } catch { /* ignore */ } return true; },
    /** Back to a brand new game (logging out). It has no timestamp, so any saved game from an account replaces it. */
    reset() { s = fresh(); bookCache.clear(); try { save(s); } catch { /* ignore */ } },
    level: () => wallet.level(),
    balance() { return { gold: wallet.gold(), bot: s.botExp, total: wallet.gold() + Math.floor(s.botExp / TYC.botPerGold) }; },
    payPlan, tooPoor,
    engineName(id) {
      const e = engine(id); if (!e) return "";
      const same = s.engines.filter((x) => x.tier === e.tier);
      return LADDER[e.tier].name + (same.length > 1 ? " #" + (same.indexOf(e) + 1) : "");
    },
    engineById: engine,
    equippedIds: equipped,
    stash() { const eq = equipped(); return Object.values(s.items).filter((i) => !eq.has(i.id)); },
    beadsStatus, itemsOf, bookFor,
    packList() { // every pack the player owns, for the opening slot
      return [...s.packs.map((id) => samplePacks().find((p) => p.id === id)).filter(Boolean).map((p) => ({ id: p.id, name: p.name })), ...s.custom.map((c) => ({ id: c.id, name: c.name + " (mine)" }))];
    },

    // ---- settings
    setPay(mode) { if (["auto", "gold", "bot"].includes(mode)) { s.pay = mode; commit(); } },
    setBackground(on) { s.bg = !!on; commit(); },
    setSound(on) { s.sound = !!on; commit(); },
    setAuto(ti, on) { const t = s.tables[ti]; if (t) { t.auto = !!on; commit(); } },
    setStage(ti, stage) {
      const t = s.tables[ti]; if (!t) return fail("No such table.");
      stage = num(stage, 0, t.maxStage); if (stage !== t.stage) { t.stage = stage; t.wins = 0; commit(); }
      return ok();
    },

    // ---- buying
    buyEngine(tier) {
      const L = LADDER[tier]; if (!L) return fail("No such engine.");
      if (s.engines.length >= TYC.maxEngines) return fail("You have as many engines as the hall can hold.");
      const cost = engineCost(tier), paid = charge(cost);
      if (!paid) return fail(tooPoor(cost));
      const e = { id: newId("e"), tier, book: null, items: [null, null], w: 0, d: 0, l: 0 };
      s.engines.push(e); commit(); return ok({ id: e.id, paid });
    },
    assignEngine(ti, engId) {
      const t = s.tables[ti]; if (!t) return fail("No such table.");
      if (engId && !engine(engId)) return fail("No such engine.");
      if (engId) { const other = s.tables.find((x) => x !== t && x.engine === engId); if (other) other.engine = t.engine; }
      t.engine = engId || null; t.wins = Math.min(t.wins, TYC.bossAfter - 1); commit(); return ok();
    },
    nextSlot() {
      const n = s.tables.length;
      if (n > TYC.slotLevels.length) return null;
      const level = TYC.slotLevels[n - 1], cost = slotCost(level);
      return { level, cost, unlocked: wallet.level() >= level };
    },
    buySlot() {
      const nx = this.nextSlot(); if (!nx) return fail("Every table is already open.");
      if (!nx.unlocked) return fail(`Reach level ${nx.level} to open this table.`);
      const paid = charge(nx.cost); if (!paid) return fail(tooPoor(nx.cost));
      s.tables.push(newTable()); commit(); return ok({ paid });
    },
    speedInfo(ti) {
      const t = s.tables[ti]; if (!t) return null;
      const maxed = t.speed >= maxSpeedLevel;
      return { level: t.speed, delay: speedDelay(t.speed), maxed, cost: maxed ? 0 : speedCost(t.speed), nextDelay: maxed ? 0 : speedDelay(t.speed + 1) };
    },
    upgradeSpeed(ti) {
      const t = s.tables[ti]; if (!t) return fail("No such table.");
      if (t.speed >= maxSpeedLevel) return fail("This table is already at top speed.");
      const cost = speedCost(t.speed), paid = charge(cost); if (!paid) return fail(tooPoor(cost));
      t.speed++; commit(); return ok({ paid });
    },
    buyPack(id) {
      const p = samplePacks().find((x) => x.id === id); if (!p) return fail("No such pack.");
      if (s.packs.includes(id)) return fail("You already own this pack.");
      if (wallet.level() < p.level) return fail(`Reach level ${p.level} to buy this pack.`);
      const paid = charge(p.price); if (!paid) return fail(tooPoor(p.price));
      s.packs.push(id); commit(); return ok({ paid });
    },
    buyItem(type) {
      if (!ITEMS[type]) return fail("No such item.");
      if (Object.keys(s.items).length >= TYC.maxItems) return fail("Your stash is full.");
      const cost = TYC.itemPrices[type], paid = charge(cost); if (!paid) return fail(tooPoor(cost));
      const it = { id: newId("i"), type, activeUntil: 0, soreUntil: 0 };
      s.items[it.id] = it; commit(); return ok({ id: it.id, paid });
    },

    // ---- opening packs of your own
    /** def: { id?, name, white: [text], black: [text] } with lines like "1. e4 e5 2. Nf3". */
    saveCustomPack(def) {
      if (wallet.level() < TYC.customPackLevel) return fail(`Reach level ${TYC.customPackLevel} to make your own packs.`);
      const name = String(def.name || "").trim().slice(0, 30) || "My pack";
      const clean = (arr, side) => {
        const out = [];
        for (const raw of arr || []) {
          const text = String(raw || "").trim(); if (!text) continue;
          const r = parseLine(text);
          if (!r.ok) throw new Error(`${side}: ${r.error}`);
          if (r.ucis.length > TYC.maxLineMoves * 2) throw new Error(`${side}: a line can be at most ${TYC.maxLineMoves} moves.`);
          out.push(text.slice(0, 200));
        }
        if (out.length > TYC.maxLinesPerSide) throw new Error(`${side}: at most ${TYC.maxLinesPerSide} lines.`);
        return out;
      };
      let white, black;
      try { white = clean(def.white, "White"); black = clean(def.black, "Black"); } catch (e) { return fail(e.message); }
      if (!white.length && !black.length) return fail("Add at least one line.");
      const old = def.id ? s.custom.findIndex((c) => c.id === def.id) : -1;
      if (old < 0 && s.custom.length >= TYC.maxCustomPacks) return fail(`You can keep ${TYC.maxCustomPacks} packs of your own. Delete one first.`);
      const pack = { id: old >= 0 ? s.custom[old].id : newId("c"), name, white, black };
      if (old >= 0) s.custom[old] = pack; else s.custom.push(pack);
      bookCache.delete(pack.id); commit(); return ok({ id: pack.id });
    },
    deleteCustomPack(id) {
      const i = s.custom.findIndex((c) => c.id === id); if (i < 0) return fail("No such pack.");
      s.custom.splice(i, 1); for (const e of s.engines) if (e.book === id) e.book = null;
      bookCache.delete(id); commit(); return ok();
    },
    setBook(engId, key) {
      const e = engine(engId); if (!e) return fail("No such engine.");
      if (key && !s.packs.includes(key) && !s.custom.some((c) => c.id === key)) return fail("You don't own that pack.");
      e.book = key || null; commit(); return ok();
    },
    /** Put an item from the stash into one of an engine's two free slots (null empties the slot). */
    equip(engId, slot, itemId) {
      const e = engine(engId); if (!e) return fail("No such engine.");
      if (slot !== 0 && slot !== 1) return fail("No such slot.");
      if (itemId) {
        const it = s.items[itemId]; if (!it) return fail("No such item.");
        if (equipped().has(itemId)) return fail("That item is already in use. Take it off first.");
        if (e.items.some((id, i) => i !== slot && id && s.items[id] && s.items[id].type === it.type)) return fail(`This engine already carries one of those.`);
      }
      e.items[slot] = itemId || null; commit(); return ok();
    },

    // ---- playing
    stageInfo(ti) {
      const t = s.tables[ti]; if (!t) return null;
      const boss = t.wins >= TYC.bossAfter;
      return { stage: t.stage, maxStage: t.maxStage, wins: t.wins, boss, rung: LADDER[t.stage], bossRung: LADDER[Math.min(LADDER.length - 1, t.stage + 1)], first: !s.firstClears.includes(t.stage) };
    },
    /** Everything needed to play the table's next game, or null if the table has no engine. */
    planGame(ti) {
      const t = s.tables[ti], eng = t && engine(t.engine); if (!eng) return null;
      const boss = t.wins >= TYC.bossAfter, oppRung = boss ? Math.min(LADDER.length - 1, t.stage + 1) : t.stage;
      const beads = has(eng, "beads"); let beadsOn = false;
      if (beads) {
        let st = beadsStatus(beads);
        if (st.state === "ready") { beads.activeUntil = now() + TYC.beadsMs; beads.soreUntil = beads.activeUntil + TYC.soreMs; st = beadsStatus(beads); commit(); }
        beadsOn = st.state === "active";
      }
      const effTier = Math.min(LADDER.length - 1, eng.tier + (beadsOn ? 1 : 0));
      const chance = expectedScore(LADDER[effTier].elo, LADDER[oppRung].elo);
      const titled = chance < TYC.titledBelow, gun = has(eng, "paintball");
      return {
        table: ti, engineId: eng.id, tier: eng.tier, effTier, beadsOn, cfg: LADDER[effTier].cfg, elo: LADDER[effTier].elo,
        color: t.games % 2 === 0 ? "white" : "black", book: bookFor(eng),
        opp: { rung: oppRung, name: LADDER[oppRung].name, cfg: LADDER[oppRung].cfg, elo: LADDER[oppRung].elo },
        boss, stage: t.stage, chance, titled, paintball: gun && !titled ? gun.id : null, duck: !!has(eng, "duck"),
        delay: speedDelay(t.speed),
      };
    },
    /**
     * A game is over. outcome: "win" | "draw" | "loss" for the table's engine; opts.paintball: it was won with the gun.
     * Returns { ok, outcome, bot, boss: null | { first, gold, exp, gotGold, gotExp, capped }, advanced, quack, stage, wins }.
     */
    finishGame(ti, plan, outcome, opts = {}) {
      const t = s.tables[ti], eng = t && engine(t.engine);
      if (!eng || !plan || plan.engineId !== eng.id) return fail("That game no longer counts.");
      t.games++;
      const res = { ok: true, outcome, bot: 0, boss: null, advanced: false, quack: false, paintball: !!opts.paintball };
      if (outcome === "win") { t.w++; eng.w++; s.stats.wins++; } else if (outcome === "draw") { t.d++; eng.d++; s.stats.draws++; } else { t.l++; eng.l++; s.stats.losses++; }
      res.bot = botReward(plan.opp.rung, outcome, plan.boss);
      s.botExp += res.bot; s.stats.botTotal += res.bot;
      if (opts.paintball && plan.paintball && s.items[plan.paintball]) {            // the gun is used up
        delete s.items[plan.paintball]; eng.items = eng.items.map((id) => (id === plan.paintball ? null : id));
      }
      if (outcome === "win" && plan.duck) res.quack = true;
      if (plan.boss) {
        if (outcome === "win") {
          s.stats.bosses++;
          const first = !s.firstClears.includes(plan.stage), r = bossReward(plan.stage, first);
          const got = wallet.grant({ gold: r.gold, exp: r.exp });
          res.boss = { first, gold: r.gold, exp: r.exp, gotGold: got.gold, gotExp: got.exp, capped: got.gold < r.gold || got.exp < r.exp };
          if (first) s.firstClears.push(plan.stage);
          t.wins = 0;
          if (plan.stage === t.maxStage && t.maxStage < STAGES - 1) {
            t.maxStage++; res.advanced = true;
            if (t.auto && t.stage === plan.stage) t.stage = t.maxStage;
          }
        } else if (outcome === "loss") t.wins = TYC.bossRetreatTo;
      } else if (outcome === "win") t.wins = Math.min(TYC.bossAfter, t.wins + 1);
      res.stage = t.stage; res.wins = t.wins;
      commit();
      return res;
    },
  };
}

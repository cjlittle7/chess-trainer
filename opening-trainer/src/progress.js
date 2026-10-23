// Training EXP, daily caps, lifetime stats and auto-clicker detection. Pure logic: main.js supplies storage and the clock.

export const RULES = {
  perMove: 1,                    // EXP for each of your own moves in a completed line
  perfect: 5,                    // extra for a perfect line (no wrong attempts, no hints)
  longBonus: [10, 15, 20, 25],   // a perfect line with at least this many of your moves earns +5 more for each milestone reached
  longBonusExp: 5,
  perLinePerDay: 5,              // each line or puzzle earns EXP for its first 5 completions each day
  goldPerLine: 10,               // gold for the first completion of each line or puzzle each day
  tomatoPerGold: 5,              // every 5 tomatoes thrown earn 1 gold ...
  tomatoGoldPerDay: 20,          // ... up to this much gold per day
  streakExp: { base: 50, step: 10, cap: 1000 },    // day n of a perfect-line streak: min(cap, base + step * n) EXP
  streakGold: { base: 10, step: 5, cap: 500 },     // and min(cap, base + step * n) gold
  tomatoPerThrow: 1,
  tomatoPerDay: 100,             // tomato EXP cap per day
  lockMinutes: 30,               // how long the button stays inactive after auto-clicking is detected
  tycoonExpPerDay: 2000,         // boss rewards from the tournament hall: EXP and gold per day
  tycoonGoldPerDay: 15000,
};

/** EXP for finishing a line: { base, perfect, long, total }. */
export function lineExp(moves, perfect) {
  const base = Math.max(0, moves) * RULES.perMove;
  if (!perfect) return { base, perfect: 0, long: 0, total: base };
  const long = RULES.longBonus.filter((m) => moves >= m).length * RULES.longBonusExp;
  return { base, perfect: RULES.perfect, long, total: base + RULES.perfect + long };
}

// Collectable achievements. Each category has tiers; a tier unlocks when its stat reaches the threshold, and stays unlocked.
// Keep this list in step with ACH in tools/tomato-counter-worker.js.
const BIG = [1, 10, 100, 1000, 10000, 100000];
export const ACHIEVEMENTS = [
  { id: "perfectLines", name: "Perfect lines", icon: "♟", tiers: BIG, what: "Complete a line with no wrong moves and no hints.", stat: (p) => Math.max(0, p.life.perfect - p.life.perfectPuzzles) },
  { id: "perfectPuzzles", name: "Perfect puzzles", icon: "♞", tiers: BIG, what: "Solve a puzzle with no wrong moves and no hints.", stat: (p) => p.life.perfectPuzzles },
  { id: "exp", name: "Lifetime EXP", icon: "⭐", tiers: BIG, what: "Total training EXP earned.", stat: (p) => p.exp },
  { id: "gold", name: "Lifetime gold", icon: "◎", tiers: BIG, what: "Total gold earned (spending it never lowers this).", stat: (p) => p.life.goldTotal, coin: true },
  { id: "tomatoes", name: "Tomatoes thrown", icon: "🍅", tiers: BIG, what: "Tomatoes thrown on the study break page.", stat: (p) => p.life.tomatoes },
  { id: "run", name: "Perfect in a row", icon: "🎯", tiers: [10, 50, 100, 1000, 10000], what: "Lines and puzzles in a row with no wrong moves and no hints. Your best run counts.", stat: (p) => p.run.best },
  { id: "login", name: "Days in a row", icon: "📅", tiers: [7, 30, 100, 365], what: "Consecutive days signed in to your account. Your best streak counts.", stat: (p) => p.login.best, needsAccount: true },
];
export const achId = (cat, tier) => `${cat}:${tier}`;

/** Reward for the nth consecutive day with a perfectly solved line or puzzle. */
export function streakReward(n) {
  const k = Math.max(1, Math.floor(n));
  return { exp: Math.min(RULES.streakExp.cap, RULES.streakExp.base + RULES.streakExp.step * k),
           gold: Math.min(RULES.streakGold.cap, RULES.streakGold.base + RULES.streakGold.step * k) };
}

/** EXP needed to go from level n to level n+1: 100 + (100 * (n - 1)) ^ (1.001 ^ n), rounded down to a multiple of 10. */
export function expToNext(n) { return Math.floor((100 + Math.pow(100 * (n - 1), Math.pow(1.001, n))) / 10) * 10; }

/** Level for a total EXP amount: { level, into (EXP into this level), need (EXP for the next), pct (0..1) }. */
export function levelInfo(exp) {
  let level = 1, rem = Math.max(0, Math.floor(exp));
  for (let need = expToNext(level); rem >= need && level < 10000; need = expToNext(level)) { rem -= need; level++; }
  const need = expToNext(level);
  return { level, into: rem, need, pct: rem / need };
}

/**
 * Auto-clicker check. `times` are press timestamps in ms (oldest first), `trusted` is the browser's isTrusted flag for the latest press.
 * Returns a reason string, or "" if the presses look human.
 */
export function detectAutoClick(times, trusted = true) {
  if (!trusted) return "synthetic clicks";
  const n = 10;
  if (times.length < n) return "";
  const t = times.slice(-n), gaps = [];
  for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean < 90) return "faster than a person can press";                       // over ~11 presses a second, sustained
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  if (mean < 700 && sd < 6) return "perfectly even timing";                       // people can't keep ten gaps within a few ms of each other
  return "";
}

const blank = () => ({
  v: 1, nick: "", acct: null, run: { cur: 0, best: 0 }, login: { cur: 0, best: 0 }, ach: {}, syncedAt: 0, q: { lines: [], tomato: 0, tomatoT: 0, texp: 0, tgold: 0, flagged: 0, spend: 0, tg: 0, te: 0 }, tycoonExpToday: 0, tycoonGoldToday: 0,
  exp: 0, gold: 0, day: "", todayLines: {}, tomatoExpToday: 0, tomatoToday: 0, tomatoGoldToday: 0, streak: { n: 0, today: false },
  achievedDay: "", lockedUntil: 0, flagged: 0,
  life: { lines: 0, puzzles: 0, perfect: 0, perfectPuzzles: 0, perfectMoves: 0, goldTotal: 0, tomatoes: 0 },
  perLine: {},                                                                   // "collection:line" -> { name, att, perfect, wrong, last }
});

/** storage: { load(): object|null, save(obj) }  today(): "YYYY-MM-DD"  now(): ms */
export function createProgress({ load, save, today, now = Date.now }) {
  let p = blank();
  try { const s = load(); if (s && s.v === 1) p = { ...blank(), ...s, life: { ...blank().life, ...s.life }, perLine: s.perLine || {}, run: { ...blank().run, ...s.run }, login: { ...blank().login, ...s.login }, ach: s.ach || {}, q: { ...blank().q, ...s.q, lines: (s.q && s.q.lines) || [] } }; } catch { /* start fresh */ }
  const roll = () => { const d = today(); if (p.day !== d) { p.day = d; p.todayLines = {}; p.tomatoExpToday = 0; p.tomatoToday = 0; p.tomatoGoldToday = 0; p.tycoonExpToday = 0; p.tycoonGoldToday = 0; } };
  const commit = () => { try { save(p); } catch { /* ignore */ } };
  roll();
  /** Unlock any achievements whose stat has been reached; returns the new ids. */
  const checkAch = () => {
    const added = [];
    for (const c of ACHIEVEMENTS) { const v = c.stat(p); for (const t of c.tiers) { const id = achId(c.id, t); if (v >= t && !p.ach[id]) { p.ach[id] = now(); added.push(id); } } }
    return added;
  };
  checkAch();                                                                    // progress saved by an older version unlocks what it already earned, quietly
  const recent = [];                                                             // last throws: { t, exp }

  return {
    get state() { roll(); return p; },
    /** How many more completions of this line still earn EXP today. */
    lineLeft(key) { roll(); return Math.max(0, RULES.perLinePerDay - (p.todayLines[key] || 0)); },
    tomatoGoldLeft() { roll(); return Math.max(0, RULES.tomatoGoldPerDay - p.tomatoGoldToday); },
    tomatoLeft() { roll(); return Math.max(0, RULES.tomatoPerDay - p.tomatoExpToday); },
    lockedFor() { return Math.max(0, p.lockedUntil - now()); },
    lock(minutes = RULES.lockMinutes) { p.lockedUntil = now() + minutes * 60000; p.flagged++; commit(); },
    setNick(n) { p.nick = String(n || "").trim().slice(0, 20); commit(); },

    /** A line or puzzle was completed. info: { key, name, moves, perfect, puzzle, wrong } */
    recordLine({ key, name, moves, perfect, puzzle, wrong = 0 }) {
      roll();
      const e = lineExp(moves, perfect);
      const used = p.todayLines[key] || 0;
      const earns = used < RULES.perLinePerDay, gold = used === 0 ? RULES.goldPerLine : 0;
      p.todayLines[key] = used + 1;
      if (earns) p.exp += e.total;
      p.gold += gold; p.life.goldTotal += gold;
      if (puzzle) p.life.puzzles++; else p.life.lines++;
      if (perfect) { p.life.perfect++; p.life.perfectMoves += moves; if (puzzle) p.life.perfectPuzzles++; p.run.cur++; if (p.run.cur > p.run.best) p.run.best = p.run.cur; } else p.run.cur = 0;
      const L = p.perLine[key] || (p.perLine[key] = { name, att: 0, perfect: 0, wrong: 0, last: "" });
      L.name = name; L.att++; if (perfect) L.perfect++; L.wrong += wrong; L.last = p.day;
      if (p.acct) p.q.lines.push({ t: now(), key, name, moves, perfect: !!perfect, puzzle: !!puzzle, wrong, exp: earns ? e.total : 0, gold, earned: earns });
      const unlocked = checkAch();
      commit();
      return { ...e, earned: earns ? e.total : 0, gold, capped: !earns, usedToday: used + 1, leftToday: Math.max(0, RULES.perLinePerDay - used - 1), unlocked };
    },

    /** A tomato was thrown. Returns { exp, achievement, locked, flagged }. */
    recordTomato(trusted = true) {
      roll();
      const t = now();
      if (p.lockedUntil > t) return { exp: 0, locked: true, flagged: false, achievement: false };
      const times = recent.map((r) => r.t).concat(t);
      const why = detectAutoClick(times, trusted);
      if (why) {                                                                 // disqualify the burst: take back its EXP and tomatoes
        let back = 0, n = 0;
        for (const r of recent.splice(0)) if (t - r.t < 30000) { back += r.exp; n++; }
        p.exp = Math.max(0, p.exp - back); p.tomatoExpToday = Math.max(0, p.tomatoExpToday - back);
        p.life.tomatoes = Math.max(0, p.life.tomatoes - n);
        p.tomatoToday = Math.max(0, p.tomatoToday - n);
        const goldNow = Math.min(RULES.tomatoGoldPerDay, Math.floor(p.tomatoToday / RULES.tomatoPerGold)), lost = Math.max(0, p.tomatoGoldToday - goldNow);
        p.gold = Math.max(0, p.gold - lost); p.life.goldTotal = Math.max(0, p.life.goldTotal - lost); p.tomatoGoldToday = goldNow;
        if (p.acct) { p.q.tomato = Math.max(0, p.q.tomato - n); p.q.texp = Math.max(0, p.q.texp - back); p.q.tgold -= lost; p.q.flagged++; }
        p.lockedUntil = t + RULES.lockMinutes * 60000; p.flagged++;
        commit();
        return { exp: 0, locked: true, flagged: true, reason: why, revoked: n + 1, achievement: false };
      }
      const exp = Math.min(RULES.tomatoPerThrow, RULES.tomatoPerDay - p.tomatoExpToday);
      p.tomatoExpToday += exp; p.exp += exp; p.life.tomatoes++; p.tomatoToday++;
      const goldNow = Math.min(RULES.tomatoGoldPerDay, Math.floor(p.tomatoToday / RULES.tomatoPerGold)), gold = goldNow - p.tomatoGoldToday;
      p.gold += gold; p.life.goldTotal += gold; p.tomatoGoldToday = goldNow;
      recent.push({ t, exp }); if (recent.length > 10) recent.shift();
      if (p.acct) { p.q.tomato++; p.q.tomatoT = t; p.q.texp += exp; p.q.tgold += gold; }
      const achievement = exp > 0 && p.tomatoExpToday >= RULES.tomatoPerDay && p.achievedDay !== p.day;
      if (achievement) p.achievedDay = p.day;
      const unlocked = checkAch();
      commit();
      return { exp, gold, locked: false, flagged: false, achievement, unlocked };
    },

    /** Spend gold (the tournament hall's shop). Returns false if there isn't enough. */
    spend(n) {
      roll(); n = Math.floor(n);
      if (!(n > 0) || n > p.gold) return false;
      p.gold -= n; if (p.acct) p.q.spend += n;
      commit(); return true;
    },
    /** Boss rewards from the tournament hall, limited per day. Returns { gold, exp } actually granted (plus any new achievements). */
    grantTycoon({ gold = 0, exp = 0 }) {
      roll();
      const g = Math.max(0, Math.min(Math.floor(gold), RULES.tycoonGoldPerDay - p.tycoonGoldToday)), e = Math.max(0, Math.min(Math.floor(exp), RULES.tycoonExpPerDay - p.tycoonExpToday));
      p.gold += g; p.life.goldTotal += g; p.exp += e; p.tycoonGoldToday += g; p.tycoonExpToday += e;
      if (p.acct) { p.q.tg += g; p.q.te += e; }
      const unlocked = checkAch(); commit();
      return { gold: g, exp: e, unlocked };
    },
    tycoonLeft() { roll(); return { gold: Math.max(0, RULES.tycoonGoldPerDay - p.tycoonGoldToday), exp: Math.max(0, RULES.tycoonExpPerDay - p.tycoonExpToday) }; },

    // ---- online account: events wait in a queue and are sent in batches; the server's answer is the truth
    get account() { return p.acct; },
    hasQueue() { return p.q.lines.length > 0 || p.q.tomato > 0 || p.q.flagged > 0 || p.q.spend > 0 || p.q.tg > 0 || p.q.te > 0; },
    queuedTomatoes() { return p.q.tomato; },
    takeQueue() { return { lines: p.q.lines.slice(), tomato: { n: p.q.tomato, t: p.q.tomatoT }, flagged: p.q.flagged, texp: p.q.texp, tgold: p.q.tgold, spend: p.q.spend, tg: p.q.tg, te: p.q.te }; },
    ackQueue(taken) {
      p.q.lines.splice(0, taken.lines.length);
      p.q.tomato = Math.max(0, p.q.tomato - taken.tomato.n); p.q.texp = Math.max(0, p.q.texp - taken.texp); p.q.tgold -= taken.tgold; p.q.flagged = Math.max(0, p.q.flagged - taken.flagged);
      p.q.spend = Math.max(0, p.q.spend - taken.spend); p.q.tg = Math.max(0, p.q.tg - taken.tg); p.q.te = Math.max(0, p.q.te - taken.te);
      p.syncedAt = now(); commit();
    },
    /** Replace the local totals with the server's, then add whatever happened since that batch was taken. */
    applyServer(sv, localDay) {
      const life = { ...sv.life }, today = { ...(sv.todayLines || {}) };
      let exp = sv.exp, gold = sv.gold || 0, tomatoExpToday = sv.tomatoExpToday, tomatoToday = sv.tomatoToday || 0;
      const run = { cur: sv.run ? sv.run.cur : 0, best: sv.run ? sv.run.best : 0 };
      life.perfectPuzzles = life.perfectPuzzles || 0; life.goldTotal = life.goldTotal || 0;
      for (const e of p.q.lines) {
        exp += e.exp; gold += e.gold || 0; life.goldTotal += e.gold || 0; today[e.key] = (today[e.key] || 0) + 1;
        if (e.puzzle) life.puzzles++; else life.lines++;
        if (e.perfect) { life.perfect++; life.perfectMoves += e.moves; if (e.puzzle) life.perfectPuzzles++; run.cur++; if (run.cur > run.best) run.best = run.cur; } else run.cur = 0;
      }
      exp += p.q.texp + p.q.te; gold += p.q.tgold + p.q.tg - p.q.spend; life.goldTotal += p.q.tgold + p.q.tg; tomatoExpToday += p.q.texp; tomatoToday += p.q.tomato; life.tomatoes += p.q.tomato;
      p.exp = exp; p.gold = Math.max(0, gold); p.life = life; p.run = run; p.nick = sv.nick; p.flagged = sv.flagged; p.streak = sv.streak || { n: 0, today: false };
      p.login = sv.login ? { cur: sv.login.cur, best: sv.login.best } : p.login;
      for (const [id, t] of Object.entries(sv.ach || {})) if (!p.ach[id] || t < p.ach[id]) p.ach[id] = t;       // unlocks are never lost: keep the earliest date
      p.day = localDay; p.todayLines = today; p.tomatoExpToday = Math.min(RULES.tomatoPerDay, tomatoExpToday);
      p.tycoonExpToday = Math.min(RULES.tycoonExpPerDay, ((sv.tycoonToday && sv.tycoonToday.exp) || 0) + p.q.te); p.tycoonGoldToday = Math.min(RULES.tycoonGoldPerDay, ((sv.tycoonToday && sv.tycoonToday.gold) || 0) + p.q.tg);
      p.tomatoToday = tomatoToday; p.tomatoGoldToday = Math.min(RULES.tomatoGoldPerDay, Math.floor(tomatoToday / RULES.tomatoPerGold));
      const unlocked = checkAch();
      commit();
      return unlocked;
    },
    setAccount(code, sv, localDay, perLine) {
      p = { ...blank(), acct: { code }, perLine: perLine || p.perLine, ach: { ...p.ach } };       // anything already unlocked on this device stays unlocked
      this.applyServer(sv, localDay); p.syncedAt = now(); commit();
    },
    /** Log out: this device goes back to a blank anonymous profile. */
    signOut() { p = blank(); roll(); commit(); },
    importPayload() { return { exp: p.exp, gold: p.gold, life: { ...p.life, perfectPuzzles: Math.min(p.life.perfectPuzzles, p.life.perfect) }, perLine: Object.fromEntries(Object.entries(p.perLine).slice(0, 100)) }; },

    /** Lines you miss most, worst first (needs at least 2 attempts). */
    weakest(limit = 5) {
      return Object.entries(p.perLine).filter(([, L]) => L.att >= 2)
        .map(([key, L]) => ({ key, ...L, rate: L.perfect / L.att }))
        .sort((a, b) => a.rate - b.rate || b.att - a.att).slice(0, limit);
    },
    /** Achievements with their progress: [{ ...definition, value, tiers: [{ n, id, at }] }] */
    achievements() { return ACHIEVEMENTS.map((c) => ({ ...c, value: c.stat(p), tiersInfo: c.tiers.map((n) => ({ n, id: achId(c.id, n), at: p.ach[achId(c.id, n)] || 0 })) })); },
    avgPerfectLength() { return p.life.perfect ? p.life.perfectMoves / p.life.perfect : 0; },
  };
}

// Training EXP, daily caps, lifetime stats and auto-clicker detection. Pure logic: main.js supplies storage and the clock.

export const RULES = {
  perMove: 1,                    // EXP for each of your own moves in a completed line
  perfect: 5,                    // extra for a perfect line (no wrong attempts, no hints)
  longBonus: [10, 15, 20, 25],   // a perfect line with at least this many of your moves earns +5 more for each milestone reached
  longBonusExp: 5,
  linesPerDay: 5,                // only this many completions per day earn EXP
  tomatoPerThrow: 1,
  tomatoPerDay: 100,             // tomato EXP cap per day
  lockMinutes: 30,               // how long the button stays inactive after auto-clicking is detected
};

/** EXP for finishing a line: { base, perfect, long, total }. */
export function lineExp(moves, perfect) {
  const base = Math.max(0, moves) * RULES.perMove;
  if (!perfect) return { base, perfect: 0, long: 0, total: base };
  const long = RULES.longBonus.filter((m) => moves >= m).length * RULES.longBonusExp;
  return { base, perfect: RULES.perfect, long, total: base + RULES.perfect + long };
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
  v: 1, nick: "", acct: null, syncedAt: 0, q: { lines: [], tomato: 0, tomatoT: 0, texp: 0, flagged: 0 }, exp: 0, day: "", linesToday: 0, tomatoExpToday: 0, achievedDay: "", lockedUntil: 0, flagged: 0,
  life: { lines: 0, puzzles: 0, perfect: 0, perfectMoves: 0, tomatoes: 0 },
  perLine: {},                                                                   // "collection:line" -> { name, att, perfect, wrong, last }
});

/** storage: { load(): object|null, save(obj) }  today(): "YYYY-MM-DD"  now(): ms */
export function createProgress({ load, save, today, now = Date.now }) {
  let p = blank();
  try { const s = load(); if (s && s.v === 1) p = { ...blank(), ...s, life: { ...blank().life, ...s.life }, perLine: s.perLine || {}, q: { ...blank().q, ...s.q, lines: (s.q && s.q.lines) || [] } }; } catch { /* start fresh */ }
  const roll = () => { const d = today(); if (p.day !== d) { p.day = d; p.linesToday = 0; p.tomatoExpToday = 0; } };
  const commit = () => { try { save(p); } catch { /* ignore */ } };
  roll();
  const recent = [];                                                             // last throws: { t, exp }

  return {
    get state() { roll(); return p; },
    linesLeft() { roll(); return Math.max(0, RULES.linesPerDay - p.linesToday); },
    tomatoLeft() { roll(); return Math.max(0, RULES.tomatoPerDay - p.tomatoExpToday); },
    lockedFor() { return Math.max(0, p.lockedUntil - now()); },
    lock(minutes = RULES.lockMinutes) { p.lockedUntil = now() + minutes * 60000; p.flagged++; commit(); },
    setNick(n) { p.nick = String(n || "").trim().slice(0, 20); commit(); },

    /** A line or puzzle was completed. info: { key, name, moves, perfect, puzzle } */
    recordLine({ key, name, moves, perfect, puzzle, wrong = 0 }) {
      roll();
      const e = lineExp(moves, perfect);
      const earns = p.linesToday < RULES.linesPerDay;
      if (earns) { p.linesToday++; p.exp += e.total; }
      if (puzzle) p.life.puzzles++; else p.life.lines++;
      if (perfect) { p.life.perfect++; p.life.perfectMoves += moves; }
      const L = p.perLine[key] || (p.perLine[key] = { name, att: 0, perfect: 0, wrong: 0, last: "" });
      L.name = name; L.att++; if (perfect) L.perfect++; L.wrong += wrong; L.last = p.day;
      if (p.acct) p.q.lines.push({ t: now(), key, name, moves, perfect: !!perfect, puzzle: !!puzzle, wrong, exp: earns ? e.total : 0, earned: earns });
      commit();
      return { ...e, earned: earns ? e.total : 0, capped: !earns, linesLeft: RULES.linesPerDay - p.linesToday };
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
        if (p.acct) { p.q.tomato = Math.max(0, p.q.tomato - n); p.q.texp = Math.max(0, p.q.texp - back); p.q.flagged++; }
        p.lockedUntil = t + RULES.lockMinutes * 60000; p.flagged++;
        commit();
        return { exp: 0, locked: true, flagged: true, reason: why, revoked: n + 1, achievement: false };
      }
      const exp = Math.min(RULES.tomatoPerThrow, RULES.tomatoPerDay - p.tomatoExpToday);
      p.tomatoExpToday += exp; p.exp += exp; p.life.tomatoes++;
      recent.push({ t, exp }); if (recent.length > 10) recent.shift();
      if (p.acct) { p.q.tomato++; p.q.tomatoT = t; p.q.texp += exp; }
      const achievement = exp > 0 && p.tomatoExpToday >= RULES.tomatoPerDay && p.achievedDay !== p.day;
      if (achievement) p.achievedDay = p.day;
      commit();
      return { exp, locked: false, flagged: false, achievement };
    },

    // ---- online account: events wait in a queue and are sent in batches; the server's answer is the truth
    get account() { return p.acct; },
    hasQueue() { return p.q.lines.length > 0 || p.q.tomato > 0 || p.q.flagged > 0; },
    queuedTomatoes() { return p.q.tomato; },
    takeQueue() { return { lines: p.q.lines.slice(), tomato: { n: p.q.tomato, t: p.q.tomatoT }, flagged: p.q.flagged, texp: p.q.texp }; },
    ackQueue(taken) {
      p.q.lines.splice(0, taken.lines.length);
      p.q.tomato = Math.max(0, p.q.tomato - taken.tomato.n); p.q.texp = Math.max(0, p.q.texp - taken.texp); p.q.flagged = Math.max(0, p.q.flagged - taken.flagged);
      p.syncedAt = now(); commit();
    },
    /** Replace the local totals with the server's, then add whatever happened since that batch was taken. */
    applyServer(sv, localDay) {
      const life = { ...sv.life };
      let exp = sv.exp, linesToday = sv.linesToday, tomatoExpToday = sv.tomatoExpToday;
      for (const e of p.q.lines) {
        exp += e.exp; if (e.earned) linesToday++;
        if (e.puzzle) life.puzzles++; else life.lines++;
        if (e.perfect) { life.perfect++; life.perfectMoves += e.moves; }
      }
      exp += p.q.texp; tomatoExpToday += p.q.texp; life.tomatoes += p.q.tomato;
      p.exp = exp; p.life = life; p.nick = sv.nick; p.flagged = sv.flagged;
      p.day = localDay; p.linesToday = Math.min(RULES.linesPerDay, linesToday); p.tomatoExpToday = Math.min(RULES.tomatoPerDay, tomatoExpToday);
      commit();
    },
    setAccount(code, sv, localDay, perLine) {
      p = { ...blank(), acct: { code }, perLine: perLine || p.perLine };
      this.applyServer(sv, localDay); p.syncedAt = now(); commit();
    },
    /** Log out: this device goes back to a blank anonymous profile. */
    signOut() { p = blank(); roll(); commit(); },
    importPayload() { return { exp: p.exp, life: p.life, perLine: Object.fromEntries(Object.entries(p.perLine).slice(0, 100)) }; },

    /** Lines you miss most, worst first (needs at least 2 attempts). */
    weakest(limit = 5) {
      return Object.entries(p.perLine).filter(([, L]) => L.att >= 2)
        .map(([key, L]) => ({ key, ...L, rate: L.perfect / L.att }))
        .sort((a, b) => a.rate - b.rate || b.att - a.att).slice(0, limit);
    },
    avgPerfectLength() { return p.life.perfect ? p.life.perfectMoves / p.life.perfect : 0; },
  };
}

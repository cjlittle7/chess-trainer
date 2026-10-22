// My Chess Trainer online service: the worldwide tomato counter, player accounts and the leaderboard.
// Written for Cloudflare Workers (free plan) with a D1 database. See the README for the click-by-click setup.
//
// Bindings this worker needs:
//   DB       (required)  a D1 database. The tables are created automatically on the first request.
//   COUNTER  (optional)  the old KV namespace. If it is still attached, its tomato total is copied into the new counter once.
// Optional variable: ALLOWED_ORIGINS = comma separated list of sites allowed to call this worker.
//
// Everything is sent as POST with a text/plain body (no CORS preflight, and it works with navigator.sendBeacon):
//   GET  /count                      -> { count }                       worldwide tomato total
//   POST /hit        {n}             -> { count }                       anonymous tomato throws
//   POST /register   {nick, tz, import?}  -> { code, ...profile }      create an account; the code is shown once
//   POST /login      {code, tz}      -> { ...profile, perLine }         restore an account on another device
//   POST /sync       {code, events, ranks?} -> { ...profile, ranks? }   send new activity, get the authoritative totals
//   GET  /leaderboard                -> { exp, lines, puzzles, tomatoes, avglen }   cached for 5 minutes
//
// The server owns the rules (EXP, daily caps, rate limits). Keep RULES and lineExp in step with src/progress.js.

const DEFAULT_ORIGINS = ["https://mychesstrainer.net", "https://www.mychesstrainer.net", "https://cjlittle7.github.io"];

const RULES = {
  perMove: 1, perfect: 5, longBonus: [10, 15, 20, 25], longBonusExp: 5,
  linesPerDay: 5,          // completions per day that earn EXP
  tomatoPerDay: 100,       // tomato EXP per day
  solvedPerDay: 150,       // completions per day that count towards lifetime totals and the leaderboard
  maxMoves: 100,           // moves per line the server will believe
  tomatoPerSecond: 5,      // fastest believable pressing, averaged over the time since the last sync
  minSyncGapMs: 15000,     // at most one batch of events per account every 15 seconds
  maxEventAgeMs: 2 * 86400000,
  accountsPerIpPerDay: 5,
  perLineRows: 500,
};

function lineExp(moves, perfect) {
  const base = Math.max(0, moves) * RULES.perMove;
  if (!perfect) return { base, perfect: 0, long: 0, total: base };
  const long = RULES.longBonus.filter((m) => moves >= m).length * RULES.longBonusExp;
  return { base, perfect: RULES.perfect, long, total: base + RULES.perfect + long };
}

// ---------------------------------------------------------------- helpers
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const newCode = () => { const b = crypto.getRandomValues(new Uint8Array(20)); let s = ""; for (const x of b) s += B32[x & 31]; return s.match(/.{5}/g).join("-"); };
const normCode = (c) => String(c || "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
const dayOf = (t, tz) => new Date(t + tz * 60000).toISOString().slice(0, 10);
const int = (v, lo, hi, d = 0) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const NICK = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,18}[A-Za-z0-9]$/;
const BLOCKED = /(admin|moderator|official|mychesstrainer|fuck|shit|cunt|nigg|fag|rape|nazi|hitler)/i;   // extend as needed; you can also delete any row from the D1 console

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, nick TEXT NOT NULL, nick_lc TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL UNIQUE,
    tz INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_sync INTEGER NOT NULL DEFAULT 0,
    exp INTEGER NOT NULL DEFAULT 0, lines INTEGER NOT NULL DEFAULT 0, puzzles INTEGER NOT NULL DEFAULT 0,
    perfect INTEGER NOT NULL DEFAULT 0, perfect_moves INTEGER NOT NULL DEFAULT 0, tomatoes INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL DEFAULT '', lines_today INTEGER NOT NULL DEFAULT 0, solved_today INTEGER NOT NULL DEFAULT 0,
    tomato_exp_today INTEGER NOT NULL DEFAULT 0, achieved_day TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS perline (account TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, att INTEGER NOT NULL DEFAULT 0,
    perfect INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0, last TEXT NOT NULL DEFAULT '', PRIMARY KEY (account, key))`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ipreg (ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, day))`,
  `CREATE INDEX IF NOT EXISTS i_exp ON accounts(exp)`, `CREATE INDEX IF NOT EXISTS i_lines ON accounts(lines)`,
  `CREATE INDEX IF NOT EXISTS i_puzzles ON accounts(puzzles)`, `CREATE INDEX IF NOT EXISTS i_tomatoes ON accounts(tomatoes)`,
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  const have = await env.DB.prepare("SELECT v FROM meta WHERE k='tomatoes'").first();
  if (!have) {                                                    // first run: carry over the old KV total, if the old binding is still there
    let old = 0;
    try { if (env.COUNTER) old = parseInt(await env.COUNTER.get("tomatoes"), 10) || 0; } catch { /* ignore */ }
    await env.DB.prepare("INSERT OR IGNORE INTO meta(k, v) VALUES('tomatoes', ?)").bind(Math.max(0, old)).run();
  }
  schemaReady = true;
}

class HttpError extends Error { constructor(status, msg, extra = {}) { super(msg); this.status = status; this.extra = extra; } }

// ---------------------------------------------------------------- profile
const accountByCode = async (env, code) => {
  const norm = normCode(code);
  if (norm.length !== 20) throw new HttpError(401, "That recovery code isn't recognised.");
  const a = await env.DB.prepare("SELECT * FROM accounts WHERE code_hash = ?").bind(await sha256(norm)).first();
  if (!a) throw new HttpError(401, "That recovery code isn't recognised.");
  return a;
};
const globalTomatoes = async (env) => (await env.DB.prepare("SELECT v FROM meta WHERE k='tomatoes'").first())?.v || 0;

function profileOf(a, global, now) {
  const fresh = a.day === dayOf(now, a.tz);                          // yesterday's counters are not today's
  return {
    nick: a.nick, exp: a.exp, flagged: a.flagged, global,
    life: { lines: a.lines, puzzles: a.puzzles, perfect: a.perfect, perfectMoves: a.perfect_moves, tomatoes: a.tomatoes },
    linesToday: fresh ? a.lines_today : 0, tomatoExpToday: fresh ? a.tomato_exp_today : 0,
  };
}

async function ranksOf(env, a) {
  const q = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).first()).c;
  const ratio = a.perfect >= 10 ? a.perfect_moves / a.perfect : null;
  return {
    players: await q("SELECT COUNT(*) c FROM accounts"),
    exp: 1 + await q("SELECT COUNT(*) c FROM accounts WHERE exp > ?", a.exp),
    lines: 1 + await q("SELECT COUNT(*) c FROM accounts WHERE lines > ?", a.lines),
    puzzles: 1 + await q("SELECT COUNT(*) c FROM accounts WHERE puzzles > ?", a.puzzles),
    tomatoes: 1 + await q("SELECT COUNT(*) c FROM accounts WHERE tomatoes > ?", a.tomatoes),
    avglen: ratio == null ? null : 1 + await q("SELECT COUNT(*) c FROM accounts WHERE perfect >= 10 AND perfect_moves * 1.0 / perfect > ?", ratio),
  };
}

const PERLINE_UPSERT = `INSERT INTO perline(account, key, name, att, perfect, wrong, last) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(account, key) DO UPDATE SET name = excluded.name, att = att + excluded.att, perfect = perfect + excluded.perfect, wrong = wrong + excluded.wrong, last = excluded.last`;

// ---------------------------------------------------------------- handlers
async function register(env, body, request, now) {
  const nick = String(body.nick || "").trim().replace(/\s+/g, " ");
  if (!NICK.test(nick)) throw new HttpError(400, "Nicknames are 3–20 characters: letters, numbers, spaces and _ . -");
  if (BLOCKED.test(nick)) throw new HttpError(400, "Please pick a different nickname.");
  const tz = int(body.tz, -840, 840);
  const ip = await sha256("ip:" + (request.headers.get("CF-Connecting-IP") || "?"));
  const day = dayOf(now, 0);
  const seen = await env.DB.prepare("SELECT n FROM ipreg WHERE ip = ? AND day = ?").bind(ip, day).first();
  if ((seen?.n || 0) >= RULES.accountsPerIpPerDay) throw new HttpError(429, "Too many accounts created from this network today. Try again tomorrow.");
  if (await env.DB.prepare("SELECT 1 x FROM accounts WHERE nick_lc = ?").bind(nick.toLowerCase()).first()) throw new HttpError(409, "That nickname is taken.");

  // Progress made before the account existed is carried over, within sensible limits.
  const imp = body.import && typeof body.import === "object" ? body.import : {};
  const L = imp.life || {};
  const lines = int(L.lines, 0, 100), puzzles = int(L.puzzles, 0, 50), perfect = int(L.perfect, 0, Math.min(50, lines + puzzles));
  const a = {
    id: hex(crypto.getRandomValues(new Uint8Array(8))), nick, nick_lc: nick.toLowerCase(), tz, created: now, last_sync: 0,
    exp: int(imp.exp, 0, 500), lines, puzzles, perfect, perfect_moves: int(L.perfectMoves, 0, perfect * 25), tomatoes: int(L.tomatoes, 0, 100), flagged: 0,
    day: "", lines_today: 0, solved_today: 0, tomato_exp_today: 0, achieved_day: "",
  };
  const code = newCode();
  const stmts = [env.DB.prepare(`INSERT INTO accounts(id,nick,nick_lc,code_hash,tz,created,last_sync,exp,lines,puzzles,perfect,perfect_moves,tomatoes,flagged,day,lines_today,solved_today,tomato_exp_today,achieved_day)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(a.id, a.nick, a.nick_lc, await sha256(normCode(code)), tz, now, 0, a.exp, a.lines, a.puzzles, a.perfect, a.perfect_moves, a.tomatoes, 0, "", 0, 0, 0, ""),
    env.DB.prepare("INSERT INTO ipreg(ip, day, n) VALUES(?,?,1) ON CONFLICT(ip, day) DO UPDATE SET n = n + 1").bind(ip, day)];
  const per = imp.perLine && typeof imp.perLine === "object" ? Object.entries(imp.perLine).slice(0, 100) : [];
  for (const [key, v] of per) {
    if (!v || typeof v !== "object") continue;
    const att = int(v.att, 0, 1000);
    stmts.push(env.DB.prepare(PERLINE_UPSERT).bind(a.id, String(key).slice(0, 60), String(v.name || "").slice(0, 80), att, int(v.perfect, 0, att), int(v.wrong, 0, 5000), String(v.last || "").slice(0, 10)));
  }
  try { await env.DB.batch(stmts); } catch { throw new HttpError(409, "That nickname is taken."); }
  return { code, ...profileOf(a, await globalTomatoes(env), now) };
}

async function login(env, body, now) {
  const a = await accountByCode(env, body.code);
  const per = (await env.DB.prepare("SELECT key, name, att, perfect, wrong, last FROM perline WHERE account = ? ORDER BY att DESC LIMIT ?").bind(a.id, RULES.perLineRows).all()).results || [];
  const perLine = {};
  for (const r of per) perLine[r.key] = { name: r.name, att: r.att, perfect: r.perfect, wrong: r.wrong, last: r.last };
  return { ...profileOf(a, await globalTomatoes(env), now), perLine };
}

async function sync(env, body, now) {
  const a = await accountByCode(env, body.code);
  const ev = body.events && typeof body.events === "object" ? body.events : {};
  const lines = Array.isArray(ev.lines) ? ev.lines.slice(0, 300) : [];
  const tom = ev.tomato && typeof ev.tomato === "object" ? ev.tomato : null;
  const has = lines.length || (tom && tom.n > 0) || ev.flagged > 0;
  let warn = false, delta = 0;

  if (has) {
    if (now - a.last_sync < RULES.minSyncGapMs) throw new HttpError(429, "Syncing too often.", { retryMs: RULES.minSyncGapMs - (now - a.last_sync) });
    const tz = a.tz;
    const clampT = (t) => { t = Number(t); if (!Number.isFinite(t)) t = now; return Math.min(now, Math.max(now - RULES.maxEventAgeMs, t)); };
    const roll = (t) => {
      const d = dayOf(t, tz);
      if (d > a.day) { a.day = d; a.lines_today = 0; a.solved_today = 0; a.tomato_exp_today = 0; }   // never go back to an earlier day
    };
    const valid = [];
    for (const e of lines) {
      if (!e || typeof e !== "object" || typeof e.key !== "string" || !e.key || e.key.length > 60) continue;
      const moves = int(e.moves, 0, 1e9);
      if (moves < 1 || moves > RULES.maxMoves) continue;
      valid.push({ key: e.key, name: String(e.name || "").slice(0, 80), moves, perfect: e.perfect === true, puzzle: e.puzzle === true, wrong: int(e.wrong, 0, 200), t: clampT(e.t) });
    }
    valid.sort((x, y) => x.t - y.t);
    const per = new Map();
    for (const e of valid) {
      roll(e.t);
      if (a.solved_today >= RULES.solvedPerDay) continue;               // beyond this the completion isn't counted at all
      a.solved_today++;
      if (e.puzzle) a.puzzles++; else a.lines++;
      if (e.perfect) { a.perfect++; a.perfect_moves += e.moves; }
      if (a.lines_today < RULES.linesPerDay) { a.lines_today++; const g = lineExp(e.moves, e.perfect).total; a.exp += g; delta += g; }
      const p = per.get(e.key) || { name: e.name, att: 0, perfect: 0, wrong: 0, last: "" };
      p.name = e.name; p.att++; if (e.perfect) p.perfect++; p.wrong += e.wrong; p.last = dayOf(e.t, tz);
      per.set(e.key, p);
    }
    let added = 0;
    if (tom && int(tom.n, 0, 1e9) > 0) {
      const n = int(tom.n, 0, 5000);
      roll(clampT(tom.t));
      const elapsed = Math.min((now - (a.last_sync || now - 600000)) / 1000, 6 * 3600);
      const allowed = Math.min(3000, Math.floor(elapsed * RULES.tomatoPerSecond) + 20);
      const ok = Math.min(n, allowed);
      if (n > allowed) { a.flagged++; warn = true; }                   // more throws than a person can press in that time
      const g = Math.max(0, Math.min(ok, RULES.tomatoPerDay - a.tomato_exp_today));
      a.tomato_exp_today += g; a.exp += g; delta += g; a.tomatoes += ok; added = ok;
    }
    a.flagged += int(ev.flagged, 0, 5);
    a.last_sync = now;

    const stmts = [env.DB.prepare(`UPDATE accounts SET exp=?, lines=?, puzzles=?, perfect=?, perfect_moves=?, tomatoes=?, flagged=?, day=?, lines_today=?, solved_today=?, tomato_exp_today=?, last_sync=? WHERE id=?`)
      .bind(a.exp, a.lines, a.puzzles, a.perfect, a.perfect_moves, a.tomatoes, a.flagged, a.day, a.lines_today, a.solved_today, a.tomato_exp_today, a.last_sync, a.id)];
    if (added) stmts.push(env.DB.prepare("UPDATE meta SET v = v + ? WHERE k = 'tomatoes'").bind(added));
    if (per.size) {
      let allowNew = true, have = null;
      if ((await env.DB.prepare("SELECT COUNT(*) c FROM perline WHERE account = ?").bind(a.id).first()).c >= RULES.perLineRows - 50) {
        have = new Set(((await env.DB.prepare("SELECT key FROM perline WHERE account = ?").bind(a.id).all()).results || []).map((r) => r.key)); allowNew = false;
      }
      for (const [key, p] of per) if (allowNew || have.has(key)) stmts.push(env.DB.prepare(PERLINE_UPSERT).bind(a.id, key, p.name, p.att, p.perfect, p.wrong, p.last));
    }
    await env.DB.batch(stmts);
  }
  const out = { ...profileOf(a, await globalTomatoes(env), now), warn, gained: delta };
  if (body.ranks) out.ranks = await ranksOf(env, a);
  return out;
}

const BOARDS = {
  exp: "SELECT nick, exp AS v FROM accounts WHERE exp > 0 ORDER BY exp DESC, created ASC LIMIT 25",
  lines: "SELECT nick, lines AS v FROM accounts WHERE lines > 0 ORDER BY lines DESC, created ASC LIMIT 25",
  puzzles: "SELECT nick, puzzles AS v FROM accounts WHERE puzzles > 0 ORDER BY puzzles DESC, created ASC LIMIT 25",
  tomatoes: "SELECT nick, tomatoes AS v FROM accounts WHERE tomatoes > 0 ORDER BY tomatoes DESC, created ASC LIMIT 25",
  avglen: "SELECT nick, ROUND(perfect_moves * 1.0 / perfect, 1) AS v FROM accounts WHERE perfect >= 10 ORDER BY perfect_moves * 1.0 / perfect DESC, created ASC LIMIT 25",
};
async function leaderboard(env, request) {
  const key = new Request(new URL("/leaderboard", request.url).toString());
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(key); if (hit) return await hit.text(); }
  const out = { updated: Date.now() };
  for (const [name, sql] of Object.entries(BOARDS)) out[name] = ((await env.DB.prepare(sql).all()).results || []).map((r, i) => ({ rank: i + 1, nick: r.nick, value: r.v }));
  const text = JSON.stringify(out);
  if (cache) await cache.put(key, new Response(text, { headers: { "Cache-Control": "public, max-age=300", "Content-Type": "application/json" } }));
  return text;
}

// ---------------------------------------------------------------- entry
export default {
  lineExp,                                   // exposed only so the tests can check it matches src/progress.js
  async fetch(request, env) {
    const origins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : DEFAULT_ORIGINS;
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin",
    };
    const reply = (obj, status = 200) => new Response(typeof obj === "string" ? obj : JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!env.DB) return reply({ error: "The DB binding is missing. See the README (step: add the D1 database)." }, 500);
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const now = Date.now();
    try {
      if (request.method === "POST" && origin && !origins.includes(origin)) throw new HttpError(403, "origin not allowed");
      await ensureSchema(env);
      if (request.method === "GET") {
        if (path === "/count" || path === "") return reply({ count: await globalTomatoes(env) });
        if (path === "/leaderboard") return reply(await leaderboard(env, request));
        throw new HttpError(404, "not found");
      }
      if (request.method !== "POST") throw new HttpError(405, "method not allowed");
      let body = {};
      try { const t = await request.text(); body = t ? JSON.parse(t) : {}; } catch { throw new HttpError(400, "bad request"); }
      if (!body || typeof body !== "object") body = {};
      if (path === "/hit") {
        const n = int(body.n, 1, 200, 1);
        const r = await env.DB.prepare("UPDATE meta SET v = v + ? WHERE k = 'tomatoes' RETURNING v").bind(n).first();
        return reply({ count: r.v });
      }
      if (path === "/register") return reply(await register(env, body, request, now));
      if (path === "/login") return reply(await login(env, body, now));
      if (path === "/sync") return reply(await sync(env, body, now));
      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message, ...e.extra }, e.status);
      return reply({ error: "server error" }, 500);
    }
  },
};

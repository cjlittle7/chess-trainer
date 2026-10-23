// My Chess Trainer online service: the worldwide tomato counter, player accounts, rewards and the leaderboard.
// Written for Cloudflare Workers (free plan) with a D1 database. See the README for the click-by-click setup.
//
// Bindings and settings this worker uses:
//   DB          (required)  a D1 database. Tables are created, and older ones upgraded, automatically on the first request.
//   COUNTER     (optional)  the old KV namespace. If it is still attached, its tomato total is copied into the new counter once.
//   CODE_KEY    (optional)  a secret (any long random text). With it, each account's recovery code is also stored ENCRYPTED so you can help
//                           someone who lost theirs. Without it, nothing but a one-way hash of each code is kept.
//   ADMIN_TOKEN (optional)  a secret (at least 16 characters) that unlocks /admin for tools/admin.html. Without it /admin is switched off.
//   ALLOWED_ORIGINS (optional) comma separated list of sites allowed to call this worker.
//
// Everything is sent as POST with a text/plain body (no CORS preflight, and it works with navigator.sendBeacon):
//   GET  /count                      -> { count }                       worldwide tomato total
//   POST /hit        {n}             -> { count }                       anonymous tomato throws
//   POST /register   {nick, tz, import?}  -> { code, ...profile }      create an account; the code is shown once
//   POST /login      {code, tz}      -> { ...profile, perLine }         restore an account on another device
//   POST /sync       {code, events, ranks?} -> { ...profile, ranks? }   send new activity, get the authoritative totals
//   GET  /leaderboard                -> { exp, lines, puzzles, tomatoes, avglen }   cached for 5 minutes
//   POST /admin      {token, action, nick?} -> ...                      list / find / reset / delete (owner only)
//
// The server owns the rules (EXP, gold, daily limits, streaks, rate limits). Keep RULES, lineExp and streakReward in step with src/progress.js.

const DEFAULT_ORIGINS = ["https://mychesstrainer.net", "https://www.mychesstrainer.net", "https://cjlittle7.github.io"];

const RULES = {
  perMove: 1, perfect: 5, longBonus: [10, 15, 20, 25], longBonusExp: 5,
  perLinePerDay: 5,        // each line or puzzle earns EXP for its first 5 completions per day
  goldPerLine: 10,         // gold for the first completion of each line or puzzle per day
  tomatoPerGold: 5, tomatoGoldPerDay: 20,
  tomatoPerDay: 100,       // tomato EXP per day
  streakExp: { base: 50, step: 10, cap: 1000 }, streakGold: { base: 10, step: 5, cap: 500 },
  solvedPerDay: 150,       // completions per day that count towards lifetime totals and the leaderboard
  maxMoves: 100,           // moves per line the server will believe
  tomatoPerSecond: 5,      // fastest believable pressing, averaged over the time since the last sync
  minSyncGapMs: 15000,     // at most one batch of events per account every 15 seconds
  maxEventAgeMs: 2 * 86400000,
  accountsPerIpPerDay: 5,
  perLineRows: 500,
  tycoonExpPerDay: 2000,   // boss rewards from the tournament hall, per day (keep in step with src/progress.js)
  tycoonGoldPerDay: 15000,
  tycoonBlobMax: 24000,    // the tournament hall's saved game (engines, upgrades, packs) is stored as text up to this size
};

function lineExp(moves, perfect) {
  const base = Math.max(0, moves) * RULES.perMove;
  if (!perfect) return { base, perfect: 0, long: 0, total: base };
  const long = RULES.longBonus.filter((m) => moves >= m).length * RULES.longBonusExp;
  return { base, perfect: RULES.perfect, long, total: base + RULES.perfect + long };
}
// Collectable achievements (keep in step with ACHIEVEMENTS in src/progress.js). A tier unlocks when its stat reaches the threshold and then stays unlocked.
const BIG = [1, 10, 100, 1000, 10000, 100000];
const ACH = [
  { id: "perfectLines", tiers: BIG, stat: (a) => Math.max(0, a.perfect - a.perfect_puzzles) },
  { id: "perfectPuzzles", tiers: BIG, stat: (a) => a.perfect_puzzles },
  { id: "exp", tiers: BIG, stat: (a) => a.exp },
  { id: "gold", tiers: BIG, stat: (a) => a.gold_total },
  { id: "tomatoes", tiers: BIG, stat: (a) => a.tomatoes },
  { id: "run", tiers: [10, 50, 100, 1000, 10000], stat: (a) => a.run_best },
  { id: "login", tiers: [7, 30, 100, 365], stat: (a) => a.login_best },
];
function unlockAch(a, now) {
  let have = {}; try { have = JSON.parse(a.ach || "{}"); } catch { /* start again */ }
  const added = [];
  for (const c of ACH) { const v = c.stat(a); for (const t of c.tiers) { const id = c.id + ":" + t; if (v >= t && !have[id]) { have[id] = now; added.push(id); } } }
  if (added.length) a.ach = JSON.stringify(have);
  return added;
}
function streakReward(n) {
  const k = Math.max(1, Math.floor(n));
  return { exp: Math.min(RULES.streakExp.cap, RULES.streakExp.base + RULES.streakExp.step * k),
           gold: Math.min(RULES.streakGold.cap, RULES.streakGold.base + RULES.streakGold.step * k) };
}

// ---------------------------------------------------------------- helpers
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const newCode = () => { const b = crypto.getRandomValues(new Uint8Array(20)); let s = ""; for (const x of b) s += B32[x & 31]; return s.match(/.{5}/g).join("-"); };
const normCode = (c) => String(c || "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
const pretty = (norm) => norm.match(/.{5}/g).join("-");
const dayOf = (t, tz) => new Date(t + tz * 60000).toISOString().slice(0, 10);
const prevDay = (d) => new Date(Date.parse(d + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
const int = (v, lo, hi, d = 0) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const NICK = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,18}[A-Za-z0-9]$/;
const BLOCKED = /(admin|moderator|official|mychesstrainer|fuck|shit|cunt|nigg|fag|rape|nazi|hitler)/i;   // extend as needed; you can also delete any row with the admin tool

// Recovery codes kept for support are sealed with AES-GCM; the key comes from the CODE_KEY secret, so a copy of the database alone reveals nothing.
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function codeKey(env) { return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("code:" + env.CODE_KEY)), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(env, norm) {
  if (!env.CODE_KEY) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await codeKey(env), new TextEncoder().encode(norm)));
  return b64(new Uint8Array([...iv, ...ct]));
}
async function unseal(env, text) {
  if (!env.CODE_KEY || !text) return null;
  try { const raw = unb64(text); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await codeKey(env), raw.slice(12))); } catch { return null; }
}

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
  `CREATE TABLE IF NOT EXISTS linedaily (account TEXT NOT NULL, key TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (account, key, day))`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ipreg (ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, day))`,
  `CREATE INDEX IF NOT EXISTS i_exp ON accounts(exp)`, `CREATE INDEX IF NOT EXISTS i_lines ON accounts(lines)`,
  `CREATE INDEX IF NOT EXISTS i_puzzles ON accounts(puzzles)`, `CREATE INDEX IF NOT EXISTS i_tomatoes ON accounts(tomatoes)`,
];
const ADDED_COLUMNS = [                       // columns added after the first release: older databases are upgraded in place
  ["gold", "INTEGER NOT NULL DEFAULT 0"], ["streak", "INTEGER NOT NULL DEFAULT 0"], ["streak_day", "TEXT NOT NULL DEFAULT ''"],
  ["tomato_today", "INTEGER NOT NULL DEFAULT 0"], ["code_enc", "TEXT NOT NULL DEFAULT ''"],
  ["perfect_puzzles", "INTEGER NOT NULL DEFAULT 0"], ["gold_total", "INTEGER NOT NULL DEFAULT 0"], ["run", "INTEGER NOT NULL DEFAULT 0"], ["run_best", "INTEGER NOT NULL DEFAULT 0"],
  ["login_streak", "INTEGER NOT NULL DEFAULT 0"], ["login_best", "INTEGER NOT NULL DEFAULT 0"], ["login_day", "TEXT NOT NULL DEFAULT ''"], ["ach", "TEXT NOT NULL DEFAULT '{}'"],
  ["tycoon_exp_today", "INTEGER NOT NULL DEFAULT 0"], ["tycoon_gold_today", "INTEGER NOT NULL DEFAULT 0"], ["tycoon", "TEXT NOT NULL DEFAULT ''"], ["tycoon_ts", "INTEGER NOT NULL DEFAULT 0"],
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  const have = new Set(((await env.DB.prepare("PRAGMA table_info(accounts)").all()).results || []).map((r) => r.name));
  for (const [name, def] of ADDED_COLUMNS) if (!have.has(name)) await env.DB.prepare(`ALTER TABLE accounts ADD COLUMN ${name} ${def}`).run();
  if (!have.has("gold_total")) await env.DB.prepare("UPDATE accounts SET gold_total = gold").run();      // lifetime gold starts from what players already hold
  const meta = await env.DB.prepare("SELECT v FROM meta WHERE k='tomatoes'").first();
  if (!meta) {                                                    // first run: carry over the old KV total, if the old binding is still there
    let old = 0;
    try { if (env.COUNTER) old = parseInt(await env.COUNTER.get("tomatoes"), 10) || 0; } catch { /* ignore */ }
    await env.DB.prepare("INSERT OR IGNORE INTO meta(k, v) VALUES('tomatoes', ?)").bind(Math.max(0, old)).run();
  }
  schemaReady = true;
}

class HttpError extends Error { constructor(status, msg, extra = {}) { super(msg); this.status = status; this.extra = extra; } }

// ---------------------------------------------------------------- profile
async function accountByCode(env, code) {
  const norm = normCode(code);
  if (norm.length !== 20) throw new HttpError(401, "That recovery code isn't recognised.");
  const a = await env.DB.prepare("SELECT * FROM accounts WHERE code_hash = ?").bind(await sha256(norm)).first();
  if (!a) throw new HttpError(401, "That recovery code isn't recognised.");
  if (!a.code_enc && env.CODE_KEY) {                              // accounts made before CODE_KEY existed get their code stored the next time they sign in
    a.code_enc = await seal(env, norm);
    await env.DB.prepare("UPDATE accounts SET code_enc = ? WHERE id = ?").bind(a.code_enc, a.id).run();
  }
  return a;
}
/** Counts today as a signed-in day. Returns true if anything changed. */
function touchLogin(a, now) {
  const day = dayOf(now, a.tz);
  if (a.login_day === day) return false;
  a.login_streak = a.login_day === prevDay(day) ? a.login_streak + 1 : 1;
  a.login_best = Math.max(a.login_best, a.login_streak); a.login_day = day;
  return true;
}
async function saveMeta(env, a, changed) {
  if (changed) await env.DB.prepare("UPDATE accounts SET login_streak=?, login_best=?, login_day=?, ach=? WHERE id=?").bind(a.login_streak, a.login_best, a.login_day, a.ach, a.id).run();
}
const globalTomatoes = async (env) => (await env.DB.prepare("SELECT v FROM meta WHERE k='tomatoes'").first())?.v || 0;
async function todayLines(env, a, now) {
  const rows = (await env.DB.prepare("SELECT key, n FROM linedaily WHERE account = ? AND day = ?").bind(a.id, dayOf(now, a.tz)).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

function profileOf(a, global, now, lines = {}) {
  const today = dayOf(now, a.tz), fresh = a.day === today;           // yesterday's counters are not today's
  const live = a.streak_day === today || a.streak_day === prevDay(today);
  const loginLive = a.login_day === today || a.login_day === prevDay(today);
  let ach = {}; try { ach = JSON.parse(a.ach || "{}"); } catch { /* none */ }
  return {
    nick: a.nick, exp: a.exp, gold: a.gold, flagged: a.flagged, global,
    life: { lines: a.lines, puzzles: a.puzzles, perfect: a.perfect, perfectPuzzles: a.perfect_puzzles, perfectMoves: a.perfect_moves, goldTotal: a.gold_total, tomatoes: a.tomatoes },
    tycoonToday: { exp: fresh ? a.tycoon_exp_today : 0, gold: fresh ? a.tycoon_gold_today : 0 },
    run: { cur: a.run, best: a.run_best }, login: { cur: loginLive ? a.login_streak : 0, best: a.login_best }, ach,
    tomatoExpToday: fresh ? a.tomato_exp_today : 0, tomatoToday: fresh ? a.tomato_today : 0,
    streak: { n: live ? a.streak : 0, today: a.streak_day === today },
    todayLines: lines,
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
  const code = newCode(), norm = normCode(code);
  const row = {
    id: hex(crypto.getRandomValues(new Uint8Array(8))), nick, nick_lc: nick.toLowerCase(), code_hash: await sha256(norm), code_enc: await seal(env, norm),
    tz, created: now, last_sync: 0, exp: int(imp.exp, 0, 500), gold: int(imp.gold, 0, 200), gold_total: int(imp.gold, 0, 200), lines, puzzles, perfect, perfect_puzzles: int(L.perfectPuzzles, 0, Math.min(perfect, puzzles)),
    login_streak: 1, login_best: 1, login_day: dayOf(now, tz),
    perfect_moves: int(L.perfectMoves, 0, perfect * 25), tomatoes: int(L.tomatoes, 0, 100), flagged: 0,
  };
  const cols = Object.keys(row);
  const stmts = [env.DB.prepare(`INSERT INTO accounts(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => row[c])),
    env.DB.prepare("INSERT INTO ipreg(ip, day, n) VALUES(?,?,1) ON CONFLICT(ip, day) DO UPDATE SET n = n + 1").bind(ip, day)];
  const per = imp.perLine && typeof imp.perLine === "object" ? Object.entries(imp.perLine).slice(0, 100) : [];
  for (const [key, v] of per) {
    if (!v || typeof v !== "object") continue;
    const att = int(v.att, 0, 1000);
    stmts.push(env.DB.prepare(PERLINE_UPSERT).bind(row.id, String(key).slice(0, 60), String(v.name || "").slice(0, 80), att, int(v.perfect, 0, att), int(v.wrong, 0, 5000), String(v.last || "").slice(0, 10)));
  }
  try { await env.DB.batch(stmts); } catch { throw new HttpError(409, "That nickname is taken."); }
  const a = { ...row, day: "", streak: 0, streak_day: "", tomato_today: 0, tomato_exp_today: 0, tycoon_exp_today: 0, tycoon_gold_today: 0, run: 0, run_best: 0, ach: "{}" };
  if (unlockAch(a, now).length) await env.DB.prepare("UPDATE accounts SET ach = ? WHERE id = ?").bind(a.ach, a.id).run();
  return { code, ...profileOf(a, await globalTomatoes(env), now) };
}

async function login(env, body, now) {
  const a = await accountByCode(env, body.code);
  const per = (await env.DB.prepare("SELECT key, name, att, perfect, wrong, last FROM perline WHERE account = ? ORDER BY att DESC LIMIT ?").bind(a.id, RULES.perLineRows).all()).results || [];
  const perLine = {};
  for (const r of per) perLine[r.key] = { name: r.name, att: r.att, perfect: r.perfect, wrong: r.wrong, last: r.last };
  const changed = touchLogin(a, now), newAch = unlockAch(a, now);
  await saveMeta(env, a, changed || newAch.length > 0);
  return { ...profileOf(a, await globalTomatoes(env), now, await todayLines(env, a, now)), perLine, newAch, tyc: a.tycoon_ts > 0 ? { ts: a.tycoon_ts, data: a.tycoon } : undefined };
}

async function sync(env, body, now) {
  const a = await accountByCode(env, body.code);
  const ev = body.events && typeof body.events === "object" ? body.events : {};
  const lines = Array.isArray(ev.lines) ? ev.lines.slice(0, 300) : [];
  const tom = ev.tomato && typeof ev.tomato === "object" ? ev.tomato : null;
  const spendReq = int(ev.spend, 0, 1e8), tycG = int(ev.tycoon && ev.tycoon.gold, 0, 1e8), tycE = int(ev.tycoon && ev.tycoon.exp, 0, 1e8);
  const blob = body.tyc && typeof body.tyc === "object" && typeof body.tyc.data === "string" && body.tyc.data.length <= RULES.tycoonBlobMax && Number.isFinite(Number(body.tyc.ts)) ? body.tyc : null;
  const has = lines.length || (tom && tom.n > 0) || ev.flagged > 0 || spendReq > 0 || tycG > 0 || tycE > 0 || blob;
  let warn = false, gainedExp = 0, gainedGold = 0;
  const streakAwards = [];
  const addGold = (g) => { a.gold += g; a.gold_total += g; gainedGold += g; };

  if (has) {
    if (now - a.last_sync < RULES.minSyncGapMs) throw new HttpError(429, "Syncing too often.", { retryMs: RULES.minSyncGapMs - (now - a.last_sync) });
    const tz = a.tz;
    const clampT = (t) => { t = Number(t); if (!Number.isFinite(t)) t = now; return Math.min(now, Math.max(now - RULES.maxEventAgeMs, t)); };
    const roll = (t) => {
      const d = dayOf(t, tz);
      if (d > a.day) { a.day = d; a.lines_today = 0; a.solved_today = 0; a.tomato_exp_today = 0; a.tomato_today = 0; a.tycoon_exp_today = 0; a.tycoon_gold_today = 0; }   // never go back to an earlier day
    };
    const valid = [];
    for (const e of lines) {
      if (!e || typeof e !== "object" || typeof e.key !== "string" || !e.key || e.key.length > 60) continue;
      const moves = int(e.moves, 0, 1e9);
      if (moves < 1 || moves > RULES.maxMoves) continue;
      valid.push({ key: e.key, name: String(e.name || "").slice(0, 80), moves, perfect: e.perfect === true, puzzle: e.puzzle === true, wrong: int(e.wrong, 0, 200), t: clampT(e.t) });
    }
    valid.sort((x, y) => x.t - y.t);

    const used = new Map(), dirty = new Set();                         // completions per line and day, so far
    if (valid.length) {
      const from = dayOf(valid[0].t, tz) < a.day ? a.day : dayOf(valid[0].t, tz);
      for (const r of (await env.DB.prepare("SELECT key, day, n FROM linedaily WHERE account = ? AND day >= ?").bind(a.id, from).all()).results || []) used.set(r.day + "|" + r.key, r.n);
    }
    const per = new Map();
    for (const e of valid) {
      roll(e.t);
      if (e.perfect && a.streak_day !== a.day) {                       // first perfect line or puzzle of the day: the streak grows
        a.streak = a.streak_day === prevDay(a.day) ? a.streak + 1 : 1; a.streak_day = a.day;
        const r = streakReward(a.streak);
        a.exp += r.exp; gainedExp += r.exp; addGold(r.gold); streakAwards.push({ n: a.streak, exp: r.exp, gold: r.gold });
      }
      if (a.solved_today >= RULES.solvedPerDay) continue;              // beyond this the completion isn't counted at all
      a.solved_today++;
      if (e.puzzle) a.puzzles++; else a.lines++;
      if (e.perfect) { a.perfect++; a.perfect_moves += e.moves; if (e.puzzle) a.perfect_puzzles++; a.run++; if (a.run > a.run_best) a.run_best = a.run; } else a.run = 0;
      const k = a.day + "|" + e.key, n = used.get(k) || 0;
      used.set(k, n + 1); dirty.add(k);
      if (n < RULES.perLinePerDay) { const g = lineExp(e.moves, e.perfect).total; a.exp += g; gainedExp += g; }
      if (n === 0) addGold(RULES.goldPerLine);
      const p = per.get(e.key) || { name: e.name, att: 0, perfect: 0, wrong: 0, last: "" };
      p.name = e.name; p.att++; if (e.perfect) p.perfect++; p.wrong += e.wrong; p.last = a.day;
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
      a.tomato_exp_today += g; a.exp += g; gainedExp += g; a.tomatoes += ok; added = ok;
      const goldOf = (t) => Math.min(RULES.tomatoGoldPerDay, Math.floor(t / RULES.tomatoPerGold));
      const gg = goldOf(a.tomato_today + ok) - goldOf(a.tomato_today);
      a.tomato_today += ok; addGold(gg);
    }
    if (tycG > 0 || tycE > 0 || spendReq > 0) {
      roll(now);
      const gg2 = Math.max(0, Math.min(tycG, RULES.tycoonGoldPerDay - a.tycoon_gold_today)), ee2 = Math.max(0, Math.min(tycE, RULES.tycoonExpPerDay - a.tycoon_exp_today));
      a.tycoon_gold_today += gg2; a.tycoon_exp_today += ee2; a.exp += ee2; gainedExp += ee2; addGold(gg2);     // boss rewards first, then spending
      const sp = Math.min(spendReq, a.gold); a.gold -= sp;
    }
    if (blob) {
      const ts = Math.floor(Number(blob.ts));
      if (ts > a.tycoon_ts && ts <= now + 86400000) { a.tycoon = blob.data; a.tycoon_ts = ts; }
    }
    a.flagged += int(ev.flagged, 0, 5);
    a.last_sync = now;

    const stmts = [env.DB.prepare(`UPDATE accounts SET tycoon_exp_today=?, tycoon_gold_today=?, tycoon=?, tycoon_ts=?, exp=?, gold=?, gold_total=?, lines=?, puzzles=?, perfect=?, perfect_puzzles=?, run=?, run_best=?, perfect_moves=?, tomatoes=?, flagged=?, day=?, solved_today=?, tomato_exp_today=?, tomato_today=?, streak=?, streak_day=?, last_sync=? WHERE id=?`)
      .bind(a.tycoon_exp_today, a.tycoon_gold_today, a.tycoon, a.tycoon_ts, a.exp, a.gold, a.gold_total, a.lines, a.puzzles, a.perfect, a.perfect_puzzles, a.run, a.run_best, a.perfect_moves, a.tomatoes, a.flagged, a.day, a.solved_today, a.tomato_exp_today, a.tomato_today, a.streak, a.streak_day, a.last_sync, a.id)];
    if (added) stmts.push(env.DB.prepare("UPDATE meta SET v = v + ? WHERE k = 'tomatoes'").bind(added));
    for (const k of dirty) { const [d, ...rest] = k.split("|"); stmts.push(env.DB.prepare("INSERT INTO linedaily(account, key, day, n) VALUES(?,?,?,?) ON CONFLICT(account, key, day) DO UPDATE SET n = excluded.n").bind(a.id, rest.join("|"), d, used.get(k))); }
    stmts.push(env.DB.prepare("DELETE FROM linedaily WHERE account = ? AND day < ?").bind(a.id, dayOf(now - 3 * 86400000, tz)));
    if (per.size) {
      let allowNew = true, have = null;
      if ((await env.DB.prepare("SELECT COUNT(*) c FROM perline WHERE account = ?").bind(a.id).first()).c >= RULES.perLineRows - 50) {
        have = new Set(((await env.DB.prepare("SELECT key FROM perline WHERE account = ?").bind(a.id).all()).results || []).map((r) => r.key)); allowNew = false;
      }
      for (const [key, p] of per) if (allowNew || have.has(key)) stmts.push(env.DB.prepare(PERLINE_UPSERT).bind(a.id, key, p.name, p.att, p.perfect, p.wrong, p.last));
    }
    await env.DB.batch(stmts);
  }
  const changed = touchLogin(a, now), newAch = unlockAch(a, now);       // any sync counts today as a signed-in day
  await saveMeta(env, a, changed || newAch.length > 0);
  const out = { ...profileOf(a, await globalTomatoes(env), now, await todayLines(env, a, now)), warn, gained: { exp: gainedExp, gold: gainedGold }, streakAwards, newAch,
                tyc: a.tycoon_ts > Math.floor(Number(body.tycTs) || 0) && a.tycoon_ts > Math.floor(Number(blob && blob.ts) || 0) ? { ts: a.tycoon_ts, data: a.tycoon } : undefined,
                ranks: body.ranks ? await ranksOf(env, a) : undefined };   // undefined is left out of the JSON
  return out;
}

const BOARDS = {
  exp: "SELECT nick, exp AS v, exp AS xp FROM accounts WHERE exp > 0 ORDER BY exp DESC, created ASC LIMIT 25",
  lines: "SELECT nick, lines AS v, exp AS xp FROM accounts WHERE lines > 0 ORDER BY lines DESC, created ASC LIMIT 25",
  puzzles: "SELECT nick, puzzles AS v, exp AS xp FROM accounts WHERE puzzles > 0 ORDER BY puzzles DESC, created ASC LIMIT 25",
  tomatoes: "SELECT nick, tomatoes AS v, exp AS xp FROM accounts WHERE tomatoes > 0 ORDER BY tomatoes DESC, created ASC LIMIT 25",
  avglen: "SELECT nick, ROUND(perfect_moves * 1.0 / perfect, 1) AS v, exp AS xp FROM accounts WHERE perfect >= 10 ORDER BY perfect_moves * 1.0 / perfect DESC, created ASC LIMIT 25",
};
async function leaderboard(env, request) {
  const key = new Request(new URL("/leaderboard", request.url).toString());
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(key); if (hit) return await hit.text(); }
  /** @type {Record<string, any>} */
  const out = { updated: Date.now() };
  for (const [name, sql] of Object.entries(BOARDS)) out[name] = ((await env.DB.prepare(sql).all()).results || []).map((r, i) => ({ rank: i + 1, nick: r.nick, value: r.v, exp: r.xp }));
  const text = JSON.stringify(out);
  if (cache) await cache.put(key, new Response(text, { headers: { "Cache-Control": "public, max-age=300", "Content-Type": "application/json" } }));
  return text;
}

// ---------------------------------------------------------------- owner tools
async function admin(env, body, now) {
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 16) throw new HttpError(404, "The admin tools are switched off. Set the ADMIN_TOKEN secret (16+ characters) to use them.");
  const [x, y] = [await sha256("t:" + String(body.token || "")), await sha256("t:" + env.ADMIN_TOKEN)];
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  if (diff) throw new HttpError(403, "Wrong admin token.");
  const nick = String(body.nick || "").trim().toLowerCase();
  const view = async (a, withCode) => ({
    nick: a.nick, created: a.created, lastSync: a.last_sync, exp: a.exp, gold: a.gold, lines: a.lines, puzzles: a.puzzles, tomatoes: a.tomatoes, flagged: a.flagged, streak: a.streak,
    hasCode: !!a.code_enc, code: withCode ? ((await unseal(env, a.code_enc)) ? pretty(await unseal(env, a.code_enc)) : null) : undefined,
  });
  switch (body.action) {
    case "list": {
      const q = nick ? "%" + nick.replace(/[%_]/g, "") + "%" : "%";
      const rows = (await env.DB.prepare("SELECT * FROM accounts WHERE nick_lc LIKE ? ORDER BY created DESC LIMIT 100").bind(q).all()).results || [];
      return { accounts: await Promise.all(rows.map((a) => view(a, false))), codeKeySet: !!env.CODE_KEY };
    }
    case "find": {
      const a = await env.DB.prepare("SELECT * FROM accounts WHERE nick_lc = ?").bind(nick).first();
      if (!a) throw new HttpError(404, "No account with that nickname.");
      return { account: await view(a, true), codeKeySet: !!env.CODE_KEY };
    }
    case "reset": {                                                     // issue a brand new code (the old one stops working)
      const a = await env.DB.prepare("SELECT * FROM accounts WHERE nick_lc = ?").bind(nick).first();
      if (!a) throw new HttpError(404, "No account with that nickname.");
      const code = newCode(), norm = normCode(code);
      await env.DB.prepare("UPDATE accounts SET code_hash = ?, code_enc = ? WHERE id = ?").bind(await sha256(norm), await seal(env, norm), a.id).run();
      return { nick: a.nick, code };
    }
    case "delete": {
      const a = await env.DB.prepare("SELECT * FROM accounts WHERE nick_lc = ?").bind(nick).first();
      if (!a) throw new HttpError(404, "No account with that nickname.");
      await env.DB.batch([env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(a.id), env.DB.prepare("DELETE FROM perline WHERE account = ?").bind(a.id), env.DB.prepare("DELETE FROM linedaily WHERE account = ?").bind(a.id)]);
      return { deleted: a.nick };
    }
    default: throw new HttpError(400, "Unknown action.");
  }
}

// ---------------------------------------------------------------- entry
export default {
  lineExp, streakReward, achievements: ACH.map((c) => ({ id: c.id, tiers: c.tiers })),   // exposed only so the tests can check they match src/progress.js
  async fetch(request, env) {
    const origins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : DEFAULT_ORIGINS;
    const origin = request.headers.get("Origin") || "";
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const isAdmin = path === "/admin";                                   // the admin page is opened from a file, so it has no allowed origin: the secret token protects it instead
    const cors = {
      "Access-Control-Allow-Origin": isAdmin ? "*" : origins.includes(origin) ? origin : origins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin",
    };
    const reply = (obj, status = 200) => new Response(typeof obj === "string" ? obj : JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!env.DB) return reply({ error: "The DB binding is missing. See the README (step: add the D1 database)." }, 500);
    const now = Date.now();
    try {
      if (request.method === "POST" && !isAdmin && origin && !origins.includes(origin)) throw new HttpError(403, "origin not allowed");
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
      if (isAdmin) return reply(await admin(env, body, now));
      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message, ...e.extra }, e.status);
      return reply({ error: "server error" }, 500);
    }
  },
};

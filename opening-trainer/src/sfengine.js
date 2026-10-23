// Stockfish in a Web Worker, shared by every table in the tournament hall.
// One worker serves all the games (searches are queued), it is started only when a strong engine first needs it,
// it uses a small hash table, and it is shut down again after a while without work, so it costs nothing when it isn't used.

const DEFAULT_URL = "assets/engine/stockfish-19-lite-single.js";

/**
 * createWorker: () => Worker-like { postMessage(line), onmessage({data}), terminate() } (defaults to the bundled lite engine).
 * idleMs: how long an idle engine is kept in memory.
 */
export function createStockfish({ createWorker = () => new Worker(DEFAULT_URL), idleMs = 60000, hashMb = 8 } = {}) {
  let worker = null, ready = null, waiter = null, idleTimer = 0, chain = Promise.resolve(), lastOpts = "";

  const send = (cmd) => worker.postMessage(cmd);
  const onLine = (line) => { if (waiter) waiter(String(line)); };
  const until = (test, ms, cmd) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { waiter = null; reject(new Error("The chess engine didn't answer.")); }, ms);
    const info = [];
    waiter = (line) => { info.push(line); const r = test(line, info); if (r !== undefined) { clearTimeout(t); waiter = null; resolve(r); } };
    if (cmd) send(cmd);
  });

  function start() {
    if (ready) return ready;
    ready = (async () => {
      worker = createWorker();
      worker.onmessage = (e) => onLine(e.data);
      worker.onerror = () => { shutdown(); };
      await until((l) => (l.startsWith("uciok") ? true : undefined), 20000, "uci");
      send(`setoption name Hash value ${hashMb}`); send("setoption name Threads value 1");
      await until((l) => (l.startsWith("readyok") ? true : undefined), 20000, "isready");
    })().catch((e) => { shutdown(); throw e; });
    return ready;
  }
  function shutdown() {
    clearTimeout(idleTimer);
    if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
    worker = null; ready = null; waiter = null; lastOpts = "";
  }
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(shutdown, idleMs); };

  /**
   * Ask for a move. req: { fen, elo (null = full strength), movetime }.
   * Resolves { uci, cp, mate } where cp / mate are from White's point of view (cp is null when the engine gave no score).
   */
  function think(req) {
    const job = chain.then(async () => {
      await start();
      const opts = req.skill != null ? `S${req.skill}` : req.elo ? `L${req.elo}` : "full";
      if (opts !== lastOpts) {
        if (req.skill != null) { send("setoption name UCI_LimitStrength value false"); send(`setoption name Skill Level value ${Math.max(0, Math.min(20, Math.round(req.skill)))}`); }
        else if (req.elo) { send("setoption name UCI_LimitStrength value true"); send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, Math.round(req.elo)))}`); }
        else { send("setoption name UCI_LimitStrength value false"); send("setoption name Skill Level value 20"); }
        lastOpts = opts;
      }
      send("position fen " + req.fen);
      const white = req.fen.split(" ")[1] !== "b";
      const res = await until((l, info) => {
        if (!l.startsWith("bestmove")) return undefined;
        const best = l.split(/\s+/)[1];
        let cp = null, mate = null;
        for (let i = info.length - 2; i >= 0; i--) {
          const m = /\bscore (cp|mate) (-?\d+)/.exec(info[i]);
          if (m) { const v = Number(m[2]) * (white ? 1 : -1); if (m[1] === "cp") cp = v; else mate = v; break; }
        }
        return { uci: best, cp, mate };
      }, Math.max(4000, (req.movetime || 100) + 4000), `go movetime ${Math.max(10, Math.round(req.movetime || 100))}`);
      if (!res.uci || res.uci === "(none)") throw new Error("The chess engine had no move.");
      return res;
    });
    chain = job.catch(() => {});                          // a failed search must not block the next one
    job.finally(touch).catch(() => {});
    return job;
  }

  return { think, shutdown, get running() { return !!worker; } };
}

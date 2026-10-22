// A tiny global counter for the Study Break page, written for Cloudflare Workers (free plan).
//
// Setup (about 5 minutes, see the README for the click-by-click version):
//   1. Cloudflare dashboard -> Storage & databases -> KV -> create a namespace called "tomatoes".
//   2. Workers & Pages -> Create -> "Hello World" worker -> Edit code -> paste this whole file -> Deploy.
//   3. Worker -> Settings -> Bindings -> Add -> KV namespace -> variable name COUNTER -> pick "tomatoes".
//   4. Copy the worker's address (https://<name>.<you>.workers.dev) into config.js as tomatoCounterUrl.
//
// API:  GET  /count          -> { "count": 123 }
//       POST /hit  {"n": 1}  -> { "count": 124 }       (n is limited to 1..1000 per request)
//
// Note: Workers KV is not atomic, so if many people throw in the very same moment a few throws can be lost. That's fine for a toy counter.

const DEFAULT_ORIGINS = ["https://mychesstrainer.net", "https://www.mychesstrainer.net", "https://cjlittle7.github.io"];
const KEY = "tomatoes";

export default {
  async fetch(request, env) {
    const origins = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : DEFAULT_ORIGINS);
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const read = async () => { const v = parseInt(await env.COUNTER.get(KEY), 10); return Number.isFinite(v) && v > 0 ? v : 0; };

    if (request.method === "GET" && (path === "/count" || path === "")) return json({ count: await read() });

    if (request.method === "POST" && path === "/hit") {
      if (origin && !origins.includes(origin)) return json({ error: "origin not allowed" }, 403);
      let n = 1;
      try { n = parseInt((await request.json()).n, 10); } catch { /* no body: one throw */ }
      if (!Number.isFinite(n)) n = 1;
      n = Math.max(1, Math.min(1000, n));
      const count = (await read()) + n;
      await env.COUNTER.put(KEY, String(count));
      return json({ count });
    }
    return json({ error: "not found" }, 404);
  },
};

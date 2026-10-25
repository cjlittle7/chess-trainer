<div align="center">

# ♞ My Chess Trainer

**Drill your openings. Build a bot army. Climb the leaderboard.**

An installable, offline-first chess study app with a built-in idle "tournament tycoon" game.

![version](https://img.shields.io/badge/version-2.22.0-5aa02c) ![platform](https://img.shields.io/badge/PWA-iPhone%20%7C%20Android%20%7C%20Desktop-3a7bd5) ![stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Cloudflare%20D1-f6821f)

</div>

---

## Highlights

| | |
|---|---|
| 📚 **Study** | Record opening lines into colour-coded collections, then drill them on a draggable board with hints, spaced repetition and a perfect-run tracker. Practise either side, solve custom puzzles, and explore your repertoire as a tree. |
| 🗂 **Game libraries** | Import PGN files or Lichess / chess.com games; the explorer shows win / draw / loss results for every position. |
| 🏆 **Progress** | EXP, gold, levels, a daily streak, achievements and a worldwide leaderboard. Accounts use a recovery code, with no email or password. |
| 🏟 **Tycoon** | Engines, from silly "alphabetical" bots up to full-strength Stockfish, play for you at up to four tables. Buy engines, openings and items, beat bosses, and collect brilliant sacrifices that Stockfish has verified. |
| 📱 **Anywhere** | A static PWA: installs to the iPhone Home Screen, works offline, and stores your data on your device. |

## Quick start

```bash
npm install
npm run build        # bundles src/ into app.js and style.css
python3 -m http.server 8000
```

Open <http://localhost:8000>. The first load caches the app; open it twice after each update to pick up the new version.

### Publish (GitHub Pages)

1. Create a **public** repository and push this folder.
2. **Settings → Pages**: deploy from the `main` branch, root folder.
3. On an iPhone open the address in Safari → **Share → Add to Home Screen**.

Full step-by-step instructions and backup advice are in the [reference guide](docs/GUIDE.md).

## Online features (optional)

Accounts, the leaderboard, the tomato counter, the Tycoon cloud save and the editable About / Support pages run on one Cloudflare Worker with a D1 database.

1. Create a D1 database called `chess-trainer` (the worker creates its own tables).
2. Paste [`tools/tomato-counter-worker.js`](tools/tomato-counter-worker.js) into a Worker named `tomato-counter` and bind the database as `DB`.
3. Add two **secrets**: `ADMIN_TOKEN` (16+ random characters) and, optionally, `CODE_KEY` (to let you look up lost recovery codes).
4. Put the worker address in `config.js` as `tomatoCounterUrl`.

Without a worker the app still works fully offline; only the online features are hidden.

> Keep `ADMIN_TOKEN`, `CODE_KEY` and players' recovery codes private. The admin token is only ever typed into your own browser.

## Daily rewards

* **Streak**: the first visit each day pays EXP and gold immediately. Day *n* gives 50 + 10n EXP (max 1,000) and 10 + 5n gold (max 500); missing a day restarts at 1.
* **Notifications** are colour coded: 🟦 brilliant move · 🟩 boss beaten · 🟨 achievement · 🟧 daily streak · 🟪 level up.

## Project layout

```
index.html, config.js        entry page and settings
src/                         app source (main, tycoon, hall UI, botplay, sfengine, botgames, pages …)
app.js, style.css            build output (esbuild)
sw.js                        service worker (cache name bumps each release)
assets/engine/               Stockfish.js 19 (GPLv3, unmodified, see COPYING.txt)
tools/                       Cloudflare worker, admin console, data helpers
docs/GUIDE.md                detailed reference manual
CHANGELOG.md                 release history
```

## Development

```bash
npm run build         # rebuild after editing src/
node tools/gen-packs.mjs   # regenerate the sample opening packs
```

The service worker is cache-first, so bump `CACHE` in `sw.js` and `VERSION` in `src/main.js` for every release.

## Credits and licence

Built with [chessops](https://github.com/niklasf/chessops) and [chessground](https://github.com/lichess-org/chessground). Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3).

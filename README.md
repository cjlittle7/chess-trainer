# Opening Trainer (offline web app)

Drill your chess opening lines on a draggable board. Runs entirely in the browser, installs to the iPhone Home Screen
and works offline. Your collections are stored on your device (IndexedDB); there is no server.

## Publish it (GitHub Pages)

1. On github.com (signed in as **cjlittle7**) create a repository named `chess-trainer`.
   Choose **Public** (free GitHub Pages needs a public repo) and do not add a README.
2. Put this folder at `C:\Users\Calvin\.copilot\repos\chess-trainer`, then in a terminal there:

       git init -b main
       git add .
       git commit -m "Opening Trainer web app"
       git remote add origin https://github.com/cjlittle7/chess-trainer.git
       git push -u origin main

   (No git? On the repo page use **Add file > Upload files** and drag in everything except `node_modules`.)
3. Repo **Settings > Pages**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`, Save.
   After a minute the app is live at **https://cjlittle7.github.io/chess-trainer/**

## Put it on the iPhone

1. Open that address in **Safari**, tap **Share > Add to Home Screen**, then launch it from the new icon.
2. Move your lines across: get `opening-trainer-data.json` onto the phone (email it to yourself, or use iCloud Drive /
   OneDrive / Google Drive), then in the app open **Backup & sync > Import backup...** and pick the file.
   Do this inside the Home Screen app, not Safari: the two keep separate storage.
3. Keep a copy: **Backup & sync > Export backup** opens the share sheet (save to Files, AirDrop, etc).
   iOS can clear website storage in rare cases, so export a backup now and then.

Keep `opening-trainer-data.json` out of the repository: it is your personal data and the repo is public.

## Playing the other side

Under the collection menu, **Play as** White/Black switches which side you play in that collection (the lines stay the same). Each
collection remembers its choice for the rest of the session, including after a reload, and it is used by drills, the explorer and the
line editor. It resets when you close the app; the colour a collection was recorded for is never changed.

## Game libraries and results

Open **Game libraries** near the bottom of the page. A library turns many real games into an opening tree (the first 15 moves of each by
default), so the explorer can show how often every move was played and how often White won, it was drawn, or Black won (the bar and the
percentages are White / draw / Black).

- **From a PGN file:** pick a file of games (master games, a database export, your own export). Optionally keep only games where both
  players have a minimum rating. Unpack .zip / .zst files first.
- **From a Lichess username:** downloads that player's games straight into the app. Choose all games (one library as White and one as
  Black), only White or only Black, a time control, and rated only.
- **From a chess.com username:** the same, via chess.com's public game archives. If the browser can't reach chess.com, run
  `python tools/download_games.py chesscom your_name -o games.pgn` on a computer and import that file instead (the script also does Lichess).
- In the explorer, pick **Game library** as the source. A library made from one colour of your games fixes your side to that colour.
  Opponent replies work as before (drag a piece, buttons, or **Random choice**, which follows how often each reply was played).
  The explorer doesn't switch to testing mode for libraries.
- **Finding the games:** the newest 50 games that reached the current position are listed automatically (**Hide games** / **Show games**
  to toggle, remembered). Each has a green magnifying-glass button that opens it on Lichess or chess.com in a new tab, and a grey **>** button
  that plays that game's next move on the board, for either side. At a position only one game reaches, the same two buttons appear in a card above the list. Links come
  from the game's `Site` (Lichess) or `Link` (chess.com) tag; files without them show just the players, rating, result and date.
  Libraries made before v2.2.0 need to be deleted and imported again to get this.
- Games are only used if they have a result and start from the standard position. Libraries live in this browser only and are not part
  of the backup file; re-import them if you move devices.

Full games in your own collections now remember their result too (`[Result]` in the PGN). It shows as a tag in the line list, as a
White / draw / Black bar beside each explorer move, and when a drill or explorer line ends. Only the main line of a game gets the result,
not its variations.

## Puzzles (custom positions)

A line can start from any position, not just the opening position. Puzzles live in your normal collections.

- **Record a puzzle** opens the position setup. Drag pieces from the palette onto the board (or tap a piece, then tap
  squares). Drag a piece off the board to remove it. Set whose turn it is and the castling rights, or paste a FEN, or
  start from the position after any move of a line you already have.
- The setup refuses impossible positions and says why (no king, pawn on the last rank, side not to move in check, ...).
- **Start recording** locks the position and opens the normal line editor (undo, tap a move to delete it, promotions).
  Save as many solutions as you like. Each is its own line, and practicing works as for any other line.
- When you practice a puzzle you play the side that is to move in the starting position.
- Random drill only walks opening lines; "Practice all lines in order" includes puzzles.
- Pasting PGN with a `[FEN "..."]` header now imports it as a puzzle instead of skipping it.
- Backups made before puzzles existed still import fine, and backups now keep each line's starting position.

## Opening explorer

Press **Opening explorer** in the Collection panel. Choose whether you play White or Black, tick the collections to use
(Select all = every opening you have for that colour) and press **Start exploring**.

- Every move your lines play from the current position is drawn on the board and listed with how many lines use it.
  Play any of them; lines that reach the same position by a different move order are combined.
- When your opponent has one saved reply it is played automatically. When several lines disagree you pick the reply
  by dragging one of the opponent's pieces on the board, or with the buttons / **Random choice**.
- As soon as only one line is left, the explorer tests you like a normal drill: no arrows, wrong moves snap back,
  **Hint** shows the book move.
- Untick **Show move hints and continued lines** to practise without arrows or line counts (remembered).
- Tap any move in the sequence to view that position on the board; your explorer line is kept, and **Return to position** brings you back.
- **Copy PGN** puts the moves up to the position on the board on your clipboard, ready to paste into chess.com's import.
- **Create line from here** opens the line editor with those moves already entered; keep playing, pick a collection and Save line. (This closes the explorer.)
- Untick **Auto-play the opponent's only move** to use the explorer with nothing played for you: even when your opponent has just one move,
  you play it yourself (drag their piece or press the button). It can be switched on again at any time and is remembered.
- Viewing an earlier move also shows **Explore from here**: it drops the later moves and carries on exploring from that position
  (so you don't have to undo them one by one).
- **Back** takes a move back, **Restart** starts again, and a summary appears at the end of each line.
- Puzzles (custom-position lines) are not used.

## Moving data from the old Flask version

    python tools/trainer_db_to_json.py trainer.db opening-trainer-data.json

## Changing the app

    npm install
    npm run build        # bundles src/ into app.js and style.css

Commit and push the rebuilt `app.js` / `style.css`. (`CNAME` holds your custom domain; leave it in place.) The service worker (`sw.js`) shows updates the second time the app
is opened; change `CACHE` in `sw.js` if you add or rename files.

## Themes

Open **Appearance** to pick a board colour and a piece set (saved on this device). Piece sets: Classic (Colin M.L. Burnett, GPLv2+), Merida
(Armando Hernandez Marroquin, GPLv2+), Chessnut (Alexis Luengas, Apache 2.0), Modern (RhosGFX, CC0) and Celtic (Maurizio Monge, MIT),
all taken from the Lichess project. **Barnes (custom)** is a set made from your own photos (`assets/pieces/barnes`, one image per piece; replace
the files and rebuild to change it). See `assets/pieces/CREDITS.md`.

Explorer arrows are weighted by popularity: the more games (or lines) play a move, the thicker and more opaque its arrow, on a
logarithmic scale relative to the most-played move (a move played 10 times less than the top move gets half the weight, 100 times less
gets the minimum).

## Licence note

The app bundles chessops and Chessground, both GPL-3.0-or-later. Publishing the source in your public repo, as above,
is how that licence expects it to be shared.

## Study break (tomato page)

The **STUDY BREAK** tab shows a photo and a **TOMATO** button. Each press plays the tomato GIF over the photo; when it finishes, its last frame stays on the picture until you leave the tab. The worldwide counter adds up every press from every visitor.

A static website can't store a shared number by itself, so the counter needs a tiny free service. Until you set it up, the page counts presses on that device only and says so.

### Turning on the worldwide counter (Cloudflare, free, about 5 minutes)
1. Make a free account at cloudflare.com. In the dashboard open **Storage & databases → KV** and create a namespace named `tomatoes`.
2. Open **Workers & Pages → Create → Hello World**, name it (e.g. `tomato-counter`), click **Deploy**, then **Edit code**. Replace everything with the contents of `tools/tomato-counter-worker.js` and **Deploy**.
3. In the worker's **Settings → Bindings → Add → KV namespace**, set the variable name to exactly `COUNTER` and choose `tomatoes`.
4. Copy the worker's address (like `https://tomato-counter.yourname.workers.dev`) into `config.js` as `tomatoCounterUrl`, upload `config.js` to GitHub, and reopen the app twice.

The worker only accepts throws from mychesstrainer.net, www.mychesstrainer.net and cjlittle7.github.io (edit `DEFAULT_ORIGINS`, or add an `ALLOWED_ORIGINS` variable, to change that). To stay well inside Cloudflare's free limits the app is frugal: it asks for the total once per visit (the first time the Study Break tab is opened), counts your own presses locally, and sends them in one batch at most every 10 minutes (and only if there is something new) plus once more when you close or leave the page. Other people's presses therefore show up the next time you reload. Unsent presses are kept if you're offline. The 10 minutes can be changed with `tomatoSyncMs` in `config.js`. Because Cloudflare KV isn't atomic, a few presses made in the very same instant by different people can be lost; that is fine for a toy counter.

Replace `assets/study/photo.jpg` to change the picture; make sure you have the right to use it.

## Training EXP (stage 1: on this device)

- **Completing a line or puzzle:** 1 EXP per move you play. A **perfect** line (no wrong attempts, no hints) adds +5, and +5 more for each of 10, 15, 20 and 25 moves reached (so a perfect 20-move line earns 20 + 5 + 15 = 40).
- **Daily limit:** each line or puzzle earns EXP for its first 5 completions per day (your local day). More completions still count towards your lifetime totals.
- **Tomatoes:** +1 EXP per throw, up to 100 EXP per day. Reaching the 100th shows "Procedure Performed!". More throws still play but give no EXP.
- **Auto-clickers:** script-made clicks, presses faster than about 11 a second, or ten presses with machine-perfect timing trigger a warning. The burst's EXP and tomatoes are taken back, and the button is inactive for 30 minutes.
- **Your progress** panel shows EXP, today's allowances, lifetime lines / puzzles / perfect lines, your average perfect-line length, and your trickiest lines. You can set a nickname there.
- All of this is saved in this browser only for now (clearing site data resets it). Accounts with a recovery code, the leaderboard and server-side checks come next.

## Accounts and the leaderboard (stage 2)

With the online service switched on, the Progress panel offers **Create account**. You pick a nickname and get a **recovery code** (no password). The code restores your profile on another phone or after clearing browser data; anyone who has it can use your profile, so keep it private. Progress you made before creating the account is carried over (within limits).

- The server owns the rules: EXP, the 5-lines-a-day and 100-tomato-EXP-a-day caps, and a maximum believable pressing rate. A device only sends its new activity; the server's totals are the truth.
- Uploads are batched: at most one every 10 minutes (`tomatoSyncMs`), plus when you leave the page, when you press **Sync now**, and when you open the leaderboard. The server accepts one batch per account every 15 seconds.
- The **LEADERBOARD** tab ranks EXP, opening lines solved, puzzles solved, tomatoes thrown, and the average length of perfectly completed lines (needs 10 perfect lines). It's cached for 5 minutes.
- Your nickname is public on the leaderboard. Nothing else is shown. No email or password is collected.
- It can't be made cheat-proof (the app can't prove a line was really played), but daily caps, per-day limits on what counts, rate limits and a limit of 5 new accounts per network per day keep cheating small. Honest limits: someone can still make several accounts or play very fast.

### Setting it up (replaces the earlier KV-only worker; about 10 minutes)
1. Cloudflare dashboard → **Storage & databases → D1 SQL database → Create database**. Name it `chess-trainer`. You don't need to create any tables; the worker creates them.
2. **Workers & Pages → your `tomato-counter` worker → Edit code**. Keep the file called `worker.js`, select everything, paste the new contents of `tools/tomato-counter-worker.js`, and **Deploy**.
3. In the worker's **Settings → Bindings → Add → D1 database**: variable name exactly `DB`, database `chess-trainer`. Leave the old `COUNTER` KV binding in place: its tomato total is copied into the new counter the first time the worker runs.
4. Open `https://<your-worker>.workers.dev/count` (it should show your total) and `/leaderboard` (empty lists at first).
5. `config.js` doesn't change (`tomatoCounterUrl` is the same address). Upload the new app files to GitHub and reopen the app twice.

**Moderation:** in the D1 database's **Console** you can remove an account with `DELETE FROM accounts WHERE nick_lc = 'someone';` (use lower case). Extend the `BLOCKED` list at the top of the worker to refuse more nickname words.


## Gold, levels and the daily streak (v2.9)

- **Gold:** +10 the first time you complete each line or puzzle each day, and 1 for every 5 tomatoes thrown (up to 20 a day). For now it is a counter; nothing spends it yet.
- **Levels:** you start at level 1. Going from level n to n+1 takes 100 + (100 × (n − 1))^(1.001^n) EXP, rounded down to a multiple of 10 (100 for level 1, 200 for level 2, 300 for level 3, 510 for level 5, 1,060 for level 10). The bar under the tabs shows your progress; a level-up pops up.
- **Daily streak (needs an account):** the first line or puzzle of 5 or more moves you finish each day (perfect or not) extends your streak. Day n pays **50 + 10 × n EXP** (at most 1,000) and **10 + 5 × n gold** (at most 500). Miss a whole day and it starts again at 1. The 🔥 counter next to your level shows the streak; it is dimmed until you've done today's line. The app syncs a moment after that first line, and when you open it, so the bonus and new achievements show up right away.

## Owner tools: finding a lost recovery code

Players who lose their recovery code can only be helped if you can look it up, so the service can keep each code **encrypted**. A copy of the database alone shows nothing; the key is a secret that only exists in Cloudflare.

1. In the worker's **Settings → Variables and Secrets → Add**, add two **secrets** (type *Secret*): `CODE_KEY` (any long random text, e.g. 40 random characters; keep your own copy, because without it stored codes can't be read) and `ADMIN_TOKEN` (another long random text, at least 16 characters). Deploy.
2. Open `tools/admin.html` **from your own computer** (double-click the file; don't upload it with the app). Enter your worker address and the admin token. You can search accounts, **show a recovery code**, **issue a new code** (the old one stops working) or **delete an account**.
3. Accounts created before `CODE_KEY` existed have no stored code until that person next signs in or syncs; for them use **Issue a new code**. If you'd rather not keep codes at all, simply don't set `CODE_KEY`.

Keep both secrets private. Anyone with the admin token and the key can read recovery codes, so only hand a code to the person who owns the account. The app tells new players that the site owner can look up their code to help them.

## Earning animations (v2.10)

- Every EXP and gold gain floats up as a "+N" popup: from the counters under the tabs when you finish a line or puzzle (or from the board if the counters are scrolled out of view), and from the TOMATO button when you throw. The EXP and gold numbers then count up into their new totals and the level bar fills as they do.
- People who have "reduce motion" switched on in their device settings get no popups and the totals simply update.
- The gold coin is drawn by the app instead of an emoji, because some phones can't show the coin emoji.
- Every leaderboard has a **Level** column (worked out from the player's EXP). This needs the updated `tools/tomato-counter-worker.js`; with the old worker the column shows "–".

## Achievements, perfect runs and tab changes (v2.11)

- **Tabs:** STUDY (the trainer), 🍅 (the study break), ACHIEVEMENTS and LEADERBOARD.
- **Achievements:** 39 collectable badges. 1 / 10 / 100 / 1,000 / 10,000 / 100,000 for perfect lines, perfect puzzles, lifetime EXP, lifetime gold and tomatoes thrown; 10 / 50 / 100 / 1,000 / 10,000 perfect lines or puzzles in a row; 7 / 30 / 100 / 365 days in a row signed in (needs an account). Badges stay unlocked once earned. A toast announces each new one.
- **Perfect in a row:** the 🎯 chip at the top shows your current run of perfect lines and puzzles. A line or puzzle finished with a wrong move or a hint ends it; your best is kept. "Days in a row" counts days you open the app signed in, and is separate from the daily perfect-solve streak.
- **Online service:** this release adds columns and tracking to the worker, so paste the new `worker.js` into Cloudflare and Deploy. Existing accounts are upgraded automatically (lifetime gold starts from the gold they hold).
- The result panel now keeps each stat on one line and puts the EXP breakdown on a note line below it.

## v2.19.1

- **Colour per table** (Tycoon, Admin settings → "Colour each table plays"): each table, or all at once, can alternate colours as before, always play White, or always play Black.

## v2.19 changes

- **Opening theory for all bots** (Tycoon page, Admin settings): a "house opening book" that applies to every bot, yours and the opponents'. Write one line per opening starting from move 1, with an optional weight before a colon, e.g. `60: e4 e5 Nf3 Nc6`. Where several lines agree so far, the next move is picked in proportion to the weights (`60: e4` / `30: d4` / `10: c4` gives White 60/30/10 on move 1). A live preview shows the resulting shares and flags lines with illegal moves. Once no line fits the game, bots play as usual. Separate boxes for when a bot plays White and when it plays Black. Switch it on with the checkbox; "Your engines' own opening packs come first" lets bought packs override it. The scripted characters (Grobulus, Barry, Gender) keep their own openings.

## v2.18 changes

- **Tycoon page**: the gold / bot EXP header is gone; the Settings (keep playing, sound, boss rewards left) now sit below the boards.
- **Table View** is now a normal part of the page (button "🏟 Table View" / "🃏 Card View"; your choice is remembered). It replaces the card boards with the grey tournament table, and everything else stays underneath, so the page scrolls as usual. The decorative clocks show no times or move numbers: the pad of the side to move looks pressed, and the losing side gets a 🚩 when a game ends (none for a draw).
- **Tables and bots** (engine, speed, move time, name, opening, items, stage, On switch) are listed under the boards in both views.
- **Inventory**: your unequipped items and your opening packs are chips. Drag one onto a bot's Item or Opening box (or tap the chip, then tap the box) to equip it.

## v2.17 changes

- **Tabs**: STUDY, LEADERBOARD, ACHIEVEMENTS, TYCOON, ABOUT, MERCH / SUPPORT FREE CHESS, and the 🍅 on the far right (the row wraps on a phone).
- **Tycoon**: four tables in total (levels 10, 50 and 100 open tables 2-4; saves that had a fifth table lose it). Each table has an **On** switch; a switched-off table plays nothing and folds up (one table must stay on). Every table plays at the highest stage reached on any table, and new tables start there.
- **Table View**: the "🏟 Table View" button on the Tycoon page shows every board at once on a grey tournament table, each with name plates and a chess clock (the clock of the side to move runs). Esc or Close leaves it.
- **About and Merch / Support pages**: everyone can read them; only you can edit them. Under the page, open **Owner login** and enter your `ADMIN_TOKEN` (the same secret the admin page uses). You can then edit the About text (bold, headings, lists, links, images, colours), pick a font, size, text colour and background, and add basic CSS (scoped to that page; scripts and unsafe CSS are removed). The Support page has fields for Venmo, PayPal, Cash App, Zelle and a merch shop link; empty fields are hidden, so leave the merch link empty until the shop exists. Pages are stored in the online service, so **you must redeploy `worker.js`** (paste it in Cloudflare, Deploy) for this to work. No new secret is needed.

## v2.16 changes

- **Tycoon:** *Force resignation* appears on a table once a game passes 50 moves each (the side behind resigns, or it is drawn if level). *Delete* an engine (not the last one; its items return to the stash). *Clear games* / *Clear every saved game* and *Reset W/D/L* in Game history. Type in a bot's name box in the shop to rename it (saved; new copies and unnamed engines use it; *Reset shop names*).
- **Admin settings** (hall): slider for how many opening moves (0–30, default 10) are filtered against silly moves; 2700+ bots get double. The filter now also refuses moves that leave a bishop, knight or rook hanging to captures (a small capture-only search, so exchanges that win the piece back are fine).
- **Tomato tab:** a 🎉 YIPPEE! button, and *Button sounds*: add your own audio file (under 1.5 MB, kept on the device) to the TOMATO button, the Yippee button, Yippee/Duck wins, boss wins and purchases.

## v2.15.1 changes

- The early-game filter and full-strength opening now cover the first **10 moves** (20 moves for bots rated 2700+).
- **Yippee!** item (500 gold): blows confetti over the board whenever the engine wins.
- Game history: **Add all to explorer** combines the games of every copy of the same bot (e.g. Grobulus Borgman #1, #2…) into one pair of libraries.

## v2.15 changes

- **No more nonsense early moves:** for the first 20 moves every bot (yours and the opponents) avoids quiet king walks, quiet queen moves and a-, h- and f-pawn pushes. Captures, checks, castling and anything made while in check are always allowed, and nothing is filtered after move 20. Full-strength Stockfish is left alone.
- **Stronger masters:** bots rated 2000+ play at full strength for their first 20 moves, then at a boosted rating (the built-in rating limiter plays well below its nominal rating at short thinking times). This makes the higher opponents (and bosses) harder.
- **Move-time slider:** every table has a slider (0.05 s steps, up to 5 s) to slow its moves down; Stockfish thinks for about three quarters of the move time, so slower tables mean deeper analysis. It can't go faster than the speed you bought. Strong bots may exceed very fast move times because they need a minimum thinking time.

## v2.14 changes

- **Game history (TYCOON, Engines tab):** every finished tournament game is saved on the device (the latest 5,000 per engine; not sent to the service; logging out clears them). Per engine: **Add to explorer** makes two game libraries (as White / as Black) for the Opening explorer's "Game library" mode; **Download .pgn** saves them all; **Review games** lists the newest ones, each with **Copy PGN** and **chess.com** (copies the PGN and opens chess.com's analysis page to paste it into; chess.com has no link-based import).

## v2.13 changes

- **Streaks and toasts:** any completed line of 5+ moves (perfect or not) counts for the daily streak, and the news arrives quickly (a sync shortly after the first qualifying line, at start-up and when you return to the app). Achievement toasts appear bottom right. **Redeploy `worker.js`** for the streak rule.
- **Tycoon:** your bots now have their own roster (a few Stockfish strengths are shared with the opponents). New characters: *Grobulus Borgman* (20,000 gold; 1.g4 / 1...g5 every game, then Stockfish), *Bongcloud Barry* (1,000; king moves in his first two moves) and *Gender Nonconformist* (800; swaps king and queen). Every purchase has a gold button and a bot EXP button. Engines can be renamed (letters, digits, spaces, 20 max). Speed upgrades move 0.05 s at 10x the price. The board turns to your bot's side and the eval bar shows its chances. Bot EXP shows beside gold; "keep playing on other tabs" is on by default; the next table is a slim row.

## Chess Tournament Tycoon (v2.12, see above for v2.13 changes)

The **TYCOON** tab is a tournament hall where chess engines play for you.

- **Engines** form a ladder of 22 rungs, from "Alphabet Al" (always plays the alphabetically first legal move) through random, capture-hungry and shallow-searching engines up to Stockfish 19 at full strength. You start with Random Rodney. Ratings are nominal (the silly engines were rated by tournaments against each other and against Stockfish at low strength). Every engine, however silly, plays a checkmate in one when it sees it.
- **Tables:** one at the start; more open at levels 10 / 50 / 100 / 200 for 2,120 / 6,120 / 8,480 / 11,230 gold (400 × ln²(level)). Each table shows its game live with an evaluation bar (White at the bottom). Your engine alternates colours every game.
- **Stages:** each table faces opponents of the stage's rung. After 5 wins the **boss** (the next rung up) appears. Beating it pays gold and player EXP (a quarter on repeats), moves the table up a stage, and is limited per day (15,000 gold and 2,000 EXP, enforced by the online service too). Losing to a boss means 3 more wins before the next try; a draw changes nothing.
- **Bot EXP:** wins earn bot EXP scaled by the opponent (a draw pays a quarter, a boss win triple). 100 bot EXP = 1 gold. The *Pay with* buttons choose bot EXP first (default), bot EXP only or gold only.
- **Upgrades:** each table's time between moves starts at 1.2 s and can be bought down to 0.04 s. Engines hold an **opening pack** and two items.
- **Opening packs:** sample packs of 3 / 5 / 10 / 15 moves unlock at levels 2 / 4 / 10 / 20. At level 50 you can write your own (up to 10 lines per side, 5 packs), or add lines from your own collections.
- **Items:** Chess Beads (1,000 gold: one rung stronger for 1 hour, then sore for 2 more), Instant Resignation Device (10,000 gold: wins one game outright, not against "titled" opponents it would beat less than 5% of the time), Duck (100 gold: quacks on wins).
- **Performance:** one shared Stockfish (the 1.9 MB single-threaded "lite" build, 8 MB hash) is started only when a strong engine first needs it, handles one search at a time and shuts down after a minute without work. Games pause when you leave the tab or the page is hidden, unless you tick *Keep playing while I'm on other tabs*.
- **Saving:** the hall's saved game lives on the device and, for signed-in accounts, is uploaded with the normal sync (newest save wins). Gold spending and boss rewards go through the same sync as everything else, so the service enforces the daily limits. Logging out starts a fresh hall on the device.
- **Service:** paste the new `worker.js` into Cloudflare and Deploy (new columns are added automatically).
- **Licence:** `assets/engine/` holds an unmodified Stockfish.js build (Stockfish 19, GPLv3, see `COPYING.txt`; source at https://github.com/nmrugg/stockfish.js). `tools/gen-packs.mjs` regenerates `src/packs.js`.

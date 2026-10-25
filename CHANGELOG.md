# Changelog

## v2.22

- **Tycoon layout**: boards never sit three over one (four tables are a 2 x 2 or a single row, in card view and Table View). The brilliant-moves panel moved from the sidebar to just under the table tabs. Sidebar text wraps instead of being cut off.
- **Tab order**: STUDY, TYCOON, ACHIEVEMENTS, LEADERBOARD, ABOUT, MERCH / SUPPORT FREE CHESS, 🍅.
- **Brilliant moves**: candidates are found more widely, then Stockfish analyses them longer (about 0.4 s before and after) and plays the line on for six moves. A move only counts if it is sound, the bot was not already winning, and the material is still down at the end of the line (or a mate follows).
- **Daily streak** is paid the first time you open the site each day, not after a line. Redeploy `worker.js`.
- **Notifications** are colour coded: blue brilliant move, green boss beaten, yellow achievement, orange daily streak, purple level up. The achievements page uses the same tier colours.
- **README** rewritten; the detailed manual moved to `docs/GUIDE.md` and the history to this file.

## v2.21 changes

- **Tycoon page redesign**: the boards sit on the left (cards, or the Table View), and a scrollable sidebar on the right holds six tabs: 🤖 Bots (your engines), 🎒 Bag (items and openings to drag onto a bot), 🛒 Shop (engines, openings, items), 📜 Games (saved game history), ✨ Best (brilliant moves) and ⚙ Admin (settings, filters, colours, opening book, force buttons). Under the boards, the controls for each table have their own tab (Table 1 to Table 4), so you see one table at a time. On a phone the page is one column: boards in a 2 x 2 grid, then the table tabs, then the sidebar tabs.
- **Shop bot names are fixed**: nobody can rename the bots in the shop any more. The names you had set are shared with everybody once you publish them: Admin tab → "Publish bot names for everybody" (it asks for your admin token the first time, or uses the one saved from the About page). Until names are published, the old local names still show on the device that set them. Redeploy `worker.js` first (it now accepts a `botnames` entry).
- **Force draw**: the admin force buttons now include Draw, so any running game can be ended as a draw at any point.

## v2.20 changes

- **Admin force buttons** (Tycoon, Admin settings → "Show force resignation / force win buttons"): four small buttons under each card-view board end the running game: White resigns, Black resigns, White wins, Black wins. The result counts like any other game.
- **Brilliant moves**: when one of your bots plays a sacrifice (it gives up at least a minor piece's worth of material by force) and a full-strength Stockfish agrees the position afterwards is not worse for the bot, was not already clearly winning, and the move is about as good as the best one, it is logged as brilliant. The ✨ Brilliant moves panel (below the inventory) sorts them into queen sacrifices, rook / exchange sacrifices, piece sacrifices and "forced mate follows". Click View to step through the game on a board, copy its PGN (the move is marked !!), open it on chess.com, or add every game in a category to the explorer. Only games finished after this update are scanned.
- **No daily cap on boss rewards**: boss gold and EXP are no longer limited per day (the online service's limits are removed as well, so redeploy `worker.js`).
- **Back to the explorer**: after "Create line from here" the line editor has a "← Back to explorer" button that returns to the exact position you left (it re-reads your collections, so a line you just saved shows up).

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

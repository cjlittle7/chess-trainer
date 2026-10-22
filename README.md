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
all taken from the Lichess project. See `assets/pieces/CREDITS.md`.

Explorer arrows are weighted by popularity: the more games (or lines) play a move, the thicker and more opaque its arrow, on a
logarithmic scale relative to the most-played move (a move played 10 times less than the top move gets half the weight, 100 times less
gets the minimum).

## Licence note

The app bundles chessops and Chessground, both GPL-3.0-or-later. Publishing the source in your public repo, as above,
is how that licence expects it to be shared.

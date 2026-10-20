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

## Puzzles (custom positions)

A line can start from any position, not just the opening position. Puzzles live in your normal collections.

- **Record a puzzle** opens the position setup. Drag pieces from the palette onto the board (or tap a piece, then tap
  squares). Drag a piece off the board to remove it. Set whose turn it is and the castling rights, or paste a FEN, or
  start from the position after any move of a line you already have.
- The setup refuses impossible positions and says why (no king, pawn on the last rank, side not to move in check, ...).
- **Start recording** locks the position and opens the normal line editor (undo, tap a move to delete it, promotions).
  Save as many solutions as you like. Each is its own line, and practising works as for any other line.
- When you practise a puzzle you play the side that is to move in the starting position.
- Random drill only walks opening lines; "Practise all lines in order" includes puzzles.
- Pasting PGN with a `[FEN "..."]` header now imports it as a puzzle instead of skipping it.
- Backups made before puzzles existed still import fine, and backups now keep each line's starting position.

## Moving data from the old Flask version

    python tools/trainer_db_to_json.py trainer.db opening-trainer-data.json

## Changing the app

    npm install
    npm run build        # bundles src/ into app.js and style.css

Commit and push the rebuilt `app.js` / `style.css`. (`CNAME` holds your custom domain; leave it in place.) The service worker (`sw.js`) shows updates the second time the app
is opened; change `CACHE` in `sw.js` if you add or rename files.

## Licence note

The app bundles chessops and Chessground, both GPL-3.0-or-later. Publishing the source in your public repo, as above,
is how that licence expects it to be shared.

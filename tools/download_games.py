#!/usr/bin/env python3
"""Download a player's games from chess.com or Lichess into one PGN file.

Import the file in the Opening Trainer: Game libraries -> Add games -> From a PGN file.
Needs only Python 3 (no extra packages).

Examples:
  python download_games.py chesscom  your_name  -o my_games.pgn
  python download_games.py chesscom  your_name  --speed blitz --rated --max 3000
  python download_games.py lichess   your_name  --color white --max 2000 -o white.pgn
"""
import argparse, json, sys, time, urllib.error, urllib.parse, urllib.request

CHESSCOM = "https://api.chess.com/pub"
LICHESS = "https://lichess.org"
UA = "OpeningTrainerDownloader/1.0 (personal use; contact: your-email@example.com)"   # chess.com asks for a contact in the user agent


def fetch(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    for attempt in range(4):
        try:
            return urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                sys.exit(f"Not found: {url} (check the username)")
            if e.code == 429:
                wait = 20 * (attempt + 1)
                print(f"Rate limited, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue
            sys.exit(f"HTTP {e.code} for {url}")
    sys.exit("Too many rate-limit responses; try again later.")


def chesscom(args, out):
    user = args.username.lower()
    archives = json.load(fetch(f"{CHESSCOM}/player/{urllib.parse.quote(user)}/games/archives")).get("archives", [])
    if not archives:
        sys.exit("That chess.com account has no games.")
    n = 0
    for url in reversed(archives):                       # newest month first, one request at a time
        month = json.load(fetch(url))
        for g in month.get("games", []):
            if not g.get("pgn") or g.get("rules") != "chess":
                continue
            if args.rated and not g.get("rated"):
                continue
            tc = g.get("time_class")
            if args.speed and not (tc == args.speed or (args.speed == "classical" and tc == "daily")):
                continue
            who_white = g.get("white", {}).get("username", "").lower() == user
            who_black = g.get("black", {}).get("username", "").lower() == user
            if (args.color == "white" and not who_white) or (args.color == "black" and not who_black):
                continue
            out.write(g["pgn"].strip() + "\n\n")
            n += 1
            if n >= args.max:
                return n
        print(f"  {url.rsplit('/', 2)[-2]}/{url.rsplit('/', 1)[-1]}: {n} games so far", file=sys.stderr)
    return n


def lichess(args, out):
    q = {"max": args.max, "moves": "true", "tags": "true", "clocks": "false", "evals": "false", "opening": "false"}
    if args.rated:
        q["rated"] = "true"
    if args.speed:
        q["perfType"] = args.speed
    if args.color != "both":
        q["color"] = args.color
    resp = fetch(f"{LICHESS}/api/games/user/{urllib.parse.quote(args.username)}?{urllib.parse.urlencode(q)}", "application/x-chess-pgn")
    n = 0
    for raw in resp:
        line = raw.decode("utf-8", "replace")
        if line.startswith("[Event "):
            n += 1
            if n % 200 == 0:
                print(f"  {n} games...", file=sys.stderr)
        out.write(line)
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site", choices=["chesscom", "lichess"])
    ap.add_argument("username")
    ap.add_argument("-o", "--output", help="output file (default: <username>_<site>.pgn)")
    ap.add_argument("--max", type=int, default=5000, help="most games to download (default 5000)")
    ap.add_argument("--color", choices=["both", "white", "black"], default="both", help="only games played as this colour")
    ap.add_argument("--speed", choices=["bullet", "blitz", "rapid", "classical"], help="only this time control")
    ap.add_argument("--rated", action="store_true", help="rated games only")
    args = ap.parse_args()
    path = args.output or f"{args.username}_{args.site}.pgn"
    with open(path, "w", encoding="utf-8") as out:
        n = (chesscom if args.site == "chesscom" else lichess)(args, out)
    print(f"Saved {n} games to {path}")


if __name__ == "__main__":
    main()

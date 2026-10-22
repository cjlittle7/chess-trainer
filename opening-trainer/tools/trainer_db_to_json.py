"""Convert the Flask version's trainer.db into a backup file the web app can import.

    python trainer_db_to_json.py trainer.db opening-trainer-data.json
"""
import json
import sqlite3
import sys


def main(db_path, out_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    collections = []
    for r in conn.execute("SELECT id, name, color FROM repertoires ORDER BY id"):
        lines = [{"name": l["name"], "moves": l["moves"].split()}
                 for l in conn.execute("SELECT name, moves FROM lines WHERE repertoire_id = ? ORDER BY position, id", (r["id"],))]
        collections.append({"name": r["name"], "color": r["color"], "lines": lines})
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"app": "opening-trainer", "version": 1, "collections": collections}, f, indent=1)
    print(f"Wrote {sum(len(c['lines']) for c in collections)} lines in {len(collections)} collections to {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])

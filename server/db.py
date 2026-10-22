"""SQLite storage for posts and their market-impact measurements."""
import json
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "terminal.db"
_lock = threading.Lock()
_conn = None


def conn():
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                person TEXT NOT NULL,
                source TEXT NOT NULL,      -- truth | x | rss | gnews
                url TEXT,
                text TEXT,
                ts INTEGER NOT NULL,       -- unix seconds
                tickers TEXT DEFAULT '[]', -- JSON list
                categories TEXT DEFAULT '[]',
                matched TEXT DEFAULT '[]', -- keywords that matched
                alert INTEGER DEFAULT 0,
                impact TEXT,               -- JSON, filled in by impact worker
                impact_done INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS posts_ts ON posts(ts DESC);
            CREATE INDEX IF NOT EXISTS posts_person ON posts(person);
            """
        )
    return _conn


def _row(r):
    d = dict(r)
    for k in ("tickers", "categories", "matched"):
        d[k] = json.loads(d[k] or "[]")
    d["impact"] = json.loads(d["impact"]) if d["impact"] else None
    d["alert"] = bool(d["alert"])
    return d


def insert_post(p):
    """Insert if new. Returns True when the post was not seen before."""
    with _lock:
        cur = conn().execute(
            "INSERT OR IGNORE INTO posts (id, person, source, url, text, ts, tickers, categories, matched, alert)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (p["id"], p["person"], p["source"], p.get("url"), p.get("text"), int(p["ts"]),
             json.dumps(p.get("tickers", [])), json.dumps(p.get("categories", [])),
             json.dumps(p.get("matched", [])), int(bool(p.get("alert")))),
        )
        conn().commit()
        return cur.rowcount > 0


def recent_posts(limit=200, person=None, ticker=None, since=None, alerts_only=False):
    q, args = "SELECT * FROM posts WHERE 1=1", []
    if person:
        q += " AND person = ?"; args.append(person)
    if ticker:
        q += " AND tickers LIKE ?"; args.append(f'%"{ticker.upper()}"%')
    if since:
        q += " AND ts >= ?"; args.append(int(since))
    if alerts_only:
        q += " AND alert = 1"
    q += " ORDER BY ts DESC LIMIT ?"; args.append(limit)
    with _lock:
        return [_row(r) for r in conn().execute(q, args).fetchall()]


def get_post(pid):
    with _lock:
        r = conn().execute("SELECT * FROM posts WHERE id = ?", (pid,)).fetchone()
    return _row(r) if r else None


def pending_impact(min_ts, max_ts, limit=1000):
    with _lock:
        rows = conn().execute(
            "SELECT * FROM posts WHERE impact_done = 0 AND ts BETWEEN ? AND ? ORDER BY ts DESC LIMIT ?",
            (int(min_ts), int(max_ts), limit),
        ).fetchall()
    return [_row(r) for r in rows]


def save_impact(pid, impact, done):
    with _lock:
        conn().execute("UPDATE posts SET impact = ?, impact_done = ? WHERE id = ?",
                       (json.dumps(impact), int(done), pid))
        conn().commit()


def give_up_old(before_ts):
    """Posts older than the intraday-data window can never be measured."""
    with _lock:
        conn().execute("UPDATE posts SET impact_done = 1 WHERE impact_done = 0 AND ts < ?", (int(before_ts),))
        conn().commit()


def posts_with_impact(person=None):
    q, args = "SELECT * FROM posts WHERE impact IS NOT NULL", []
    if person:
        q += " AND person = ?"; args.append(person)
    with _lock:
        return [_row(r) for r in conn().execute(q, args).fetchall()]


def persons():
    with _lock:
        return [r[0] for r in conn().execute("SELECT DISTINCT person FROM posts ORDER BY person").fetchall()]

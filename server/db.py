"""SQLite storage for posts and their market-impact measurements."""
import hashlib
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(os.environ.get("MT_DB") or Path(__file__).resolve().parent.parent / "data" / "terminal.db")
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

            CREATE TABLE IF NOT EXISTS options_daily (   -- one row per ticker per trading day (latest scan wins)
                day TEXT, symbol TEXT, call_vol INTEGER, put_vol INTEGER, call_prem REAL, put_prem REAL,
                call_oi INTEGER, put_oi INTEGER, iv30 REAL, PRIMARY KEY (day, symbol)
            );
            CREATE TABLE IF NOT EXISTS options_unusual (
                day TEXT, contract TEXT, symbol TEXT, premium REAL, data TEXT, PRIMARY KEY (day, contract)
            );
            CREATE TABLE IF NOT EXISTS briefs (
                day TEXT PRIMARY KEY, ts INTEGER, data TEXT
            );
            CREATE TABLE IF NOT EXISTS settings (    -- user preferences: watchlist, alerts, theme, layout
                key TEXT PRIMARY KEY, value TEXT, updated INTEGER
            );
            CREATE TABLE IF NOT EXISTS alerts_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, title TEXT, body TEXT,
                url TEXT, ref TEXT, symbol TEXT
            );
            CREATE INDEX IF NOT EXISTS alerts_ts ON alerts_log(ts DESC);
            CREATE TABLE IF NOT EXISTS news (
                id TEXT PRIMARY KEY, source TEXT, title TEXT, url TEXT, ts INTEGER, tickers TEXT
            );
            CREATE INDEX IF NOT EXISTS news_ts ON news(ts DESC);
            CREATE TABLE IF NOT EXISTS congress_trades (
                id TEXT PRIMARY KEY, filed TEXT, traded TEXT, member TEXT, ticker TEXT, data TEXT
            );
            CREATE TABLE IF NOT EXISTS insider_trades (
                id TEXT PRIMARY KEY, filed TEXT, ticker TEXT, data TEXT
            );
            CREATE TABLE IF NOT EXISTS profiles (     -- sector / industry / asset type per ticker
                symbol TEXT PRIMARY KEY, name TEXT, type TEXT, sector TEXT, industry TEXT, updated INTEGER
            );
            CREATE TABLE IF NOT EXISTS prediction_snapshots (
                ts INTEGER, venue TEXT, event TEXT, label TEXT, yes REAL
            );
            CREATE INDEX IF NOT EXISTS pred_event ON prediction_snapshots(event, label, ts);
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


def recent_posts(limit=200, person=None, ticker=None, since=None, alerts_only=False, text=None):
    q, args = "SELECT * FROM posts WHERE 1=1", []
    if text:
        q += " AND (text LIKE ? OR person LIKE ?)"; args += [f"%{text}%", f"%{text}%"]
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


# ---------------------------------------------------------------- options flow

def save_options_day(day, sym, t):
    with _lock:
        conn().execute(
            "INSERT OR REPLACE INTO options_daily VALUES (?,?,?,?,?,?,?,?,?)",
            (day, sym, t["call_vol"], t["put_vol"], t["call_prem"], t["put_prem"], t["call_oi"], t["put_oi"], t.get("iv30")),
        )
        conn().commit()


def avg_options_volume(sym, before_day, n=20):
    """Average total contract volume over the previous n trading days we have recorded."""
    with _lock:
        rows = conn().execute(
            "SELECT call_vol + put_vol FROM options_daily WHERE symbol = ? AND day < ? ORDER BY day DESC LIMIT ?",
            (sym, before_day, n),
        ).fetchall()
    vals = [r[0] for r in rows if r[0]]
    return (sum(vals) / len(vals), len(vals)) if vals else (None, 0)


def save_unusual(day, items):
    with _lock:
        conn().executemany(
            "INSERT OR REPLACE INTO options_unusual VALUES (?,?,?,?,?)",
            [(day, i["contract"], i["symbol"], i["premium"], json.dumps(i)) for i in items],
        )
        conn().commit()


def unusual_for_day(day, limit=200):
    with _lock:
        rows = conn().execute(
            "SELECT data FROM options_unusual WHERE day = ? ORDER BY premium DESC LIMIT ?", (day, limit)
        ).fetchall()
    return [json.loads(r[0]) for r in rows]


def last_options_day(before=None):
    q, args = "SELECT MAX(day) FROM options_unusual", []
    if before:
        q += " WHERE day < ?"; args.append(before)
    with _lock:
        r = conn().execute(q, args).fetchone()
    return r[0] if r else None


# ---------------------------------------------------------------- briefs

def save_brief(day, brief):
    with _lock:
        conn().execute("INSERT OR REPLACE INTO briefs VALUES (?,?,?)", (day, int(brief["ts"]), json.dumps(brief)))
        conn().commit()


def get_brief(day=None):
    with _lock:
        if day:
            r = conn().execute("SELECT data FROM briefs WHERE day = ?", (day,)).fetchone()
        else:
            r = conn().execute("SELECT data FROM briefs ORDER BY day DESC LIMIT 1").fetchone()
    return json.loads(r[0]) if r else None


def brief_days(limit=30):
    with _lock:
        return [r[0] for r in conn().execute("SELECT day FROM briefs ORDER BY day DESC LIMIT ?", (limit,)).fetchall()]


# ---------------------------------------------------------------- settings

def get_settings():
    with _lock:
        rows = conn().execute("SELECT key, value FROM settings").fetchall()
    return {k: json.loads(v) for k, v in rows}


def put_settings(values):
    now = int(time.time())
    with _lock:
        conn().executemany("INSERT OR REPLACE INTO settings VALUES (?,?,?)",
                           [(k, json.dumps(v), now) for k, v in values.items()])
        conn().commit()


# ---------------------------------------------------------------- alert log

def log_alert(kind, title, body="", url=None, ref=None, symbol=None, ts=None):
    with _lock:
        conn().execute("INSERT INTO alerts_log (ts, kind, title, body, url, ref, symbol) VALUES (?,?,?,?,?,?,?)",
                       (int(ts or time.time()), kind, title, body, url, ref, symbol))
        conn().commit()


def alert_log(limit=300, kind=None):
    q, args = "SELECT * FROM alerts_log", []
    if kind:
        q += " WHERE kind = ?"; args.append(kind)
    q += " ORDER BY ts DESC LIMIT ?"; args.append(limit)
    with _lock:
        return [dict(r) for r in conn().execute(q, args).fetchall()]


# ---------------------------------------------------------------- archives (news, congress, insiders, predictions)

def archive_news(items):
    with _lock:
        cur = conn().executemany(
            "INSERT OR IGNORE INTO news VALUES (?,?,?,?,?,?)",
            [(hashlib.sha1((i["url"] or i["title"]).encode()).hexdigest()[:20], i["source"], i["title"], i["url"],
              int(i["ts"]), json.dumps(i.get("tickers", []))) for i in items])
        conn().commit()
        return cur.rowcount


def search_news(text=None, ticker=None, limit=200):
    q, args = "SELECT * FROM news WHERE 1=1", []
    if text:
        q += " AND title LIKE ?"; args.append(f"%{text}%")
    if ticker:
        q += " AND tickers LIKE ?"; args.append(f'%"{ticker.upper()}"%')
    q += " ORDER BY ts DESC LIMIT ?"; args.append(limit)
    with _lock:
        rows = conn().execute(q, args).fetchall()
    return [{**dict(r), "tickers": json.loads(r["tickers"] or "[]")} for r in rows]


def archive_congress(rows):
    with _lock:
        conn().executemany(
            "INSERT OR IGNORE INTO congress_trades VALUES (?,?,?,?,?,?)",
            [(r["id"], r["filed"], r["traded"], r["member"], r["ticker"], json.dumps(r)) for r in rows])
        conn().commit()


def search_congress(ticker=None, member=None, limit=1000):
    q, args = "SELECT data FROM congress_trades WHERE 1=1", []
    if ticker:
        q += " AND ticker = ?"; args.append(ticker.upper())
    if member:
        q += " AND member LIKE ?"; args.append(f"%{member}%")
    q += " ORDER BY filed DESC, traded DESC LIMIT ?"; args.append(limit)
    with _lock:
        return [json.loads(r[0]) for r in conn().execute(q, args).fetchall()]


def archive_insiders(rows):
    with _lock:
        conn().executemany(
            "INSERT OR IGNORE INTO insider_trades VALUES (?,?,?,?)",
            [(r.get("filing_url") or f"{r['ticker']}|{r['insider']}|{r['filed']}|{r['qty']}", r["filed"], r["ticker"],
              json.dumps(r)) for r in rows])
        conn().commit()


def search_insiders(ticker=None, limit=500):
    q, args = "SELECT data FROM insider_trades WHERE 1=1", []
    if ticker:
        q += " AND ticker = ?"; args.append(ticker.upper())
    q += " ORDER BY filed DESC LIMIT ?"; args.append(limit)
    with _lock:
        return [json.loads(r[0]) for r in conn().execute(q, args).fetchall()]


def snapshot_predictions(rows):
    now = int(time.time())
    with _lock:
        conn().executemany("INSERT INTO prediction_snapshots VALUES (?,?,?,?,?)",
                           [(now, r["venue"], r["event"], r["label"], r["yes"]) for r in rows])
        conn().commit()


def stats():
    tables = ["posts", "news", "alerts_log", "options_unusual", "options_daily", "congress_trades",
              "insider_trades", "prediction_snapshots", "briefs", "settings"]
    with _lock:
        out = {t: conn().execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    out["_size_mb"] = round(DB_PATH.stat().st_size / 1e6, 2) if DB_PATH.exists() else 0
    out["_path"] = str(DB_PATH)
    return out


# ---------------------------------------------------------------- ticker profiles

def get_profiles(symbols, max_age=30 * 86400):
    if not symbols:
        return {}
    marks = ",".join("?" * len(symbols))
    with _lock:
        rows = conn().execute(f"SELECT * FROM profiles WHERE symbol IN ({marks}) AND updated > ?",
                              (*symbols, int(time.time() - max_age))).fetchall()
    return {r["symbol"]: dict(r) for r in rows}


def save_profile(p):
    with _lock:
        conn().execute("INSERT OR REPLACE INTO profiles VALUES (?,?,?,?,?,?)",
                       (p["symbol"], p.get("name"), p.get("type"), p.get("sector"), p.get("industry"), int(time.time())))
        conn().commit()

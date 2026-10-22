"""Keyword-based tagging: maps post text to categories, tickers and an alert flag."""
import re


class Tagger:
    def __init__(self, cfg):
        self.rules = []
        for r in cfg.get("rules", []):
            pats = [_word_re(k) for k in r["keywords"]]
            self.rules.append((r, pats))
        self.companies = [(_word_re(name), t) for name, t in cfg.get("companies", {}).items()]
        self.alert_kw = [(k, _word_re(k)) for k in cfg.get("alert_keywords", [])]
        self.watchlist = set(s.upper() for s in cfg.get("watchlist", []))

    def tag(self, text):
        text = text or ""
        tickers, cats, matched = [], [], []
        alert = False

        def add(t):
            if t not in tickers:
                tickers.append(t)

        # $TSLA style cashtags
        for m in re.finditer(r"\$([A-Za-z]{1,5}(?:[.-][A-Za-z]{1,2})?)\b", text):
            add(m.group(1).upper())

        # Exchange tags like "(NASDAQ:SPCX)" or "NYSE: F" - take the ticker, then hide the tag from the rules
        for m in re.finditer(r"\b(?:NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX|OTC)\s?:\s?([A-Z]{1,5}(?:\.[A-Z])?)\b", text, re.I):
            add(m.group(1).upper())
        text = re.sub(r"\(?\b(?:NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX|OTC)\s?:\s?[A-Z.]{1,7}\)?", " ", text, flags=re.I)

        # Company names
        for pat, t in self.companies:
            if pat.search(text):
                add(t)
                matched.append(pat.pattern_name)

        # Watchlist tickers written plainly in caps (3+ letters to avoid noise like "A" or "IT")
        for t in self.watchlist:
            base = t.split("-")[0]
            if len(base) >= 3 and re.search(rf"(?<![A-Za-z$]){re.escape(base)}(?![A-Za-z])", text):
                add(t)

        direct = list(tickers)  # explicitly mentioned names alert if on the watchlist
        if any(t in self.watchlist for t in direct):
            alert = True

        for rule, pats in self.rules:
            hits = [p.pattern_name for p in pats if p.search(text)]
            if hits:
                cats.append(rule["name"])
                matched.extend(hits)
                for t in rule.get("tickers", []):
                    add(t)
                if rule.get("alert"):
                    alert = True

        for k, pat in self.alert_kw:
            if pat.search(text):
                matched.append(k)
                alert = True

        return {"tickers": tickers[:8], "categories": cats, "matched": sorted(set(matched)), "alert": alert}


class _Pat:
    """Compiled regex that remembers the keyword it came from."""
    def __init__(self, kw):
        self.pattern_name = kw
        self._re = re.compile(rf"(?<![A-Za-z0-9]){re.escape(kw)}(?![A-Za-z0-9])", re.I)

    def search(self, s):
        return self._re.search(s)

    @property
    def pattern(self):
        return self._re.pattern


def _word_re(kw):
    return _Pat(kw)

# IDF media monitor: collects IDF mentions from news sites + the IDF's own Telegram channels,
# and serves a dashboard.
# Run: python idf_monitor.py   then open http://localhost:8000
# One scan for static hosting (GitHub Actions): DATA_PASSWORD=... python idf_monitor.py --once  (needs: pip install cryptography)
# Self-check: python idf_monitor.py --selftest
import html, json, os, re, sys, threading, time, urllib.parse, urllib.request, webbrowser
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

NEWS_EVERY_MIN = 10
TELEGRAM_EVERY_MIN = 2
PORT = 8000
HERE = Path(__file__).parent
DB = HERE / "mentions.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"}

HE = ('צה"ל OR "דובר צה"ל" OR חיילי', "he", "IL", "IL:he")
EN = ('IDF OR "Israel Defense Forces" OR "Israeli military" OR "Israeli army"', "en", "US", "US:en")
FR = ('Tsahal OR "armée israélienne"', "fr", "FR", "FR:fr")
ES = ('"ejército israelí" OR "Ejército de Israel"', "es", "ES", "ES:es")
AR = ('"الجيش الإسرائيلي" OR "جيش الاحتلال" OR "الجيش الاسرائيلي" OR أدرعي', "ar", "AE", "AE:ar")

# Searched through Google News: (display name, domain, language, group)
SOURCES = [
    ("אתר צה\"ל", "idf.il", HE, "il"), ("וואלה", "walla.co.il", HE, "il"), ("ynet", "ynet.co.il", HE, "il"),
    ("N12", "mako.co.il", HE, "il"), ("חדשות 13", "13tv.co.il", HE, "il"), ("כאן", "kan.org.il", HE, "il"),
    ("C14", "c14.co.il", HE, "il"), ("ישראל היום", "israelhayom.co.il", HE, "il"),
    ("מעריב", "maariv.co.il", HE, "il"), ("הארץ", "haaretz.co.il", HE, "il"),
    ("מקור ראשון", "makorrishon.co.il", HE, "il"), ("ערוץ 7", "inn.co.il", HE, "il"),
    ("0404", "0404.co.il", HE, "il"), ("גלובס", "globes.co.il", HE, "il"), ("כלכליסט", "calcalist.co.il", HE, "il"),
    ("דה מרקר", "themarker.com", HE, "il"), ("חמ\"ל", "hamal.co.il", HE, "il"), ("גל\"צ", "glz.co.il", HE, "il"),
    ("103FM", "103fm.maariv.co.il", HE, "il"),
    ("JP", "jpost.com", EN, "world"), ("TOI", "timesofisrael.com", EN, "world"), ("i24", "i24news.tv/en", EN, "world"),
    ("CNN", "cnn.com", EN, "world"), ("The New York Times", "nytimes.com", EN, "world"),
    ("Fox News", "foxnews.com", EN, "world"), ("AP", "apnews.com", EN, "world"), ("Reuters", "reuters.com", EN, "world"),
    ("WSJ", "wsj.com", EN, "world"), ("BBC", "bbc.com", EN, "world"), ("The Guardian", "theguardian.com", EN, "world"),
    ("WP", "washingtonpost.com", EN, "world"), ("Al Arabiya English", "english.alarabiya.net", EN, "world"),
    ("Le Monde", "lemonde.fr", FR, "world"), ("El Mundo", "elmundo.es", ES, "world"),
    ("الجزيرة", "aljazeera.net", AR, "arab"), ("العربية", "www.alarabiya.net", AR, "arab"),
]
# The site's own RSS, for outlets Google News covers poorly. Only items whose title names the IDF are kept.
DIRECT_FEEDS = [
    ("WSJ", "https://feeds.a.dj.com/rss/RSSWorldNews.xml"),
    ("Fox News", "https://moxie.foxnews.com/google-publisher/world.xml"),
]
# The IDF's public Telegram channels: (display name, channel username)
TELEGRAM = [("טלגרם צה\"ל (עברית)", "idf_telegram"), ("Telegram IDF (English)", "idfofficial")]

# Google matches whole pages (sidebars too), so headlines that name the IDF are flagged as direct hits.
TITLE_HIT = re.compile(
    r'צה["״]?ל|חייל|לוחמ|רמטכ["״]ל|דובר צה|קצין|תא["״]ל|סא["״]ל|פיקוד|חטיבת|גדוד|'
    r'\bIDF\b|Israel Defense|Israeli (military|army|forces|troops|soldiers?|strikes?|airstrikes?)|'
    r'Tsahal|armée israélienne|ej[eé]rcito (israel[ií]|de Israel)|'
    r'الجيش الإسرائيلي|الجيش الاسرائيلي|جيش الاحتلال|قوات الاحتلال|أدرعي|أفيخاي|متحدث\w* (باسم )?الجيش|جندي|جنود', re.I)

lock = threading.Lock()
mentions = json.loads(DB.read_text("utf-8")) if DB.exists() else {}
status = {"last_poll": None, "last_telegram": None, "errors": [], "polling": False}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read()


def feed_url(domain, lang):
    q, hl, gl, ceid = lang
    # routine scans look 2 days back; a one-off NEWS_WINDOW=7d run backfills the week
    window = os.environ.get("NEWS_WINDOW", "2d")
    params = {"q": f"({q}) site:{domain} when:{window}", "hl": hl, "gl": gl, "ceid": ceid}
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)


def parse_rss(xml_bytes, source, strip_outlet=True):
    out = []
    for item in ET.fromstring(xml_bytes).iter("item"):
        title = html.unescape(item.findtext("title", "")).strip()
        # Google appends " - Outlet" to titles
        if strip_outlet and " - " in title:
            title = title.rsplit(" - ", 1)[0]
        try:
            ts = parsedate_to_datetime(item.findtext("pubDate", "")).timestamp()
        except (TypeError, ValueError):
            ts = time.time()
        out.append({"title": title, "link": item.findtext("link", "").strip(), "ts": ts, "source": source,
                    "kind": "news", "found": time.time(), "hit": bool(TITLE_HIT.search(title))})
    return out


def parse_telegram(page, source, channel):
    out = []
    for block in page.split('data-post="')[1:]:
        post = block.split('"', 1)[0]
        m = re.search(r'tgme_widget_message_text[^>]*>(.*?)</div>', block, re.S)
        t = re.search(r'<time datetime="([^"]+)"', block)
        if not (m and t and post.startswith(channel + "/")):
            continue  # skip posts with no text (photo/video only)
        text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", m.group(1)))).strip()
        out.append({"title": text, "link": "https://t.me/" + post, "ts": datetime.fromisoformat(t.group(1)).timestamp(),
                    "source": source, "kind": "telegram", "found": time.time(), "hit": True})
    return out


def store(items):
    with lock:
        for it in items:
            mentions.setdefault(it["link"], it)  # keep the first "found" time


KEEP_DAYS = 15      # headline hits + Telegram: "this week vs last week" in the trends tab needs 14
KEEP_WEAK_DAYS = 3  # body-only matches are noisy and ~4x as many; keep them short
MAX_ITEMS = 6000    # shortcut: hard cap on the published file size, move to SQLite if she needs long history


def prune(now=None):
    now = now or time.time()
    for k, m in list(mentions.items()):
        if now - m["ts"] > (KEEP_DAYS if m.get("hit") else KEEP_WEAK_DAYS) * 86400:
            del mentions[k]
    if len(mentions) > MAX_ITEMS:
        for k, _ in sorted(mentions.items(), key=lambda kv: kv[1]["ts"])[:-MAX_ITEMS]:
            del mentions[k]


def save():
    with lock:
        prune()
        DB.write_text(json.dumps(mentions, ensure_ascii=False), "utf-8")


def poll_telegram():
    errors = []
    for name, channel in TELEGRAM:
        try:
            store(parse_telegram(fetch(f"https://t.me/s/{channel}").decode("utf-8", "replace"), name, channel))
        except Exception as e:
            errors.append(f"{name}: {e}")
    save()
    status["last_telegram"] = time.time()
    return errors


def poll_news():
    status["polling"] = True
    errors = []
    for name, url in DIRECT_FEEDS:
        try:
            store([it for it in parse_rss(fetch(url), name, strip_outlet=False) if it["hit"]])
        except Exception as e:
            errors.append(f"{name} (RSS): {e}")
    for name, domain, lang, _ in SOURCES:
        for attempt in (1, 2):
            try:
                store(parse_rss(fetch(feed_url(domain, lang)), name))
                break
            except Exception as e:
                if attempt == 2:
                    errors.append(f"{name}: {e}")
                else:
                    time.sleep(30)  # Google News rate limit (429): wait and retry once
        time.sleep(3)  # be gentle with Google News
    save()
    status.update(last_poll=time.time(), errors=errors, polling=False)


def loop(fn, minutes):
    while True:
        try:
            fn()
        except Exception as e:  # never let one bad run kill the loop
            status["errors"] = [str(e)]
            status["polling"] = False
        time.sleep(minutes * 60)


def snapshot(live, refresh=None):
    """What the dashboard reads: served at /data.json locally, encrypted into data.enc for the hosted copy.
    `refresh` (hosted only, inside the encryption) lets the page start a scan from its refresh button."""
    with lock:
        return json.dumps({
            "items": sorted(mentions.values(), key=lambda m: -m["ts"]), "status": {**status, "live": live},
            "sources": [{"name": n, "group": g, "domain": d.split("/")[0]} for n, d, _, g in SOURCES],
            "telegram": [{"name": n, "channel": c} for n, c in TELEGRAM],
            "refresh": refresh,
        }, ensure_ascii=False).encode()


# ---- tone tagging with Claude (optional: runs only when ANTHROPIC_API_KEY is set) ----
TONES = ("supportive", "critical", "neutral")
TONE_BATCH = 60          # headlines per request
TONE_MAX_PER_RUN = 240   # cost cap per scan; a backlog is worked off over a few scans
TONE_MIN_BATCH = 10      # wait for this many new headlines...
TONE_MAX_WAIT = 3600     # ...or until the oldest untagged one is an hour old (keeps it to ~1 request/hour)
TONE_PROMPT = """You classify news headlines by how they portray the Israel Defense Forces (IDF), for the IDF Spokesperson's media monitoring.
For each numbered headline, return its tone toward the IDF:
- supportive: portrays the IDF favorably (achievements, successful operations, heroism, humanitarian help, praise).
- critical: portrays the IDF unfavorably (criticism, allegations, failures, investigations, harm to civilians attributed to the IDF, internal problems).
- neutral: factual reporting without a clear slant, or the IDF is only incidental to the story.
Judge the headline's framing, not your own view of the events. Headlines may be in Hebrew, English, Arabic, French or Spanish.
Return exactly one entry per headline, using its number."""
TONE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["items"], "properties": {
    "items": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["i", "tone"],
              "properties": {"i": {"type": "integer"}, "tone": {"type": "string", "enum": list(TONES)}}}}}}


def apply_tones(chunk, reply):
    for r in json.loads(reply)["items"]:
        if 0 <= r["i"] < len(chunk) and r["tone"] in TONES:
            chunk[r["i"]]["tone"] = r["tone"]


def tag_tones(now=None):
    """Tags untagged headline hits; returns how many got a tone. Never prints headlines (Actions logs are public)."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return 0
    now = now or time.time()
    with lock:
        todo = sorted((m for m in mentions.values() if m.get("hit") and m.get("kind") != "telegram" and "tone" not in m),
                      key=lambda m: -m["ts"])
    if not todo or (len(todo) < TONE_MIN_BATCH and now - min(m["found"] for m in todo) < TONE_MAX_WAIT):
        return 0
    import anthropic
    client = anthropic.Anthropic()
    model = os.environ.get("TONE_MODEL") or "claude-opus-5-5"
    done = 0
    todo = todo[:TONE_MAX_PER_RUN]
    for start in range(0, len(todo), TONE_BATCH):
        chunk = todo[start:start + TONE_BATCH]
        lines = "\n".join(f"{i}. [{m['source']}] {m['title']}" for i, m in enumerate(chunk))
        try:
            resp = client.beta.messages.create(
                model=model, max_tokens=8000, system=TONE_PROMPT,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": TONE_SCHEMA}},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",  # retry a policy decline on another model
                messages=[{"role": "user", "content": lines}])
        except anthropic.APIError as e:
            print(f"tone tagging stopped: {type(e).__name__}")
            break
        if resp.stop_reason != "end_turn":  # refusal / max_tokens: leave these untagged, try next scan
            print(f"tone batch skipped: {resp.stop_reason}")
            continue
        with lock:
            apply_tones(chunk, next(b.text for b in resp.content if b.type == "text"))
        done += sum("tone" in m for m in chunk)
    return done


# Hosted copy: data.enc = AES-256-GCM, key = PBKDF2-SHA256(password, salt). The page decrypts it with WebCrypto.
ENC = HERE / "data.enc"
KDF_ITERS = 300_000


def derive_key(password, salt):
    import hashlib
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, KDF_ITERS, dklen=32)


def encrypt(plain, password, salt):
    import base64, os
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    ct = AESGCM(derive_key(password, salt)).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode()
    return json.dumps({"v": 1, "iters": KDF_ITERS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}).encode()


def decrypt(blob, password):
    import base64
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = {k: base64.b64decode(v) if k in ("salt", "iv", "ct") else v for k, v in json.loads(blob).items()}
    return AESGCM(derive_key(password, d["salt"])).decrypt(d["iv"], d["ct"], None), d["salt"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/refresh"):
            if not status["polling"]:
                threading.Thread(target=lambda: (poll_telegram(), poll_news()), daemon=True).start()
            body, ctype = b'{"ok":true}', "application/json"
        elif self.path.startswith(("/api", "/data.json")):
            body, ctype = snapshot(live=True), "application/json"
        else:
            body, ctype = (HERE / "index.html").read_bytes(), "text/html"
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def selftest():
    sample = b"""<rss><channel><item><title>Soldiers hurt in Gaza - Reuters</title>
    <link>https://x/1</link><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>"""
    [it] = parse_rss(sample, "Reuters")
    assert it["title"] == "Soldiers hurt in Gaza" and it["link"] == "https://x/1" and it["ts"] > 0
    assert "site%3Aynet.co.il" in feed_url("ynet.co.il", HE)
    assert TITLE_HIT.search('צה"ל תקף') and TITLE_HIT.search("IDF says") and not TITLE_HIT.search("Trump pardons turkeys")
    tg = ('<div data-post="idf_telegram/55"><div class="tgme_widget_message_text js-message_text">'
          'שורה&quot;1<br/><b>שורה 2</b></div><time datetime="2026-11-24T10:00:00+00:00"></time></div>'
          '<div data-post="idf_telegram/56"><time datetime="2026-11-24T11:00:00+00:00"></time></div>')
    [t] = parse_telegram(tg, "TG", "idf_telegram")
    assert t["title"] == 'שורה"1\nשורה 2' and t["link"] == "https://t.me/idf_telegram/55" and t["kind"] == "telegram"
    saved_state = dict(mentions)
    mentions.clear()
    day = 86400
    mentions.update({"hit7": {"ts": 1000 * day - 7 * day, "hit": True}, "hit9": {"ts": 1000 * day - (KEEP_DAYS + 1) * day, "hit": True},
                     "weak2": {"ts": 1000 * day - 2 * day, "hit": False}, "weak4": {"ts": 1000 * day - 4 * day, "hit": False}})
    prune(now=1000 * day)
    assert sorted(mentions) == ["hit7", "weak2"], sorted(mentions)
    mentions.clear()
    mentions.update(saved_state)
    chunk = [{"title": "a"}, {"title": "b"}]
    apply_tones(chunk, '{"items": [{"i": 0, "tone": "critical"}, {"i": 5, "tone": "neutral"}, {"i": 1, "tone": "bogus"}]}')
    assert chunk == [{"title": "a", "tone": "critical"}, {"title": "b"}], chunk
    blob = encrypt("שלום".encode(), "pw", b"s" * 16)
    assert decrypt(blob, "pw") == ("שלום".encode(), b"s" * 16) and "שלום".encode() not in blob
    try:
        decrypt(blob, "wrong")
        raise AssertionError("wrong password decrypted")
    except Exception as e:
        assert not isinstance(e, AssertionError)
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit()
    if "--once" in sys.argv:  # used by the GitHub Actions schedule: one scan, then write the encrypted data file
        import os
        password = os.environ.get("DATA_PASSWORD", "")
        if not password:
            sys.exit("DATA_PASSWORD is not set; refusing to publish unencrypted data")
        salt = os.urandom(16)
        if ENC.exists():
            try:
                plain, salt = decrypt(ENC.read_bytes(), password)
                mentions.clear()
                mentions.update({m["link"]: m for m in json.loads(plain)["items"]})
            except Exception:  # password changed: start a fresh history (old data is unreadable anyway)
                print("could not decrypt previous data, starting fresh")
                salt = os.urandom(16)
        status["errors"] = poll_telegram()
        tg_errors = status["errors"]
        poll_news()
        status["errors"] = tg_errors + status["errors"]
        print(f"tones added: {tag_tones()}")
        token, repo = os.environ.get("DISPATCH_TOKEN", ""), os.environ.get("GITHUB_REPOSITORY", "")
        refresh = {"token": token, "repo": repo, "workflow": "poll.yml"} if token and repo else None
        ENC.write_bytes(encrypt(snapshot(live=False, refresh=refresh), password, salt))
        DB.unlink(missing_ok=True)  # never leave plaintext state where it could be committed
        print(f"{len(mentions)} items, {len(status['errors'])} errors")
        sys.exit()
    threading.Thread(target=loop, args=(poll_telegram, TELEGRAM_EVERY_MIN), daemon=True).start()
    threading.Thread(target=loop, args=(poll_news, NEWS_EVERY_MIN), daemon=True).start()
    print(f"Dashboard: http://localhost:{PORT}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        webbrowser.open(f"http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

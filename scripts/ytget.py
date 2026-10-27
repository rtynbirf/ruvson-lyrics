#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YouTube transcript extractor: search / captions / channel listing."""
import sys, re, json, gzip, urllib.request, urllib.parse

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
HDRS = {
    "User-Agent": UA,
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def http(url, data=None, headers=None, timeout=25):
    h = dict(HDRS)
    if headers:
        h.update(headers)
    if data is not None and isinstance(data, (dict, list)):
        data = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    elif data is not None and isinstance(data, str):
        data = data.encode()
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "replace")

def balanced_json(s, start):
    """s[start] must be '{'. Return substring of the balanced JSON object."""
    depth, i, instr, esc = 0, start, False, False
    while i < len(s):
        c = s[i]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start:i+1]
        i += 1
    return None

def get_player_response(video_id):
    html = http("https://www.youtube.com/watch?v=%s&hl=ru&bpctr=9999999999&has_verified=1" % video_id)
    m = re.search(r"ytInitialPlayerResponse\s*=\s*", html)
    if not m:
        return None, html
    js = balanced_json(html, m.end())
    return json.loads(js), html

def get_api_key(html):
    m = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
    return m.group(1) if m else None

def player_via_api(video_id, key):
    body = {"context": {"client": {"clientName": "ANDROID", "clientVersion": "20.10.38",
                                   "androidSdkVersion": 30, "hl": "ru"}},
            "videoId": video_id}
    url = "https://www.youtube.com/youtubei/v1/player"
    if key:
        url += "?key=" + key
    try:
        return http(url, data=body)
    except Exception as e:
        print("api-player error:", e, file=sys.stderr)
        return None

def list_caption_tracks(pr):
    caps = pr.get("captions", {}).get("playerCaptionsTracklistRenderer", {})
    return caps.get("captionTracks", [])

def fetch_json3(base_url):
    url = base_url + "&fmt=json3"
    try:
        return json.loads(http(url, headers={"Referer": "https://www.youtube.com/"}))
    except Exception as e:
        print("json3 error:", e, file=sys.stderr)
        return None

MARKERS = re.compile(r"^[\[\(♪♫]*\s*(музыка|music|аплодисменты|applause|смеётся|смех|инструментал|instrumental|аудитор?s?кие аплодисменты)\s*[\]\)♪♫]*$", re.I)

def clean_events(j3):
    """json3 -> list of (start, text) chunks; drop music/service markers."""
    out = []
    if not j3:
        return out
    for ev in j3.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        t0 = ev.get("tStartMs", 0) / 1000.0
        txt = "".join(s.get("utf8", "") for s in segs)
        txt = txt.replace("\n", " ").strip()
        if not txt:
            continue
        if MARKERS.match(txt) or txt.strip("♪♫ ") == "":
            continue
        out.append((t0, txt))
    return out

def lines_from_words(words, max_len=70, gap=0.9):
    """Group word-level chunks into lyric lines by length/time-gap."""
    lines, cur, last_t = [], [], None
    for t, w in words:
        if cur and ((last_t is not None and t - last_t > gap) or
                    (sum(len(x) for x in cur) + len(w) + 1 > max_len)):
            lines.append(" ".join(cur).strip())
            cur = []
        cur.append(w)
        last_t = t + 0.01
    if cur:
        lines.append(" ".join(cur).strip())
    merged = []
    for ln in lines:
        if merged and len(ln) < 18 and len(merged[-1]) + len(ln) < max_len + 12:
            merged[-1] += " " + ln
        else:
            merged.append(ln)
    return merged

def get_transcript(video_id):
    pr, html = get_player_response(video_id)
    key = get_api_key(html) if html else None
    tracks = list_caption_tracks(pr) if pr else []
    if not tracks:
        pr2 = player_via_api(video_id, key)
        if pr2 and isinstance(pr2, str):
            try:
                pr2 = json.loads(pr2)
            except Exception:
                pr2 = None
        if pr2:
            tracks = list_caption_tracks(pr2)
            if not (pr or {}).get("videoDetails") and pr2.get("videoDetails"):
                pr = pr2
    if not tracks:
        return None, (pr or {}), "no-caption-tracks"
    def score(t):
        lang = (t.get("languageCode") or "").lower()
        sc = 0
        if lang.startswith("ru"): sc += 10
        if t.get("kind") == "asr": sc += 2
        return sc
    tracks.sort(key=score, reverse=True)
    tr = tracks[0]
    base = tr.get("baseUrl")
    if not base:
        return None, pr, "no-baseurl"
    j3 = fetch_json3(base)
    words = clean_events(j3)
    if not words:
        return None, pr, "empty-transcript"
    evs = j3.get("events", [])
    manual = all(("dDurationMs" in e) for e in evs[:5] if e.get("segs"))
    lines = [w for _, w in words] if manual else lines_from_words(words)
    meta = {
        "title": pr.get("videoDetails", {}).get("title", ""),
        "author": pr.get("videoDetails", {}).get("author", ""),
        "length": pr.get("videoDetails", {}).get("lengthSeconds", ""),
        "lang": tr.get("languageCode", ""),
        "kind": tr.get("kind", ""),
    }
    return lines, meta, "ok"

def search_yt(query, limit=12):
    q = urllib.parse.quote(query)
    html = http("https://www.youtube.com/results?search_query=%s&hl=ru" % q)
    m = re.search(r"ytInitialData\s*=\s*", html)
    if not m:
        return []
    data = json.loads(balanced_json(html, m.end()))
    res = []
    def walk(o):
        if isinstance(o, dict):
            if "videoRenderer" in o:
                vr = o["videoRenderer"]
                vid = vr.get("videoId", "")
                title = "".join(r.get("text", "") for r in
                                vr.get("title", {}).get("runs", []))
                ch = "".join(r.get("text", "") for r in
                             vr.get("ownerText", {}).get("runs", []))
                dur = vr.get("lengthText", {}).get("simpleText", "")
                res.append({"id": vid, "title": title, "channel": ch, "dur": dur})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    return res[:limit]

def cmd_search(query):
    for r in search_yt(query):
        print("%s | %s | %s | %s" % (r["id"], r["dur"], r["channel"], r["title"]))

def cmd_captions(video_id):
    lines, meta, status = get_transcript(video_id)
    if status != "ok":
        print("STATUS: %s" % status)
        if isinstance(meta, dict):
            print("META:", json.dumps(meta, ensure_ascii=False))
        sys.exit(2)
    print("META:", json.dumps(meta, ensure_ascii=False))
    print("---")
    for ln in lines:
        print(ln)

def cmd_channel():
    html = http("https://www.youtube.com/@ruvson_music/videos?hl=ru")
    m = re.search(r"ytInitialData\s*=\s*", html)
    data = json.loads(balanced_json(html, m.end()))
    vids = []
    def walk(o):
        if isinstance(o, dict):
            if "richItemRenderer" in o:
                vr = o["richItemRenderer"].get("content", {}).get("videoRenderer")
                if vr:
                    vid = vr.get("videoId", "")
                    title = "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", []))
                    dur = vr.get("lengthText", {}).get("simpleText", "")
                    if vid:
                        vids.append({"id": vid, "title": title, "dur": dur})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    for v in vids:
        print("%s | %s | %s" % (v["id"], v["dur"], v["title"]))

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "search":
        cmd_search(" ".join(sys.argv[2:]))
    elif cmd == "captions":
        cmd_captions(sys.argv[2])
    elif cmd == "channel":
        cmd_channel()

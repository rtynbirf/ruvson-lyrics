#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Resolve 65 RUVSON tracks to videos and extract cleaned transcripts."""
import os, re, sys, json, time, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeget import api_get, http, search, get_streams, parse_ttml, lines_from_words, fmt_dur

OUT = "/home/z/my-project/lyrics_work"
MAPF = "/home/z/my-project/scripts/resolve_map.json"
os.makedirs(OUT, exist_ok=True)

def sec(mmss):
    p = mmss.split(":")
    return int(p[0]) * 60 + int(p[1])

TRACKS = [
    (2,  "Цени моменты",              "2:31", None),
    (3,  "Не тех мы ценим",           "3:02", None),
    (4,  "Ангел без крыльев",         "4:06", None),
    (5,  "Не теряй шанс",             "2:30", "WMU46n--Z-s"),
    (6,  "Не жди завтра",             "3:16", "d2b72nYLiT8"),
    (7,  "Цени моменты (Remix)",      "2:54", "EFaMUciH3Do"),
    (8,  "Куда летят года",           "3:02", None),
    (9,  "Два голоса",                "2:57", "ZXimyVwjmts"),
    (10, "Цени время",                "4:27", "pP3Kk2_FHbE"),
    (11, "Там где ты",                "3:02", "vUb40twffCI"),
    (12, "Свет в темноте",            "3:07", "KFnJwNv008s"),
    (13, "Где настоящее",             "4:25", "shs0TiOwx-M"),
    (14, "Время как вода",            "2:28", None),
    (15, "Бой с собой",               "2:32", None),
    (16, "Крик в тишине",             "3:42", None),
    (17, "А что если да",             "2:58", "VfnGUIhaK2Y"),
    (18, "Когда теряем",              "3:12", None),
    (19, "Суть проста",               "3:21", None),
    (20, "Когда погаснут огни",       "3:06", None),
    (21, "Вера остаётся",             "2:55", None),
    (22, "Всё начинается с тебя",     "3:40", None),
    (23, "Тень ушедших",              "3:51", "lkXLeITEtGA"),
    (24, "Я сам себе враг",           "3:22", "z3RcsfHajP8"),
    (25, "Не спеши осуждать",         "3:44", "pervLR9m-vk"),
    (26, "Крик в тишине",             "2:49", None),
    (27, "Я сам себе судья",          "2:48", "1BZs_wUPn1s"),
    (28, "Тишина спасает",            "3:40", None),
    (29, "Смысл жизни прост",         "2:44", None),
    (30, "Нас учат потери",           "4:13", "pv3GAlLG9Lk"),
    (31, "Не играй в любовь",         "3:44", None),
    (32, "Просто люби",               "3:54", "9ys_TVEtda8"),
    (33, "Остаться человеком",        "3:20", None),
    (34, "Ты одна дала",              "3:10", None),
    (35, "Жизнь не прощает",          "3:12", None),
    (36, "Когда ты удобен",           "4:25", "X_-M_cjCFVg"),
    (37, "Не играй в любовь (Remix)", "3:53", "CO_BTO585O8"),
    (38, "То о чём молчим",           "2:44", None),
    (39, "Оставайся молодым",         "4:16", None),
    (40, "Пленники прошлого",         "3:11", None),
    (41, "Живи сейчас",               "4:26", "fJwb931iJVg"),
    (42, "Это не секрет",             "3:01", "4j1GG_X7zHw"),
    (43, "В чём смысл",               "4:40", "n5IFJ-g1Rtc"),
    (44, "Гордость нас убивает",      "3:11", None),
    (45, "Меня не сломать",           "4:20", "TkmSZp1dfBE"),
    (46, "Дорога мой учитель",        "2:40", None),
    (47, "Время всё расставит",       "3:10", None),
    (48, "Вне зоны доступа",          "3:27", "eA-fyeSkavI"),
    (49, "О чём мечтаешь ты",         "5:20", "_gNbMCINv1Y"),
    (50, "Действуй сейчас",           "2:33", "LCADfnI8F-s"),
    (51, "Ты главный игрок",          "4:51", None),
    (52, "Люди в масках",             "2:37", None),
    (53, "Живи как умеешь",           "3:55", "Y7Wy_JBkz7A"),
    (54, "Одиночество среди людей",   "4:04", None),
    (55, "Разгадка в небесах",        "3:28", None),
    (56, "А время капает",            "2:52", None),
    (57, "Страх не слабость",         "4:17", None),
    (58, "Твоё плавание не вечно",    "3:58", "V-IaCbDUKao"),
    (59, "Не угасай",                 "2:25", None),
    (60, "Неудача — не конец",        "3:31", None),
    (61, "Компас на дом",             "3:23", None),
    (62, "Остаться человеком (Remix)","2:57", None),
    (63, "Код перемен",               "3:09", "eOMrrezWEZM"),
    (64, "Когда теряем (feat OutShadow)",      "3:51", None),
    (65, "Не тех мы ценим (feat OutShadow)",   "3:19", None),
]

INLINE_JUNK = re.compile(r"\[(музыка|music|аплодисменты|applause|смех|laughter|инструментал)\]", re.I)
LEAD_JUNK = re.compile(r"^(>>|>>>|♪|\[музыка\]|\[Music\]|\([музыка]\))+\s*", re.I)

def clean_text(t):
    t = INLINE_JUNK.sub(" ", t)
    t = t.replace(">>", " ").replace(">>>", " ")
    t = t.replace("♪", " ").replace("♫", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t

def resolve(track):
    n, title, dur_s, fixed = track
    target = sec(dur_s)
    if fixed:
        return {"id": fixed, "how": "fixed"}
    attempts = [
        "RUVSON %s" % title,
        "RUVSON %s OutShadow" % title,
        title,
    ]
    for q in attempts:
        try:
            res = search(q)
        except Exception as e:
            print("search fail %r: %s" % (q, e), file=sys.stderr)
            continue
        for tol in (4, 8, 14):
            cands = [r for r in res
                     if "ruvson" in (r.get("channel") or "").lower()
                     and r.get("dur") and abs(r["dur"] - target) <= tol]
            if cands:
                c = cands[0]
                return {"id": c["id"], "how": "search(%s,±%d)" % (q, tol),
                        "found_title": c["title"], "found_dur": c["dur"]}
        time.sleep(0.3)
    return None

def extract_transcript(vid):
    """Return (meta, lines, status)."""
    data, inst = get_streams(vid)
    if "error" in data:
        return None, None, "streams-error: %s" % data["error"]
    meta = {"title": data.get("title", ""), "uploader": data.get("uploader", ""),
            "duration": data.get("duration", 0)}
    subs = data.get("subtitles", []) or []
    ru = [s for s in subs if (s.get("code") or "").lower().startswith("ru")]
    pick = None
    for s in ru:
        if s.get("autoGenerated"):
            pick = s
    if pick is None and ru:
        pick = ru[0]
    if pick is None:
        return meta, None, "no-ru-subtitles"
    url = pick["url"]
    direct = re.sub(r"^https?://[^/]+/api/timedtext", "https://www.youtube.com/api/timedtext", url)
    if direct == url:
        direct = url
    xml = None
    for u in (direct, url):
        for i in range(3):
            try:
                cand = http(u, timeout=20)
                if cand and not cand.lstrip().startswith("<html"):
                    xml = cand
                    break
            except Exception:
                pass
            time.sleep(0.8)
        if xml:
            break
    if not xml:
        return meta, None, "ttml-fetch-failed"
    if xml.lstrip().startswith("{"):
        try:
            j3 = json.loads(xml)
            words = []
            for ev in j3.get("events", []):
                segs = ev.get("segs")
                if not segs:
                    continue
                t0 = ev.get("tStartMs", 0) / 1000.0
                txt = "".join(s.get("utf8", "") for s in segs)
                txt = clean_text(txt)
                if txt:
                    words.append((t0, txt))
            lines = lines_from_words(words)
            return meta, lines, "ok-json3"
        except Exception:
            pass
    segs = parse_ttml(xml)
    words = [(t, clean_text(w)) for t, w in segs]
    words = [(t, w) for t, w in words if w]
    if not words:
        return meta, None, "empty-after-clean"
    lines = lines_from_words(words)
    return meta, lines, "ok"

def slug(s):
    s = re.sub(r"[^\w\s-]", "", s, flags=re.U)
    return re.sub(r"\s+", "_", s.strip())[:40]

def main():
    amap = {}
    if os.path.exists(MAPF):
        amap = json.load(open(MAPF, encoding="utf-8"))
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    for tr in TRACKS:
        n, title, dur_s, _ = tr
        if only and str(n) not in only:
            continue
        key = str(n)
        outf = os.path.join(OUT, "%02d_%s.txt" % (n, slug(title)))
        if os.path.exists(outf):
            print("%02d %s -> exists" % (n, title))
            continue
        r = amap.get(key) or resolve(tr)
        if not r:
            print("%02d %s -> UNRESOLVED" % (n, title))
            amap[key] = {"id": None}
            json.dump(amap, open(MAPF, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            continue
        amap[key] = r
        vid = r["id"]
        meta, lines, status = extract_transcript(vid)
        amap[key]["status"] = status
        if meta:
            amap[key]["video_title"] = meta.get("title")
            amap[key]["video_dur"] = meta.get("duration")
        if lines:
            with open(outf, "w", encoding="utf-8") as f:
                f.write("META: %s\n" % json.dumps(
                    {"n": n, "track": title, "list_dur": dur_s,
                     "video": vid, "title": meta.get("title"),
                     "uploader": meta.get("uploader"),
                     "dur": meta.get("duration"), "status": status},
                    ensure_ascii=False))
                f.write("\n".join(lines) + "\n")
        print("%02d %s -> %s [%s] %s | %s" % (n, title, vid, status,
              fmt_dur((meta or {}).get("duration")), (meta or {}).get("title", "")[:50]))
        json.dump(amap, open(MAPF, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        time.sleep(0.4)
    print("DONE")

if __name__ == "__main__":
    main()

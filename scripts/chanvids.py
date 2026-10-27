#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parse channel videos page: id, title, duration + continuation browse."""
import re, json, sys, gzip, urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

def http(url, data=None, headers=None, timeout=25):
    h = {"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"}
    if headers:
        h.update(headers)
    if data is not None:
        data = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "replace")

def balanced(s, start):
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

html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r"var ytInitialData\s*=\s*", html)
data = json.loads(balanced(html, m.end()))

vids = {}

def find_lockups(o):
    if isinstance(o, dict):
        if "lockupViewModel" in o:
            lv = o["lockupViewModel"]
            vid = None
            # videoId from contentImage thumbnail
            try:
                src = lv["contentImage"]["thumbnailViewModel"]["image"]["sources"][0]["url"]
                mm = re.search(r"/vi/([^/]+)/", src)
                if mm: vid = mm.group(1)
            except Exception:
                pass
            if not vid:
                def hunt_id(x):
                    if isinstance(x, dict):
                        if "watchEndpoint" in x and x["watchEndpoint"].get("videoId"):
                            return x["watchEndpoint"]["videoId"]
                        for v in x.values():
                            r = hunt_id(v)
                            if r: return r
                    elif isinstance(x, list):
                        for v in x:
                            r = hunt_id(v)
                            if r: return r
                vid = hunt_id(lv)
            title = None
            try:
                title = lv["metadata"]["lockupMetadataViewModel"]["title"]["content"]
            except Exception:
                pass
            dur = None
            def hunt_dur(x):
                if isinstance(x, dict):
                    for b in x.get("thumbnails", []):
                        t = b.get("text")
                        if isinstance(t, str) and re.fullmatch(r"\d+:\d\d(:\d\d)?", t):
                            return t
                    for v in x.values():
                        r = hunt_dur(v)
                        if r: return r
                elif isinstance(x, list):
                    for v in x:
                        r = hunt_dur(v)
                        if r: return r
            dur = hunt_dur(lv)
            if vid:
                vids[vid] = {"id": vid, "title": title or "", "dur": dur or ""}
        for v in o.values():
            find_lockups(v)
    elif isinstance(o, list):
        for v in o:
            find_lockups(v)

find_lockups(data)

# continuation token + api key
cont = None
def hunt_cont(x):
    global cont
    if isinstance(x, dict):
        if "continuationCommand" in x:
            cont = x["continuationCommand"].get("token")
        for v in x.values():
            hunt_cont(v)
    elif isinstance(x, list):
        for v in x:
            hunt_cont(v)
hunt_cont(data)

keym = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
key = keym.group(1) if keym else None
verm = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html)
cver = verm.group(1) if verm else "2.20261026.01.00"

for v in vids.values():
    print("%s | %s | %s" % (v["id"], v["dur"], v["title"]))

print("COUNT:", len(vids), "CONT:", bool(cont), "KEY:", bool(key), file=sys.stderr)

# fetch remaining pages
page = 0
while cont and page < 5:
    page += 1
    body = {
        "context": {"client": {"clientName": "WEB", "clientVersion": cver, "hl": "ru"}},
        "continuation": cont,
    }
    try:
        resp = json.loads(http("https://www.youtube.com/youtubei/v1/browse?key=%s" % key, data=body))
    except Exception as e:
        print("browse fail:", e, file=sys.stderr)
        break
    cont = None
    hunt_cont(resp)
    before = len(vids)
    find_lockups(resp)
    print("PAGE %d: +%d" % (page, len(vids) - before), file=sys.stderr)
    if len(vids) == before:
        break

print("TOTAL:", len(vids), file=sys.stderr)
for v in vids.values():
    print("%s | %s | %s" % (v["id"], v["dur"], v["title"]))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Добыть субтитры №1 «Начать сначала» (ahmGGM-P0CA) в lyrics_work/."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_corpus import extract_transcript, slug

OUT = "/home/z/my-project/lyrics_work"
vid = "ahmGGM-P0CA"
meta, lines, status = extract_transcript(vid)
print("STATUS:", status)
print("META:", json.dumps(meta, ensure_ascii=False))
if lines:
    outf = os.path.join(OUT, "01_%s.txt" % slug("Начать сначала"))
    with open(outf, "w", encoding="utf-8") as f:
        f.write("META: %s\n" % json.dumps(
            {"n": 1, "track": "Начать сначала", "list_dur": "2:41",
             "video": vid, "title": meta.get("title"),
             "uploader": meta.get("uploader"),
             "dur": meta.get("duration"), "status": status},
            ensure_ascii=False))
        f.write("\n".join(lines) + "\n")
    print("SAVED:", outf, "lines:", len(lines))
    for ln in lines:
        print(ln)
else:
    print("NO LINES")

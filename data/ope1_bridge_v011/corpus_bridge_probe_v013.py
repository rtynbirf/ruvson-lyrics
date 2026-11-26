#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""corpus_bridge_probe_v013 — исполняемый probe-стаб моста RUVSON→OPE-1.

Честно: НЕ устанавливает направление (это работа корпусной верификации по И3),
а проверяет целость якорей пакета по корпусу lrc и возвращает протокол.
Вызов: python3 corpus_bridge_probe_v013.py <package.json> [корень_лирики]
"""
import json, re, sys, glob, os

def norm(s):
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^0-9a-zа-я\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def load_songs(lrc_dir):
    songs = {}
    for p in sorted(glob.glob(os.path.join(lrc_dir, "*.lrc"))):
        m = re.match(r"(\d{2,3})_", os.path.basename(p))
        if not m:
            continue
        n = int(m.group(1))
        lines = []
        for ln in open(p, encoding="utf-8"):
            s = re.sub(r"^\[[^\]]*\]\s*", "", ln).strip()
            if s and not s.startswith("<"):
                lines.append(s)
        songs[n] = lines
    return songs

def main():
    pkg = json.load(open(sys.argv[1], encoding="utf-8"))
    lrc_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lyrics")
    songs = load_songs(lrc_dir)
    prov = pkg.get("provenance", {})
    obs = prov.get("observation_ids", [])
    ok = 0
    absence_ok = 0
    for o in obs:
        m = re.match(r"obs:(\d{1,3}):(.+)$", o)
        if m:
            song, q = int(m.group(1)), m.group(2)
            src = songs.get(song)
            if src is not None and any(norm(q) in norm(ln) for ln in src):
                ok += 1
            continue
        m = re.match(r"obs:absence:(.+)$", o)
        if m:
            q = m.group(1)
            if not any(norm(q) in norm(ln) for lines in songs.values() for ln in lines):
                absence_ok += 1
    print(json.dumps({
        "probe": "corpus_bridge_probe_v013",
        "package": pkg.get("relation", {}).get("candidate_id"),
        "anchors_total": len(obs),
        "anchors_resolved": ok,
        "absences_verified": absence_ok,
        "direction": "UNDETERMINED (И3: внесение без корпусной верификации запрещено)",
        "mechanical_novelty_claim": False
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()

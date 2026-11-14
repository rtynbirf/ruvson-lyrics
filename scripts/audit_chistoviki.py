#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Аудит чистовиков: сверка всех слоёв текстов RUVSON.
Слои:
  A) download/*_ЧИСТОВИК.txt          — источник правды (человек)
  B) data/lyrics/*.lrc                — LRC-реестр (текст из ЧИСТОВИКА)
  C) karaoke/lrc/nNN.lrc              — караоке-метки (текст)
  D) karaoke/songs.js                 — караоке-приложение (текст)
  E) prototip/minus/nNN.lrc           — прототип (текст)
  F) site/track-NN.html               — страницы сайта
  G) registry.json                    — пломбы sha256
"""
import hashlib, json, re, glob, os, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
issues = []

def norm_line(s):
    return re.sub(r"\s+", " ", s.strip())

def read_txt(p):
    return Path(p).read_text(encoding="utf-8")

def chistovik_body(p):
    """Текст чистовика без шапки: строки без №/ссылки/Куплет:/Припев:."""
    lines = read_txt(p).splitlines()
    body, in_header = [], True
    for ln in lines:
        s = ln.strip()
        if in_header:
            if s.startswith("№") or s.startswith("https://") or s == "" :
                continue
            in_header = False
        if s and not re.match(r"^(Куплет|Припев|Бридж|Интро|Аутро|Финал|Кода|Проигрыш|Куплет \d|Припев ×?2|Проигрыш|Вступление|Концовка|Аутро|Скит)\b.*:?\s*$", s) and not (s.endswith(":") and len(s) < 25):
            body.append(norm_line(s))
    return body

TS = re.compile(r"^\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*")

def lrc_text_lines(p):
    """Все текстовые строки LRC (без метаданных и label; тайминги срезаются)."""
    out = []
    for ln in read_txt(p).splitlines():
        s = TS.sub("", ln.strip())
        if not s or s.startswith("["):
            continue
        out.append(norm_line(s))
    return out

def lrc_sections(p):
    """[(label|None, [lines])] из LRC."""
    blocks, label, lines = [], None, []
    for ln in read_txt(p).splitlines():
        s = ln.strip()
        if s.startswith("[label:") and s.endswith("]"):
            if label is not None or lines:
                blocks.append((label, lines))
            label, lines = s[7:-1], []
            continue
        if s.startswith("[") or not s:
            continue
        lines.append(norm_line(s))
    if label is not None or lines:
        blocks.append((label, lines))
    return blocks

def parse_songs_js():
    src = read_txt(REPO / "karaoke" / "songs.js")
    songs = {}
    # грубый разбор: id, num, sections с lines
    cur = None
    sec = None
    for ln in src.splitlines():
        m = re.search(r"id:\s*'n(\d+)'", ln)
        if m:
            cur = int(m.group(1))
            songs[cur] = []
            continue
        if cur is None:
            continue
        m = re.search(r"label:\s*'([^']*)'", ln)
        if m and "type:" in ln:
            sec = {"label": m.group(1), "lines": []}
            songs[cur].append(sec)
            continue
        m = re.match(r"\s*'(.*)'\s*,?\s*$", ln)
        if m and sec is not None:
            sec["lines"].append(norm_line(m.group(1).replace("\\'", "'")))
    return songs

# --- A/B: ЧИСТОВИК ↔ data LRC ---
reg = json.loads(read_txt(REPO / "data" / "lyrics" / "registry.json"))
nums = []
for t in reg["tracks"]:
    n = t["num"]
    nums.append(n)
    lp = REPO / t["lrc"]
    sp = REPO / t["source_txt"]
    if not lp.is_file():
        issues.append(f"№{n}: нет LRC {t['lrc']}")
        continue
    if not sp.is_file():
        issues.append(f"№{n}: нет ЧИСТОВИКА {t['source_txt']}")
        continue
    # пломбы
    if hashlib.sha256(lp.read_bytes()).hexdigest() != t["sha256_lrc"]:
        issues.append(f"№{n}: пломба sha256_lrc не сходится")
    if hashlib.sha256(sp.read_bytes()).hexdigest() != t["sha256_txt"]:
        issues.append(f"№{n}: пломба sha256_txt не сходится")
    body = chistovik_body(sp)
    lrc = lrc_text_lines(lp)
    if body != lrc:
        # найти первое расхождение
        i = 0
        while i < min(len(body), len(lrc)) and body[i] == lrc[i]:
            i += 1
        issues.append(f"№{n}: ЧИСТОВИК({len(body)}) ≠ LRC({len(lrc)}) на строке {i+1}: "
                      f"TXT='{body[i] if i<len(body) else '—'}' LRC='{lrc[i] if i<len(lrc) else '—'}'")
    # мусор в LRC
    for bad in ("[?]", "META:", "субтитры слабые", "черновик для сверки"):
        if bad in read_txt(lp):
            issues.append(f"№{n}: мусор '{bad}' в LRC")

missing = set(range(1, 66)) - set(nums)
if missing:
    issues.append(f"В реестре нет номеров: {sorted(missing)}")

# --- C: karaoke/lrc/nNN.lrc ↔ data LRC ---
for n in nums:
    kp = REPO / "karaoke" / "lrc" / f"n{n:02d}.lrc"
    if not kp.is_file():
        issues.append(f"№{n}: нет karaoke/lrc/n{n:02d}.lrc")
        continue
    a = lrc_text_lines(REPO / [t for t in reg["tracks"] if t["num"] == n][0]["lrc"])
    b = lrc_text_lines(kp)
    if a != b:
        i = 0
        while i < min(len(a), len(b)) and a[i] == b[i]:
            i += 1
        issues.append(f"№{n}: dataLRC({len(a)}) ≠ karaokeLRC({len(b)}) строка {i+1}: "
                      f"A='{a[i] if i<len(a) else '—'}' B='{b[i] if i<len(b) else '—'}'")

# --- D: karaoke/songs.js ↔ data LRC ---
songs = parse_songs_js()
for n in nums:
    if n not in songs:
        issues.append(f"№{n}: нет песни в karaoke/songs.js")
        continue
    a = lrc_text_lines(REPO / [t for t in reg["tracks"] if t["num"] == n][0]["lrc"])
    b = [ln for sec in songs[n] for ln in sec["lines"]]
    if a != b:
        i = 0
        while i < min(len(a), len(b)) and a[i] == b[i]:
            i += 1
        issues.append(f"№{n}: dataLRC({len(a)}) ≠ songs.js({len(b)}) строка {i+1}: "
                      f"A='{a[i] if i<len(a) else '—'}' B='{b[i] if i<len(b) else '—'}'")

# --- E: prototip/minus/nNN.lrc ↔ data LRC (текстовые строки) ---
for n in nums:
    pp = REPO / "prototip" / "minus" / f"n{n:02d}.lrc"
    if not pp.is_file():
        continue  # таймированные метки есть только у 01–05
    a = lrc_text_lines(REPO / [t for t in reg["tracks"] if t["num"] == n][0]["lrc"])
    src = read_txt(pp)
    b = []
    for ln in src.splitlines():
        s = ln.strip()
        if not s or s.startswith("[") or "->" in s or "<" in s.split("]")[0][1:]:
            # строка с таймингами [mm:ss.xx] текст — вырезаем тайминг
            pass
        m = re.match(r"^\[\d{2}:\d{2}(?:\.\d+)?\]\s*(.*)$", s)
        if m:
            if m.group(1).strip():
                b.append(norm_line(m.group(1)))
            continue
        if s.startswith("[") or not s:
            continue
        b.append(norm_line(s))
    if a != b:
        i = 0
        while i < min(len(a), len(b)) and a[i] == b[i]:
            i += 1
        issues.append(f"№{n}: dataLRC({len(a)}) ≠ prototip({len(b)}) строка {i+1}: "
                      f"A='{a[i] if i<len(a) else '—'}' B='{b[i] if i<len(b) else '—'}'")

# --- F: site pages ↔ LRC (текст) ---
for t in reg["tracks"]:
    n = t["num"]
    hp = REPO / "site" / f"track-{n:02d}.html"
    if not hp.is_file():
        issues.append(f"№{n}: нет site/track-{n:02d}.html")
        continue
    h = read_txt(hp)
    a = lrc_text_lines(REPO / t["lrc"])
    # из HTML: <p>...<br>\nстроки...</p> внутри section; &quot; — html-эскейп кавычек
    import html as _html
    b = []
    for m in re.finditer(r"<section>.*?</section>", h, re.S):
        seg = m.group(0)
        seg = re.sub(r"<h2>.*?</h2>", "", seg, flags=re.S)
        mm = re.search(r"<p>(.*?)</p>", seg, re.S)
        if mm:
            for ln in mm.group(1).split("<br>"):
                ln = norm_line(_html.unescape(re.sub(r"<[^>]+>", "", ln)))
                if ln:
                    b.append(ln)
    if a != b:
        i = 0
        while i < min(len(a), len(b)) and a[i] == b[i]:
            i += 1
        issues.append(f"№{n}: site({len(b)}) ≠ LRC({len(a)}) строка {i+1}: "
                      f"A='{a[i] if i<len(a) else '—'}' B='{b[i] if i<len(b) else '—'}'")

# --- мусор в ЧИСТОВИКАХ ---
for f in sorted(glob.glob(str(REPO / "download" / "*ЧИСТОВИК*.txt"))):
    txt = read_txt(f)
    n = re.match(r"№(\d+)", txt.splitlines()[0]).group(1) if re.match(r"№(\d+)", txt.splitlines()[0]) else os.path.basename(f)
    for bad in ("[?]", "META:", "субтитры слабые", "черновик для сверки", "audset", "TODO", "XXX", "не проверено"):
        if bad.lower() in txt.lower():
            issues.append(f"{os.path.basename(f)}: мусор '{bad}' в ЧИСТОВИКЕ")

print(f"Треков в реестре: {len(reg['tracks'])} · songs.js: {len(songs)} · issues: {len(issues)}")
for x in issues:
    print("  ✗", x)
print("AUDIT=" + ("FAIL" if issues else "PASS"))
sys.exit(1 if issues else 0)

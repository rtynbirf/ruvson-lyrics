#!/usr/bin/env python3
"""П51 (issue #8): генератор lrc-реестра — тексты как данные.

Источник истины — download/*_ЧИСТОВИК.txt (эталон текстов RUVSON).
Скрипт детерминированно строит:
  1. data/lyrics/<NN>_<название>.lrc — машиночитаемый LRC: метаданные
     ([ti]/[ar]/[al]/[source]/[youtube]/[length]/[sync]) + [label:] секции
     + строки текста. ЧЕСТНО: таймингов нет — тексты в репо без синхро;
     выдумывать [mm:ss.xx] запрещено (sync:unsynced). Реальные тайминги
     живут только в карaoke-метках prototip/minus/n01..n05 (треки 01–05,
     «базовые метки, правятся тапом») — реестр ссылается на них честно.
  2. data/lyrics/registry.json — реестр: номер, название, пути,
     sha256-пломбы источника и lrc, статусы синхро, пробелы нумерации.

Детерминизм: никакой времени/среды в выходе; двойной прогон байт-идентичен
(--check собирает в temp и сравнивает байт-в-байт).
Запуск: python3 scripts/build_lrc_registry.py [--check]
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SRC_DIR = REPO / "download"
OUT_DIR = REPO / "data" / "lyrics"
REG_PATH = OUT_DIR / "registry.json"
KARAOKE_DIR = REPO / "prototip" / "minus"

# карaoke-треки с реальными (базовыми) таймингами: nNN → номер ЧИСТОВИКа
# (названия из prototip/js/song.js, сверены с именами download/*.txt)
KARAOKE_TIMED = {
    1: "n01.lrc",
    2: "n02.lrc",
    3: "n03.lrc",
    4: "n04.lrc",
    5: "n05.lrc",
}

HEAD_RE = re.compile(r"^№(\d+)\s+—\s+(.+?)\s+—\s+(\d{1,2}:\d{2})\s*$")
HEAD_RE_NODUR = re.compile(r"^№(\d+)\s+—\s+(.+?)\s*$")
URL_RE = re.compile(r"^(https?://\S+)\s*$")
LABEL_RE = re.compile(r"^([^\s:][^:]{0,28}):$")


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def slugify(title: str) -> str:
    s = re.sub(r"[^\wа-яёА-ЯЁ -]", "", title, flags=re.UNICODE)
    s = re.sub(r"\s+", "_", s.strip())
    return s


def parse_source(p: Path) -> dict:
    lines = p.read_text(encoding="utf-8").splitlines()
    if not lines:
        raise SystemExit(f"LRC_BUILD=FAIL :: пустой файл: {p.name}")
    m = HEAD_RE.match(lines[0].strip())
    if m:
        num, title, length = int(m.group(1)), m.group(2), m.group(3)
        rest = lines[1:]
    else:
        m2 = HEAD_RE_NODUR.match(lines[0].strip())
        if not m2:
            raise SystemExit(f"LRC_BUILD=FAIL :: шапка не распознана: {p.name}")
        num, title, length = int(m2.group(1)), m2.group(2), None
        rest = lines[1:]
    youtube = None
    if rest and (mu := URL_RE.match(rest[0].strip())):
        url = mu.group(1)
        m3 = re.search(r"(?:youtu\.be/|v=)([\w-]{6,})", url)
        youtube = m3.group(1) if m3 else url
        rest = rest[1:]
    sections: list[dict] = []
    cur: dict | None = None
    for ln in rest:
        s = ln.strip()
        if not s:
            continue
        lm = LABEL_RE.match(s)
        if lm:
            cur = {"label": lm.group(1), "lines": []}
            sections.append(cur)
            continue
        if cur is None:
            cur = {"label": None, "lines": []}
            sections.append(cur)
        cur["lines"].append(s)
    return {"num": num, "title": title, "length": length,
            "youtube": youtube, "sections": sections}


def render_lrc(rec: dict, src_rel: str) -> bytes:
    out = []
    out.append(f"[ti:{rec['title']}]")
    out.append("[ar:RUVSON]")
    out.append("[al:МУЗЫКА СО СМЫСЛОМ · ЧИСТОВИК]")
    out.append("[ve:lrc-registry/1]")
    out.append("[offset:0]")
    out.append(f"[source:{src_rel}]")
    if rec["youtube"]:
        out.append(f"[youtube:{rec['youtube']}]")
    if rec["length"]:
        out.append(f"[length:{rec['length']}]")
    out.append("[sync:unsynced]")
    for sec in rec["sections"]:
        if sec["label"]:
            out.append(f"[label:{sec['label']}]")
        out.extend(sec["lines"])
    return ("\n".join(out) + "\n").encode("utf-8")


def build(src_dir: Path, karaoke_dir: Path | None, out_dir: Path,
          repo_root_for_paths: Path) -> dict:
    """Сборка реестра + lrc. repo_root_for_paths — от чего считать
    относительные пути ([source:], source_txt). Возвращаем реестр-dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    seen_nums = []
    for p in sorted(src_dir.glob("*_ЧИСТОВИК.txt")):
        rec = parse_source(p)
        seen_nums.append(rec["num"])
        src_rel = p.relative_to(repo_root_for_paths).as_posix()
        lrc_name = f"{rec['num']:02d}_{slugify(rec['title'])}.lrc"
        lrc_rel = f"data/lyrics/{lrc_name}"
        lrc_bytes = render_lrc(rec, src_rel)
        (out_dir / lrc_name).write_bytes(lrc_bytes)
        kar_rec = None
        if karaoke_dir and karaoke_dir.is_dir():
            kname = KARAOKE_TIMED.get(rec["num"])
            kp = karaoke_dir / kname if kname else None
            if kp and kp.is_file():
                kar_rec = {"path": f"prototip/minus/{kname}",
                           "sha256": sha256_file(kp),
                           "note": "базовые тайминг-метки карaoke "
                                   "(scripts/build_lrc.js), правятся тапом в «Синхро»"}
        entries.append({
            "num": rec["num"],
            "title": rec["title"],
            "length": rec["length"],
            "youtube": rec["youtube"],
            "sync": "unsynced",
            "lrc": lrc_rel,
            "sha256_lrc": hashlib.sha256(lrc_bytes).hexdigest(),
            "source_txt": src_rel,
            "sha256_txt": sha256_file(p),
            "sections": len(rec["sections"]),
            "karaoke_timed": kar_rec,
        })
    if not entries:
        raise SystemExit("LRC_BUILD=FAIL :: нет файлов *_ЧИСТОВИК.txt")
    full = set(range(1, max(seen_nums) + 1))
    gaps = sorted(full - set(seen_nums))
    return {
        "schema": "lrc-registry/1",
        "artist": "RUVSON",
        "counts": {"tracks": len(entries), "numbering_max": max(seen_nums)},
        "gaps": {"missing_nums": gaps,
                 "note": "номера без файла *_ЧИСТОВИК.txt в download/ — в реестре "
                         "их нет, страницы не строятся (не выдумываем)"},
        "sync_policy": "тайминги не выдумываются: sync=unsynced; реальные метки — "
                       "только prototip/minus/n01..n05 (треки 01–05)",
        "tracks": entries,
    }


def render_registry(reg: dict) -> bytes:
    return (json.dumps(reg, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    if "--check" in sys.argv:
        if not REG_PATH.is_file():
            print("LRC_CHECK=FAIL :: реестра нет")
            return 1
        reg_now = REG_PATH.read_bytes()
        lrc_now = {p.name: p.read_bytes() for p in sorted(OUT_DIR.glob("*.lrc"))}
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            (tmp / "prototip").mkdir()
            shutil.copytree(SRC_DIR, tmp / "download")
            if KARAOKE_DIR.is_dir():
                (tmp / "prototip" / "minus").mkdir(parents=True)
                for kl in KARAOKE_DIR.glob("*.lrc"):
                    shutil.copy2(kl, tmp / "prototip" / "minus" / kl.name)
            reg = build(tmp / "download", tmp / "prototip" / "minus",
                        tmp / "data" / "lyrics", tmp)
            reg_new = render_registry(reg)
            lrc_new = {p.name: p.read_bytes()
                       for p in sorted((tmp / "data" / "lyrics").glob("*.lrc"))}
        if reg_now != reg_new:
            print("LRC_CHECK=FAIL :: registry.json расходится со сборкой")
            return 1
        if lrc_now != lrc_new:
            print("LRC_CHECK=FAIL :: .lrc расходятся со сборкой")
            return 1
        print(f"LRC_CHECK=PASS :: двойная сборка байт-идентична "
              f"({len(lrc_now)} lrc + registry.json)")
        return 0
    reg = build(SRC_DIR, KARAOKE_DIR, OUT_DIR, REPO)
    REG_PATH.write_bytes(render_registry(reg))
    print(f"LRC_BUILD=PASS :: {reg['counts']['tracks']} треков, "
          f"пробелы нумерации: {reg['gaps']['missing_nums'] or 'нет'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

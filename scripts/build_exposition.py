#!/usr/bin/env python3
"""П51 (issue #8): детерминированная экспозиция текстов из lrc-реестра.

Читает data/lyrics/registry.json, проверяет sha256-пломбы (lrc и источник
ЧИСТОВИК — tamper = красный), строит site/:
  index.html            — каталог всех треков
  track-<NN>.html       — страница трека (текст, секции, источники)
  SHA256SUMS.txt        — пломбы всех страниц (сортировка по имени)

Детерминизм: в HTML нет времени/среды/случайности; двойная сборка
байт-идентична (--check). 63/63 lrc обязаны найти свои страницы.

Запуск: python3 scripts/build_exposition.py [--check]
"""
from __future__ import annotations

import hashlib
import html
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG_PATH = REPO / "data" / "lyrics" / "registry.json"
SITE = REPO / "site"


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def page_track(t: dict) -> bytes:
    e = html.escape
    kar = t.get("karaoke_timed")
    parts = []
    parts.append("<!doctype html>")
    parts.append('<html lang="ru"><head><meta charset="utf-8">')
    parts.append(f"<title>{e(t['title'])} — RUVSON · текст</title>")
    parts.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    parts.append('<link rel="stylesheet" href="style.css">')
    parts.append("</head><body>")
    parts.append('<p><a href="index.html">← все тексты</a></p>')
    parts.append(f"<h1>{e(t['title'])}</h1>")
    meta = [f"№ {t['num']}"]
    if t.get("length"):
        meta.append(f"длительность {e(t['length'])}")
    meta.append("текст: " + e(str(t.get("source_txt"))))
    parts.append('<p class="meta">' + " · ".join(meta) + "</p>")
    if t.get("youtube"):
        parts.append(f'<p><a href="https://youtu.be/{e(t["youtube"])}">'
                     f'youtube: {e(t["youtube"])}</a></p>')
    parts.append(f'<p class="sync">sync: {e(t.get("sync", "unsynced"))}'
                 " (тайминги не выдумываются")
    if kar:
        parts.append(f'; карaoke-метки: <a href="../{e(kar["path"])}">'
                     f'{e(kar["path"])}</a>')
    parts.append(")</p>")
    # секции берём из lrc-файла (данные, не реестр) — источник правды
    label = None
    lines: list[str] = []
    blocks: list[tuple[str | None, list[str]]] = []
    for raw in (REPO / t["lrc"]).read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if s.startswith("[label:") and s.endswith("]"):
            if label is not None or lines:
                blocks.append((label, lines))
            label, lines = s[len("[label:"):-1], []
            continue
        if s.startswith("["):
            continue  # прочие метаданные lrc в текст страницы не идут
        if s:
            lines.append(s)
    if label is not None or lines:
        blocks.append((label, lines))
    for lab, lns in blocks:
        parts.append("<section>")
        if lab:
            parts.append(f"<h2>{e(lab)}</h2>")
        parts.append("<p>" + "<br>\n".join(e(x) for x in lns) + "</p>")
        parts.append("</section>")
    parts.append('<footer>Собрано из данных (lrc-реестр) — не рукопашный HTML. '
                 "Сборка детерминирована: двойная сборка байт-идентична (П51).</footer>")
    parts.append("</body></html>")
    return ("\n".join(parts) + "\n").encode("utf-8")


def page_index(reg: dict) -> bytes:
    e = html.escape
    parts = []
    parts.append("<!doctype html>")
    parts.append('<html lang="ru"><head><meta charset="utf-8">')
    parts.append("<title>RUVSON · тексты как данные (П51)</title>")
    parts.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    parts.append('<link rel="stylesheet" href="style.css">')
    parts.append("</head><body>")
    parts.append("<h1>RUVSON — тексты как данные</h1>")
    gaps = reg.get("gaps", {}).get("missing_nums", [])
    parts.append(f"<p>Реестр: data/lyrics/registry.json · треков: "
                 f"{reg['counts']['tracks']} · нумерация до "
                 f"{reg['counts']['numbering_max']}"
                 + (f" · без текста: {', '.join(map(str, gaps))}" if gaps else "")
                 + "</p>")
    parts.append("<table><thead><tr><th>№</th><th>Название</th>"
                 "<th>Время</th><th>Синхро</th><th>Карaoke</th></tr></thead><tbody>")
    for t in reg["tracks"]:
        kar = "✓ метки" if t.get("karaoke_timed") else "—"
        parts.append(
            f'<tr><td>{t["num"]}</td>'
            f'<td><a href="track-{t["num"]:02d}.html">{e(t["title"])}</a></td>'
            f'<td>{e(t.get("length") or "—")}</td>'
            f'<td>{e(t.get("sync", "unsynced"))}</td>'
            f"<td>{kar}</td></tr>")
    parts.append("</tbody></table>")
    parts.append('<footer>Каждая страница собирается скриптом из lrc-данных; '
                 "правка текста = правка данных, не HTML (П51).</footer>")
    parts.append("</body></html>")
    return ("\n".join(parts) + "\n").encode("utf-8")


STYLE = """/* П51: стили экспозиции — данные разметят себя сами */
:root { color-scheme: light dark; }
body { font-family: Georgia, 'Times New Roman', serif; max-width: 42rem;
       margin: 0 auto; padding: 1.2rem; line-height: 1.55; }
table { border-collapse: collapse; width: 100%; }
td, th { border-bottom: 1px solid #8886; padding: .3rem .45rem; text-align: left; }
.meta, .sync { color: #888; font-size: .9rem; }
section p { white-space: pre-wrap; }
footer { margin-top: 2rem; border-top: 1px solid #8886; padding-top: .6rem;
         color: #888; font-size: .85rem; }
""".encode("utf-8")


def verify_seals(reg: dict) -> None:
    bad = []
    for t in reg["tracks"]:
        lp = REPO / t["lrc"]
        if not lp.is_file() or sha256_bytes(lp.read_bytes()) != t["sha256_lrc"]:
            bad.append(f"{t['lrc']}: пломба lrc не сходится")
        sp = REPO / t["source_txt"]
        if not sp.is_file() or sha256_bytes(sp.read_bytes()) != t["sha256_txt"]:
            bad.append(f"{t['source_txt']}: пломба источника не сходится")
        kar = t.get("karaoke_timed")
        if kar:
            kp = REPO / kar["path"]
            if not kp.is_file() or sha256_bytes(kp.read_bytes()) != kar["sha256"]:
                bad.append(f"{kar['path']}: пломба карaoke-меток не сходится")
    if bad:
        print("EXPOSITION=FAIL :: tamper-контроль: " + "; ".join(bad[:6]))
        raise SystemExit(1)


def build_into(reg: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "style.css").write_bytes(STYLE)
    (out / "index.html").write_bytes(page_index(reg))
    hashes = []
    for t in reg["tracks"]:
        b = page_track(t)
        name = f"track-{t['num']:02d}.html"
        (out / name).write_bytes(b)
        hashes.append((name, sha256_bytes(b)))
    hashes.append(("index.html", sha256_bytes((out / "index.html").read_bytes())))
    hashes.sort()
    (out / "SHA256SUMS.txt").write_bytes(
        "".join(f"{h}  {n}\n" for n, h in hashes).encode("utf-8"))


def main() -> int:
    if not REG_PATH.is_file():
        print("EXPOSITION=FAIL :: нет data/lyrics/registry.json — сначала build_lrc_registry.py")
        return 1
    reg = json.loads(REG_PATH.read_text(encoding="utf-8"))
    verify_seals(reg)

    if "--check" in sys.argv:
        if not SITE.is_dir():
            print("BUILD_CHECK=FAIL :: site/ нет")
            return 1
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "site"
            build_into(reg, tmp)
            for p in sorted(tmp.rglob("*")):
                if p.is_file():
                    rel = p.relative_to(tmp)
                    cur = SITE / rel
                    if not cur.is_file() or cur.read_bytes() != p.read_bytes():
                        print(f"BUILD_CHECK=FAIL :: {rel.as_posix()} расходится "
                              f"с двойной сборкой")
                        return 1
            extra = [p.relative_to(SITE).as_posix()
                     for p in SITE.rglob("*") if p.is_file()
                     and not (tmp / p.relative_to(SITE)).is_file()]
            if extra:
                print(f"BUILD_CHECK=FAIL :: в site/ лишние файлы: {extra[:5]}")
                return 1
        n = reg["counts"]["tracks"]
        print(f"BUILD_CHECK=PASS :: двойная сборка байт-идентична; "
              f"{n}/{n} lrc нашли свои страницы (index + {n} страниц)")
        return 0

    build_into(reg, SITE)
    n = reg["counts"]["tracks"]
    sums = sha256_bytes((SITE / "SHA256SUMS.txt").read_bytes())
    idx = sha256_bytes((SITE / "index.html").read_bytes())
    print(f"EXPOSITION=PASS :: index + {n} страниц; "
          f"sha256(SHA256SUMS.txt)={sums[:16]}… sha256(index)={idx[:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())

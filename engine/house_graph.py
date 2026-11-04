# -*- coding: utf-8 -*-
"""ГРАФ ДОМА — корпус 65 треков RUVSON как граф задач, посчитанный числом.

Читает живое состояние репозитория и строит DAG обработки корпуса:

    КАНАЛ → черновик(t) → ухо(t) → чистовик(t) → метки(t) → караоке(t) → СЦЕНА
              (у 26/38 — из других источников)              ↑
    КАНАЛ → минус(t) (сепарация) ─────────────────────────────┘

Данные — факт дома, не выдумка:
- реестр 65 треков: `scripts/build_zip.py` → TRACKS (№, название, длительность,
  видео, источник, примечание; WEAK = слабые субтитры);
- живые длительности: lyrics_work/*.txt первая строка META (dur в секундах);
- чистовики: download/*_ЧИСТОВИК.txt (утверждённые на слух);
- метки: karaoke/lrc/*.lrc, песни: karaoke/songs.js.

Модель (константы названы, не спрятаны):
- УХО — ПОСЛЕДОВАТЕЛЬНАЯ машина: юзер один, сверки выстроены цепочкой
  в порядке № (ухо:t → ухо:t′) — это честный ресурс дома;
- ухо(t) = 2 × dur(t) — два прослушивания юзером (эталон = канал);
- чистовик(t) = 120 с — внесение правок и файл;
- метки(t): сценарий А (тап-синхро) = dur(t); сценарий Б (принудительное
  выравнивание слова-уровня, мировая практика whisperX/Enhanced LRC)
  = 0.25 × dur(t) + 60 с на правку;
- минус(t) = dur(t) + 900 с — сепарация (htdemucs на CPU), ветка
  параллельна уху;
- караоке(t) = 300 с — привязка в приложении;
- вероятности (для VITER/BOTT, модель честно названа): черновик — 0.98,
  0.9 у не-субтитровых источников, 0.6 у WEAK; ухо 0.95; чистовик 0.99;
  метки 0.99; минус 0.95; караоке 0.98.

Запуск:  python3 engine/house_graph.py
"""
from __future__ import annotations

import ast
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from propagator import (BOOL, BOTT, CORR, COUNT, MAXP, POLY, TaskGraph,
                        VITER, corridor_best, corridor_min_attempts,
                        criticality, free_energy, makespan, poly_paths,
                        pathsum, sweep, worldline)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- названные константы модели (см. докстринг) -----------------------------
EAR_CHECKS = 2          # прослушиваний на сверку трека
CLEAN_SEW = 120         # с — внесение правок и файл чистовика
ALIGN_RATE = 0.25       # доля dur при принудительном выравнивании
ALIGN_FIX = 60          # с — правка меток после выравнивания
SEP_OVERHEAD = 900      # с — сепарация минуса (htdemucs, CPU)
APP_HOOK = 300          # с — привязка песни в караоке

P = {"черн": 0.98, "черн:src": 0.90, "черн:weak": 0.60,
     "ухо": 0.95, "чист": 0.99, "метки": 0.99, "минус": 0.95, "кара": 0.98}


# ---------------------------------------------------------------------------
# Живые данные дома
# ---------------------------------------------------------------------------

def load_tracks() -> list[dict]:
    """Реестр 65 треков из scripts/build_zip.py (TRACKS = [...])."""
    src = open(os.path.join(ROOT, "scripts", "build_zip.py"),
               encoding="utf-8").read()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "TRACKS":
                    rows = ast.literal_eval(node.value)
                    return [dict(zip(("n", "title", "dur", "video", "src",
                                      "note"), r)) for r in rows]
    raise ValueError("TRACKS не найден в scripts/build_zip.py")


def load_meta() -> dict[int, dict]:
    """META-строки черновиков: {№: {dur, status, video, …}}."""
    out = {}
    for path in glob.glob(os.path.join(ROOT, "lyrics_work", "*.txt")):
        with open(path, encoding="utf-8") as f:
            first = f.readline().strip()
        if first.startswith("META:"):
            m = json.loads(first[5:])
            out[m["n"]] = m
    return out


def load_done() -> dict:
    """Факт дома: чистовики, метки, песни караоке."""
    clean = sorted(int(re.match(r"(\d+)_", os.path.basename(p)).group(1))
                   for p in glob.glob(os.path.join(ROOT, "download",
                                                   "*_ЧИСТОВИК.txt")))
    lrc = sorted(int(m.group(1))
                 for p in glob.glob(os.path.join(ROOT, "karaoke", "lrc",
                                                 "*.lrc"))
                 if (m := re.match(r"n(\d+)\.lrc", os.path.basename(p))))
    songs_js = open(os.path.join(ROOT, "karaoke", "songs.js"),
                    encoding="utf-8").read()
    songs = sorted(int(x) for x in re.findall(r"num:\s*(\d+)", songs_js))
    return {"clean": clean, "lrc": lrc, "songs": songs}


# ---------------------------------------------------------------------------
# Граф корпуса
# ---------------------------------------------------------------------------

def build_graph(meta: dict, tracks: list[dict], lrc_mode: str = "A") -> TaskGraph:
    """DAG корпуса. lrc_mode: 'A' — тап-синхро, 'Б' — авто-выравнивание."""
    if lrc_mode not in ("A", "Б"):
        raise ValueError("lrc_mode: 'A' или 'Б'")
    G = TaskGraph(f"КОРПУС RUVSON · метки-{lrc_mode}")
    G.add("КАНАЛ", 0.0, 1.0)
    G.add("СЦЕНА", 0.0, 1.0)
    ear_prev = None
    for t in tracks:
        n = t["n"]
        d = float(meta.get(n, {}).get("dur") or _dursec(t["dur"]))
        weak = (t["note"] == "WEAK")
        src = bool(t["src"])
        p_chern = P["черн:weak"] if weak else (P["черн:src"] if src else P["черн"])
        G.add(f"черн:{n}", 0.0, p_chern)
        G.add(f"ухо:{n}", EAR_CHECKS * d, P["ухо"])
        G.add(f"чист:{n}", CLEAN_SEW, P["чист"])
        dur_lrc = d if lrc_mode == "A" else ALIGN_RATE * d + ALIGN_FIX
        G.add(f"метки:{n}", dur_lrc, P["метки"])
        G.add(f"минус:{n}", d + SEP_OVERHEAD, P["минус"])
        G.add(f"кара:{n}", APP_HOOK, P["кара"])
        G.dep("КАНАЛ", f"черн:{n}")
        G.dep(f"черн:{n}", f"ухо:{n}")
        if ear_prev is not None:
            G.dep(ear_prev, f"ухо:{n}")   # юзер один — сверки последовательно
        G.dep(f"ухо:{n}", f"чист:{n}")
        G.dep(f"чист:{n}", f"метки:{n}")
        G.dep("КАНАЛ", f"минус:{n}")
        G.dep(f"метки:{n}", f"кара:{n}")
        G.dep(f"минус:{n}", f"кара:{n}")
        G.dep(f"кара:{n}", "СЦЕНА")
        ear_prev = f"ухо:{n}"
    return G


def _dursec(mmss: str) -> int:
    m, s = mmss.split(":")
    return int(m) * 60 + int(s)


# ---------------------------------------------------------------------------
# Компакт-отчёт (текст как нерв)
# ---------------------------------------------------------------------------

def hms(sec: float) -> str:
    sec = int(round(sec))
    return f"{sec // 3600}ч{sec % 3600 // 60:02d}м" if sec >= 3600 \
        else f"{sec // 60}м{sec % 60:02d}с"


def report() -> str:
    tracks = load_tracks()
    meta = load_meta()
    done = load_done()
    lines: list[str] = []
    say = lines.append

    n_tracks = len(tracks)
    drafts = len(meta)
    clean, lrc, songs = set(done["clean"]), set(done["lrc"]), set(done["songs"])
    say("ПРОПАГАТОР ДОМА — граф корпуса RUVSON числом")
    say("=" * 62)
    say(f"Факт дома: треков в реестре {n_tracks}; черновиков {drafts} "
        f"(без своих субтитров: №26 — ремикс, №38 — audset); "
        f"чистовиков {len(clean)} ({sorted(clean)}); "
        f"меток LRC {len(lrc)}; песен в караоке {len(songs)}.")
    gap = [t["n"] for t in tracks if t["n"] not in clean]
    say(f"До чистовика осталось {len(gap)} треков; до меток — "
        f"{n_tracks - len(lrc)}; до сцены — {n_tracks - len(songs)}.")
    weak = [t["n"] for t in tracks if t["note"] == "WEAK"]
    say(f"Слабые субтитры (WEAK): {weak or 'нет'}.")

    GA = build_graph(meta, tracks, "A")
    GB = build_graph(meta, tracks, "Б")
    TA, KpA, _, RA, critA = makespan(GA)
    TB, KpB, _, _, _ = makespan(GB)
    ear_total = sum(2.0 * float(meta.get(t["n"], {}).get("dur") or
                                _dursec(t["dur"])) for t in tracks)
    say("")
    say(f"[1] РАСПИСАНИЕ (MAXP). Сценарий А (тап-синхро): T = {hms(TA)}; "
        f"сценарий Б (авто-выравнивание, мировая практика): T = {hms(TB)}; "
        f"выигрыш {hms(TA - TB)}.")
    ears_crit = [v for v in critA if v.startswith("ухо:")]
    say(f"    Критический путь = {len(ears_crit)}/65 сверок подряд: ухо — "
        f"последовательная машина, {hms(ear_total)} чистого слушания; "
        f"узкое место дома — слово юзера, технология его не сжимает.")
    lrc_crit = [v for v in critA if v.startswith("метки:")]
    say(f"    Технология сжимает только хвост: на критпути из «меток» стоит "
        f"{len(lrc_crit)} из 65 ({', '.join(v.split(':')[1] for v in lrc_crit) or 'нет'}), "
        f"вся сепарация минусов — с резервом; выигрыш сценария Б — минуты, "
        f"не часы: его цена — качество (трубки на word-уровне), не срок.")

    crit = criticality(GA, "КАНАЛ", "СЦЕНА")
    top = sorted(crit.items(), key=lambda kv: -kv[1])[:6]
    say("")
    say("[2] КРИТИЧНОСТЬ (COUNT×2, плотность мировых линий). Топ узлов: "
        + ", ".join(f"{v}={c:.2f}" for v, c in top))

    rel = {v: GA.prob[v] for v in GA.dur}
    worst_link = {}
    for t in tracks:
        chain = [rel[f"черн:{t['n']}"], rel[f"ухо:{t['n']}"], rel[f"чист:{t['n']}"],
                 rel[f"метки:{t['n']}"], rel[f"минус:{t['n']}"], rel[f"кара:{t['n']}"]]
        worst_link[t["n"]] = min(chain)
    wl = sorted(worst_link.items(), key=lambda kv: kv[1])[:6]
    say("")
    say("[3] НАДЁЖНОСТЬ (VITER по цепочке трека; BOTT — слабейшее звено).")
    say("    Худшие звенья (вероятность): "
        + ", ".join(f"№{n}={p:g}" for n, p in wl))
    med = sorted(worst_link.values())[len(worst_link) // 2]
    say(f"    Медиана надёжности цепочки трека: {med:g}; модель вероятностей "
        f"названа в докстринге house_graph.")

    Pz = poly_paths(GA, "КАНАЛ", "СЦЕНА")
    say("")
    say(f"[4] ПРОИЗВОДЯЩАЯ ФУНКЦИЯ (POLY ℝ[z]). P(z) = Σ_треков z^цепочка; "
        f"степень P = T = {hms(max(Pz))}; путей (COUNT) = "
        f"{len(Pz)} — по одному на трек, порядок треков свободен.")
    fe1 = free_energy(GA, 1.0, "КАНАЛ", "СЦЕНА")
    fe10 = free_energy(GA, 10.0, "КАНАЛ", "СЦЕНА")
    say(f"[5] СВОБОДНАЯ ЭНЕРГИЯ. f(β=1) = {hms(fe1)}; f(β=10) = {hms(fe10)} "
        f"→ тропический предел {hms(TA)} (критпуть — основное состояние).")

    reach = sweep(GA, {v: (v == "КАНАЛ") for v in GA.dur}, BOOL,
                  eps=lambda u, v, ku: ku)[0]
    n_reach = sum(1 for v in GA.dur if v.startswith("чист:") and reach[v])
    say("")
    say(f"[6] ДОСТИЖИМОСТЬ (BOOL). Чистовик достижим для {n_reach}/{n_tracks} "
        f"треков без НОВЫХ съёмов субтитров — корпус замкнут сам на себя; "
        f"№26/№38 — своих субтитров в доме нет, текст только из внешних "
        f"источников (у №26 — субтитры ремикса KvzORszfsg8).")

    say("")
    say("[7] ЗЕЛЁНЫЙ КОРИДОР (CORR, автомат-полукольцо — механика дома v3.1).")
    for n in (5, 10, 20):
        say(f"    Максимум отвоёванных полутонов за {n:2d} попыток: "
            f"{corridor_best(n)} (минимум попыток на 1 полутон: "
            f"{corridor_min_attempts(1)}, на 5: {corridor_min_attempts(5)}).")
    say("    Пара удачных подряд = полутон, провал сжигает копилку — "
        "это max-plus матрица M_TRY, степень = серия попыток.")

    say("")
    say("Константы модели (названы, не спрятаны): ухо = "
        f"{EAR_CHECKS}×dur; чистовик = {CLEAN_SEW} с; метки А = dur, "
        f"Б = {ALIGN_RATE:g}×dur + {ALIGN_FIX} с; минус = dur + "
        f"{SEP_OVERHEAD} с (htdemucs, CPU); караоке = {APP_HOOK} с.")
    say("Границы: минус-фонд живёт в СИНГУЛЯРЕ (63 mp3) — тут он моделью "
        "сепарации; слово юзера — единственный ресурс этапа «ухо», оно же "
        "узкое место дома.")
    return "\n".join(lines)


def main() -> None:
    print(report())


if __name__ == "__main__":
    main()

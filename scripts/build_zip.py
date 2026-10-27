#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собрать ZIP: все 65 текстов RUVSON (черновики для слуховой сверки)."""
import os, re, glob, zipfile

WORK = "/home/z/my-project/lyrics_work"
OUTDIR = "/home/z/my-project/download"
ZIPPATH = os.path.join(OUTDIR, "RUVSON_ВСЕ_ТЕКСТЫ_65.zip")
INNER = "RUVSON_ТЕКСТЫ"

# (№, название, длительность по списку юзера, video id, источник, примечание)
TRACKS = [
    (1,  "Начать сначала",              "2:41", "ahmGGM-P0CA", None, None),
    (2,  "Цени моменты",                "2:31", "R0SOJreGbhM", None, None),
    (3,  "Не тех мы ценим",             "3:02", "cFHsQ-LP3ns", None, None),
    (4,  "Ангел без крыльев",           "4:06", "kziwaat2nu4", None, None),
    (5,  "Не теряй шанс",               "2:30", "WMU46n--Z-s", None, None),
    (6,  "Не жди завтра",               "3:16", "d2b72nYLiT8", None, None),
    (7,  "Цени моменты (Remix)",        "2:54", "EFaMUciH3Do", None, None),
    (8,  "Куда летят года",             "3:02", "0er7tqdMrqU", None, None),
    (9,  "Два голоса",                  "2:57", "ZXimyVwjmts", None, None),
    (10, "Цени время",                  "4:27", "pP3Kk2_FHbE", None, None),
    (11, "Там где ты",                  "3:02", "vUb40twffCI", None, None),
    (12, "Свет в темноте",              "3:07", "KFnJwNv008s", None, None),
    (13, "Где настоящее",               "4:25", "shs0TiOwx-M", None, None),
    (14, "Время как вода",              "2:28", "YaY-ZJVXFjI", None, None),
    (15, "Бой с собой",                 "2:32", "ugjp6iaNplo", None, None),
    (16, "Крик в тишине (Remix)",       "3:42", "KvzORszfsg8", None, None),
    (17, "А что если да",               "2:58", "VfnGUIhaK2Y", None, None),
    (18, "Когда теряем",                "3:12", "TRcxZ7jfPsA", None,
         "В списке 3:12, запись на канале — 4:10 (TRcxZ7jfPsA). Субтитры этой записи рваные; чистый вариант тех же строк — в №64 (та же песня)."),
    (19, "Суть проста",                 "3:21", "8RRRYysSIHg", None, None),
    (20, "Когда погаснут огни",         "3:06", "X90mDPOhvKc", None, None),
    (21, "Вера остаётся",               "2:55", "G7L2d0Z5xfY", None, None),
    (22, "Всё начинается с тебя",       "3:40", "_PCJ6fMfeRM", None, None),
    (23, "Тень ушедших",                "3:51", "lkXLeITEtGA", None, "WEAK"),
    (24, "Я сам себе враг",             "3:22", "z3RcsfHajP8", None, None),
    (25, "Не спеши осуждать",           "3:44", "pervLR9m-vk", None, None),
    (26, "Крик в тишине",               "2:49", "BuMd7kj3UJA",
         "субтитры ремикса youtu.be/KvzORszfsg8 (у записи 2:49 субтитров нет; у короткой версии бриджа может не быть)", None),
    (27, "Я сам себе судья",            "2:48", "1BZs_wUPn1s", None, None),
    (28, "Тишина спасает",              "3:40", "_E91VEQ-8lM", None, "WEAK"),
    (29, "Смысл жизни прост",           "2:44", "KfKHWdiX3S4", None, None),
    (30, "Нас учат потери",             "4:13", "pv3GAlLG9Lk", None, None),
    (31, "Не играй в любовь",           "3:44", "8zG2LBAn1AI", None, None),
    (32, "Просто люби",                 "3:54", "9ys_TVEtda8", None, None),
    (33, "Остаться человеком",          "3:20", "TobJGYOPlnw", None, None),
    (34, "Ты одна дала",                "3:10", "_KwlGQNmC1Q", None, None),
    (35, "Жизнь не прощает",            "3:12", "QpeYJU83XiQ", None, None),
    (36, "Когда ты удобен",             "4:25", "X_-M_cjCFVg", None, None),
    (37, "Не играй в любовь (Remix)",   "3:53", "CO_BTO585O8", None,
         "Переработка: текст ДРУГОЙ, не копия №31."),
    (38, "То о чём молчим",             "2:44", "AVDC4KuNT7A",
         "audset.ru/track/46682881 — единственный полный текст в сети; у записи субтитров нет, текст мог быть сгенерирован — сверять особенно", None),
    (39, "Оставайся молодым",           "4:16", "POiQQ21I5n0", None, None),
    (40, "Пленники прошлого",           "3:11", "yK2aPehxmK8", None, "WEAK"),
    (41, "Живи сейчас",                 "4:26", "fJwb931iJVg", None, None),
    (42, "Это не секрет",               "3:01", "4j1GG_X7zHw", None, "WEAK"),
    (43, "В чём смысл",                 "4:40", "n5IFJ-g1Rtc", None, None),
    (44, "Гордость нас убивает",        "3:11", "GB31hcDi3lo", None, None),
    (45, "Меня не сломать",             "4:20", "TkmSZp1dfBE", None, None),
    (46, "Дорога мой учитель",          "2:40", "OHaRQj9PLUY", None, None),
    (47, "Время всё расставит",         "3:10", "gMASVVNFr_A", None,
         "В списке «Время всё расставит», на канале ролик называется «Время покажет» (3:11)."),
    (48, "Вне зоны доступа",            "3:27", "eA-fyeSkavI", None, None),
    (49, "О чём мечтаешь ты",           "5:20", "_gNbMCINv1Y", None, None),
    (50, "Действуй сейчас",             "2:33", "LCADfnI8F-s", None, None),
    (51, "Ты главный игрок",            "4:51", "b_36rlzEIKk", None, "WEAK"),
    (52, "Люди в масках",               "2:37", "M9o3ZIlhHrU", None, "WEAK"),
    (53, "Живи как умеешь",             "3:55", "Y7Wy_JBkz7A", None, None),
    (54, "Одиночество среди людей",     "4:04", "LqMrrKqK3AE", None, None),
    (55, "Разгадка в небесах",          "3:28", "6woWDYcu1QY", None, "WEAK"),
    (56, "А время капает",              "2:52", "HupAWAt7CmQ", None,
         "Текст №14 в ремиксе."),
    (57, "Страх не слабость",           "4:17", "WIrhIrDQvwY", None, None),
    (58, "Твоё плавание не вечно",      "3:58", "V-IaCbDUKao", None, None),
    (59, "Не угасай",                   "2:25", "MSqK5ig-alE", None, "WEAK"),
    (60, "Неудача — не конец",          "3:31", "q57MLk0Uf9c", None, None),
    (61, "Компас на дом",               "3:23", "JRTUNak53nU", None, "WEAK"),
    (62, "Остаться человеком (Remix)",  "2:57", "PIyWwF0t4wQ", None,
         "Переработка: текст ДРУГОЙ, не копия №33."),
    (63, "Код перемен",                 "3:09", "eOMrrezWEZM", None, None),
    (64, "Когда теряем (feat OutShadow)",     "3:51", "rWpYxmFjm9g", None,
         "Та же песня, что №18; субтитры этой записи чище — база для сверки №18."),
    (65, "Не тех мы ценим (feat OutShadow)",  "3:19", "hHeTk_CwmYc", None,
         "Та же песня, что №3, версия OutShadow feat. RUVSON."),
]

TAGS = re.compile(r"\[\s*(пение|музыка|music|аплодисменты|applause|смех|laughter|инструментал|instrumental)\s*\]", re.I)

def load_draft(n):
    """Текст из lyrics_work без META-строки, без тегов [пение]/[музыка]."""
    hits = glob.glob(os.path.join(WORK, "%02d_*.txt" % n))
    if not hits:
        return None
    with open(hits[0], encoding="utf-8") as f:
        raw = f.read().split("\n")
    body = [ln for ln in raw if not ln.startswith("META:")]
    text = "\n".join(body)
    text = TAGS.sub(" ", text)
    text = re.sub(r"[ \t]+", " ", text)
    lines = [ln.strip() for ln in text.split("\n")]
    out, blank = [], False
    for ln in lines:
        if not ln:
            if blank:
                continue
            blank = True
            if out:
                out.append("")
            continue
        blank = False
        out.append(ln)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out) if out else None

TEXT38 = """Мы стоим в подъезде гаснет свет
Ключ в замке не хочет повернуться
У тебя на всё готов ответ
Только нет причины улыбнуться

Вдох и снова тишина
Выдох снова ни о чём
Между нами не стена
А несказанное потом

То о чём молчим — это тлеющий пожар
То о чём молчим — тот кого никто не ждал
То о чём молчим — тише, тише, тише
Кто-нибудь услышит, тише, тише, тише
Всё о чём молчим

Сколько раз мы шли до поворота
Сколько раз я замедлял свой шаг
Между «я скучаю» и «работа»
Наша жизнь сжимается в кулак

Вдох и снова тишина
Выдох снова ни о чём
Между нами не стена
А несказанное потом

То о чём молчим — это тлеющий пожар
То о чём молчим — тот кого никто не ждал
То о чём молчим — тише, тише, тише
Кто-нибудь услышит, тише, тише, тише
Всё о чём молчим

Я хотел сказать тебе так много
Но слова застряли в горле комом
Так давай сейчас, без эпилога
Пусть услышит вся ночная тьма

То о чём молчим — это тлеющий пожар
То о чём молчим — тот кого никто не ждал
То о чём молчим — тише, тише, тише
Кто-нибудь услышит, тише, тише, тише
Всё о чём молчим

То о чём молчим — пусть останется
Нет — скажу"""

def slug(s):
    s = re.sub(r"[\\/:*?\"<>|]", "", s)
    return re.sub(r"\s+", "_", s.strip())

def header(n, title, dur, vid, src, note):
    h = ["№%d — %s — %s" % (n, title, dur),
         "https://youtu.be/%s" % vid,
         "Источник: %s" % (src or "субтитры записи (черновик для сверки на слух)")]
    if note == "WEAK":
        h.append("[?] Субтитры слабые — сверяй особенно внимательно.")
    elif note:
        h.append("[?] " + note)
    h.append("")
    return "\n".join(h)

def build_all():
    files = {}   # filename -> content
    combined = []
    for n, title, dur, vid, src, note in TRACKS:
        if n == 38:
            text = TEXT38
        elif n == 26:
            text = load_draft(16)
        else:
            text = load_draft(n)
        if not text:
            raise SystemExit("НЕТ ТЕКСТА: №%d %s" % (n, title))
        head = header(n, title, dur, vid, src, note)
        body = head + text + "\n"
        fn = "%02d_%s.txt" % (n, slug(title))
        files[fn] = body
        sep = "=" * 70
        combined.append("%s\n%s\n%s" % (sep, body.strip("\n"), ""))

    readme = ["RUVSON — ЧЕРНОВИКИ ТЕКСТОВ 65 ТРЕКОВ (для слуховой сверки)",
              "",
              "Что это: заготовки текстов всех 65 треков. Эталон — запись на канале @ruvson_music.",
              "[?] — место, где черновик заведомо может врать: слушай это место внимательнее.",
              "Строки идут как в субтитрах (потоком), повторы припева не свёрнуты — правь пачкой.",
              "",
              "ОГЛАВЛЕНИЕ (№ | название | длительность | ссылка):",
              ""]
    for n, title, dur, vid, src, note in TRACKS:
        flags = []
        if note == "WEAK":
            flags.append("слабые субтитры")
        elif src:
            flags.append("не субтитры: " + src.split(" —")[0])
        elif note:
            flags.append("см. примечание в файле")
        fl = ("   [" + "; ".join(flags) + "]") if flags else ""
        readme.append("%2d | %-32s | %s | https://youtu.be/%s%s" % (n, title, dur, vid, fl))
    readme.append("")
    readme.append("Особые треки:")
    readme.append("  №26 — у записи субтитров нет; текст взят из субтитров ремикса (youtu.be/KvzORszfsg8).")
    readme.append("  №38 — у записи субтитров нет; текст с audset.ru (мог быть сгенерирован).")
    readme.append("  №18 — в списке 3:12, на канале 4:10; сверяй по записи youtu.be/TRcxZ7jfPsA.")
    readme.append("  №47 — на канале ролик называется «Время покажет».")
    readme.append("  №64 — субтитры чище, чем у №18 (та же песня) — удобно для сверки №18.")
    files["00_ЧИТАЙ_МЕНЯ.txt"] = "\n".join(readme) + "\n"
    files["ВСЕ_65_ОДНИМ_ФАЙЛОМ.txt"] = "\n".join(combined).rstrip() + "\n"
    return files

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    files = build_all()
    with zipfile.ZipFile(ZIPPATH, "w", zipfile.ZIP_DEFLATED) as z:
        for fn, content in sorted(files.items()):
            z.writestr("%s/%s" % (INNER, fn), content)
    print("ZIP:", ZIPPATH)
    print("Файлов внутри:", len(files))
    print("Размер:", os.path.getsize(ZIPPATH), "байт")
    # контроль: 65 треков + 00 + combined = 67
    assert len(files) == 67, "ожидалось 67 файлов, вышло %d" % len(files)
    empty = [fn for fn, c in files.items() if len(c.strip()) < 120]
    print("Подозрительно короткие:", empty if empty else "нет")

if __name__ == "__main__":
    main()

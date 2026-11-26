#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ЗВУК-СВЕРКА · механизм «ТЕКСТ ↔ ЗВУЧАНИЕ» (партия 1, Drive-фонд владельца)
Единица работы: одна песня.
  python3 звук_сверка.py song <drive_id> <файл_чистовика> <имя_песни>
Стадии:
  1. download  — mp4/mp3 из Drive (gdown), пропускается если файл уже есть
  2. audio     — ffmpeg: 16 кГц моно, нарезка на куски по 60 с
  3. asr       — z-ai asr на каждый кусок, склейка в дамп фактического произношения
  4. diff      — выравнивание слов ASR ↔ чистовик (difflib), реестр расхождений
Выход: download/сверка/<имя>.json (машиночитаемый) + .md (человеческий)
"""
import json, os, re, subprocess, sys, time, difflib

BASE = '/home/z/my-project/download/сверка'
AUDIO = BASE + '/аудио'
WORK = '/tmp/zvuk'

def sh(cmd, **kw):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f'{cmd[:120]}… rc={r.returncode}: {r.stderr[-400:]}')
    return r.stdout

def download(drive_id, name):
    os.makedirs(AUDIO, exist_ok=True)
    dst = f'{AUDIO}/{name}'
    if os.path.exists(dst) and os.path.getsize(dst) > 10000:
        return dst
    sh(f"python3 -m gdown --id {drive_id} -o '{dst}' --fuzzy 2>&1 || python3 -m gdown {drive_id} -O '{dst}'")
    return dst

def chunks(src, stem):
    # 30 с, 16 кГц моно WAV — лимит ASR-сервиса: 0–30 с на файл
    os.makedirs(WORK, exist_ok=True)
    d = sh(f"ffprobe -v error -show_entries format=duration -of csv=p=0 '{src}'").strip()
    dur = float(d)
    out = []
    for i in range(int(dur // 30) + 1):
        f = f'{WORK}/{stem}_{i:03d}.wav'
        if os.path.exists(f) and os.path.getsize(f) > 50000:
            out.append(os.path.basename(f)); continue
        sh(f"ffmpeg -y -v error -ss {i*30} -t 29.9 -i '{src}' -vn -ac 1 -ar 16000 '{f}'")
        out.append(os.path.basename(f))
    return out

def asr_all(files):
    texts, filtered = [], 0
    for f in files:
        out = f'{WORK}/{f}.json'
        if not (os.path.exists(out) and os.path.getsize(out) > 20):
            for attempt in range(6):
                try:
                    sh(f"z-ai asr -f '{WORK}/{f}' -o '{out}'")
                    break
                except RuntimeError as e:
                    es = str(e)
                    if '429' in es or 'Too many' in es:
                        time.sleep(25 + attempt * 15)
                        continue
                    if '1301' in es or 'contentFilter' in es or '敏感' in es:
                        # кусок отклонён контент-фильтром ASR — фиксируем и идём дальше
                        json.dump({'text': '', 'фильтр': True}, open(out, 'w', encoding='utf-8'))
                        filtered += 1
                        break
                    raise
            else:
                raise RuntimeError(f'ASR: исчерпаны ретраи 429 на {f}')
        time.sleep(2)
        d = json.load(open(out, encoding='utf-8'))
        t = None
        if isinstance(d, dict):
            for k in ('text', 'transcription', 'result', 'data'):
                if isinstance(d.get(k), str):
                    t = d[k]; break
                if isinstance(d.get(k), dict) and isinstance(d[k].get('text'), str):
                    t = d[k]['text']; break
        if t is None and isinstance(d, str):
            t = d
        texts.append((t or '').strip())
    return texts, filtered

LAT2CYR = [('sch', 'щ'), ('sh', 'ш'), ('ch', 'ч'), ('ts', 'ц'), ('kh', 'х'), ('zh', 'ж'),
           ('ya', 'я'), ('yu', 'ю'), ('ja', 'я'), ('ju', 'ю'), ('yo', 'е'),
           ('iy', 'ий'), ('yy', 'ый'), ('ay', 'ай'), ('oy', 'ой'), ('ey', 'ей'),
           ('a', 'а'), ('b', 'б'), ('v', 'в'), ('g', 'г'), ('d', 'д'), ('e', 'е'), ('z', 'з'),
           ('i', 'и'), ('y', 'и'), ('k', 'к'), ('l', 'л'), ('m', 'м'), ('n', 'н'), ('o', 'о'),
           ('p', 'п'), ('r', 'р'), ('s', 'с'), ('t', 'т'), ('u', 'у'), ('f', 'ф'), ('h', 'х'),
           ('c', 'к'), ('w', 'в'), ('x', 'кс'), ('j', 'и'), ('q', 'к')]

def translit(w):
    s = w.lower()
    for a, b in LAT2CYR:
        s = s.replace(a, b)
    return s

def norm(w):
    w = w.lower().replace('ё', 'е')
    return re.sub(r'[^а-яa-z0-9]', '', w)

def ref_clean(txt):
    # эталон: убрать метаданные и структурные ярлыки — сравниваем только поемые строки
    out = []
    for line in txt.splitlines():
        s = line.strip()
        if not s: continue
        if re.search(r'https?://|youtu\.?be|www\.', s, re.I): continue
        if re.match(r'^\d+[\.\s]', s) and len(s) < 80: continue
        if re.match(r'^\d+[:\.]\d+', s): continue
        if re.fullmatch(r'\d+', s): continue
        if re.fullmatch(r'(куплет\s*\d*|припев(\s*\d*)?|бридж|аутро|интро|финал(\s*\d*)?|переход|проигрыш|вступление|\[.*?\]|\(.*?\))\.?', s, re.I): continue
        if re.fullmatch(r'[-=*_#]{3,}', s): continue
        out.append(s)
    return '\n'.join(out)

def diff(reftext, asrtext):
    reftext = ref_clean(reftext)
    aw_all = re.sub(r'[^\wа-яё\s-]', ' ', asrtext, flags=re.I).split()
    cyr, noise, tl = [], 0, 0
    for w in aw_all:
        n = norm(w)
        if not n: continue
        if re.search(r'[а-яё]', w.lower()):
            cyr.append(n)
        elif re.search(r'[a-z]', w.lower()) and len(n) >= 3:
            # латиница — обратная транслитерация (ASR часто romanизирует русский вокал)
            tw = norm(translit(n))
            if re.fullmatch(r'[а-я]+', tw):
                cyr.append(tw); tl += 1
            else:
                noise += 1
        else:
            noise += 1
    rw = [norm(x) for x in re.sub(r'[^\wа-яё\s-]', ' ', reftext, flags=re.I).split()]
    rw = [x for x in rw if x]
    sm = difflib.SequenceMatcher(None, rw, cyr, autojunk=False)
    mis, hit = [], 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        ref = ' '.join(rw[i1:i2]); asr = ' '.join(cyr[j1:j2])
        if tag == 'equal':
            hit += i2 - i1
        elif tag in ('replace', 'delete', 'insert'):
            typ = tag
            if tag == 'replace' and len(ref.split()) <= 2 and len(asr.split()) <= 2 and ref and asr:
                m = difflib.SequenceMatcher(None, ref, asr).ratio()
                typ = 'близко (ASR-неоднозначность)' if m >= 0.6 else 'замена'
            mis.append({'тип': typ, 'в_тексте': ref, 'в_аудио': asr,
                        'контекст_текста': ' '.join(rw[max(0, i1-6):i2+6])})
    cover = round(100 * hit / max(1, len(rw)), 1)
    noise_pct = round(100 * noise / max(1, noise + len(cyr)), 1)
    return cover, len(rw), len(cyr), mis, noise_pct, tl

def song(drive_id, ref_file, name):
    stem = re.sub(r'[^\w-]', '_', name)[:40]
    src = download(drive_id, stem + ('.mp4' if '.mp4' not in stem else ''))
    cs = chunks(src, stem)
    parts, filtered = asr_all(cs)
    asrtext = ' '.join(p for p in parts if p)
    ref = open(ref_file, encoding='utf-8').read()
    cover, nref, nasr, mis, noise_pct, tl = diff(ref, asrtext)
    rec = {
        'песня': name, 'эталон': os.path.basename(ref_file),
        'аудио': os.path.basename(src), 'кусков': len(cs),
        'слов_в_тексте': nref, 'слов_в_аудио': nasr,
        'совпадение_слов_%': cover,
        'asr_шум_%': noise_pct,
        'кусков_фильтр': filtered,
        'слов_из_транслита': tl,
        'расхождений': len(mis), 'реестр': mis,
        'asr_дамп': asrtext[:4000],
    }
    if cover < 45:
        rec['вердикт'] = 'СВЕРКА НЕДОСТОВЕРНА — ASR НЕ РАСПОЗНАЛ РУССКИЙ ВОКАЛ (перевод/транслит), нужен человеческий прослух или другой ASR'
    elif cover >= 92 and len(mis) <= 6:
        rec['вердикт'] = 'СОВПАДАЕТ'
    elif cover >= 80:
        rec['вердикт'] = 'СОВПАДАЕТ С ОГОВОРКАМИ'
    else:
        rec['вердикт'] = 'РАСХОЖДЕНИЯ ТРЕБУЮТ РАЗБОРА'
    os.makedirs(BASE, exist_ok=True)
    FR = f" · КУСКОВ ПРОПУЩЕНО ФИЛЬТРОМ ASR: {filtered}" if filtered else ""
    json.dump(rec, open(f'{BASE}/{stem}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(f'{BASE}/{stem}.md', 'w', encoding='utf-8') as f:
        f.write(f"# {name} · ТЕКСТ ↔ ЗВУЧАНИЕ\n\n- Эталон: {rec['эталон']}\n- Аудио: {rec['аудио']} ({rec['кусков']} кусков × 30 с)\n- Слов в тексте: {nref} · в аудио (ASR, кириллица+транслит): {nasr} · из транслита: {tl} · ASR-шум: {noise_pct}%{FR}\n- **Совпадение слов: {cover}%**\n- **Вердикт: {rec['вердикт']}**\n\n## Реестр расхождений ({len(mis)})\n\n| № | Тип | В написанном | В аудио (ASR) | Контекст |\n|---|---|---|---|---|\n")
        for i, m in enumerate(mis[:60], 1):
            f.write(f"| {i} | {m['тип']} | {m['в_тексте'] or '—'} | {m['в_аудио'] or '—'} | {m['контекст_текста'][:70]} |\n")
        f.write("\nASR-дамп (начало):\n\n> " + asrtext[:900].replace('\n', ' ') + "\n")
    print(f"{name}: {cover}% · расхождений {len(mis)} · {rec['вердикт']} · кусков {len(cs)}")
    return rec

if __name__ == '__main__':
    if sys.argv[1] == 'song':
        song(sys.argv[2], sys.argv[3], sys.argv[4])

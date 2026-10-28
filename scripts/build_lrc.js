#!/usr/bin/env node
'use strict';
/* ============================================================
   КАРАОКЕ МЕЧТЫ 2.0 — генератор/валидатор базовых меток lrc/
   Этап 1 дорожной карты: метки живут в репозитории
   (karaoke/lrc/<id>.lrc), а не только в localStorage.

   Режимы:
     node scripts/build_lrc.js            — пересобрать lrc/ из songs.js
     node scripts/build_lrc.js --check    — сверить lrc/ с songs.js (CI)

   Базовые метки — честная эвристика (вес строки = её длине,
   интро 5 с, хвост 4 с), помечены как «базовые»: тап-синхронизация
   в «Синхро» перезаписывает их локально. Канон: тексты не трогаем,
   время — только производное от текста.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KARA = path.join(ROOT, 'karaoke');

// songs.js — браузерный скрипт (window.SONGS = ...), даём ему фейковое окно.
global.window = {};
require(path.join(KARA, 'songs.js'));
const SONGS = global.window.SONGS;
if (!SONGS || !SONGS.length) { console.error('songs.js не отдал песен'); process.exit(1); }

const INTRO = 5.0; // сек до первой строки
const TAIL = 4.0;  // сек от последней строки до конца трека

function fmt(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}

function lrcFor(song) {
  const lines = [];
  song.sections.forEach(sec => sec.lines.forEach((text, li) => {
    lines.push({ label: li === 0 ? sec.label : null, text });
  }));
  const span = song.durSec - INTRO - TAIL;
  const weights = lines.map(l => l.text.length + 8); // длина + пауза
  const wsum = weights.reduce((a, b) => a + b, 0);
  const out = [];
  out.push('[ti:' + song.title + ']');
  out.push('[ar:RUVSON]');
  out.push('[al:КАРАОКЕ МЕЧТЫ 2.0 · ЧИСТОВИК]');
  out.push('[re:базовые метки — сгенерированы scripts/build_lrc.js, правятся тапом в «Синхро»]');
  out.push('[offset:0]');
  let acc = 0, lastLabel = null;
  lines.forEach((l, i) => {
    const t = INTRO + span * (acc / wsum);
    acc += weights[i];
    if (l.label && l.label !== lastLabel) { out.push('[label:' + l.label + ']'); lastLabel = l.label; }
    out.push('[' + fmt(t) + ']' + l.text);
  });
  return out.join('\n') + '\n';
}

const check = process.argv.includes('--check');
let fail = 0;
SONGS.forEach(song => {
  const file = path.join(KARA, 'lrc', song.id + '.lrc');
  const expected = lrcFor(song);
  if (check) {
    let actual = null;
    try { actual = fs.readFileSync(file, 'utf-8'); } catch (e) { /* нет файла */ }
    if (actual !== expected) {
      console.error('РАСХОЖДЕНИЕ: ' + path.relative(ROOT, file) + (actual == null ? ' (файла нет)' : ''));
      fail = 1;
    } else {
      console.log('OK: ' + path.relative(ROOT, file));
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, expected, 'utf-8');
    console.log('собран: ' + path.relative(ROOT, file) + ' · ' + song.title + ' · ' + expected.split('\n').filter(l => /\[\d{2}:\d{2}/.test(l)).length + ' меток');
  }
});

if (check) console.log(fail ? 'ПРОВАЛ: lrc/ не синхронны с songs.js — запусти node scripts/build_lrc.js' : 'LRC: метки синхронны с songs.js');
process.exit(fail);

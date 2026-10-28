/* ═══════════════════════════════════════════════════════════════════════════
   проба lrc-донора: разбор нашей лирки + обратная сборка (node --test)
   запуск: node --test tests/test_lrc_port.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const корень = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
await import(join(корень, 'js', 'lrc-core.js'));
const ЛРЦ = globalThis.window.__ЛРЦ;

test('донор на месте и запечатан', () => {
  assert.ok(ЛРЦ, '__ЛРЦ не встал в окно');
  assert.equal(ЛРЦ.версия(), 'lrc-ядро/0.1');
});

test('наша лирка n01 разбирается в честные строки', () => {
  const сырой = readFileSync(join(корень, 'minus', 'n01.lrc'), 'utf-8');
  const ожидаемоСтрок = сырой.split(/\r\n|\n|\r/).filter(с => /^\[\d{1,3}:\d{1,2}/.test(с.trim())).length;
  const разбор = ЛРЦ.разобрать(сырой);
  assert.equal(разбор.строки.length, ожидаемоСтрок, 'донор обязан видеть каждую метку файла');
  assert.ok(разбор.строки.length >= 30, 'строк неожиданно мало: ' + разбор.строки.length);
  assert.equal(разбор.теги.ti, 'Начать сначала');
  assert.equal(разбор.теги.ar, 'RUVSON');
  const первая = разбор.строки[0];
  assert.equal(первая.времяМс, 5000, 'первая метка 00:05.00 → 5000 мс');
  assert.ok(первая.текст.includes('туман'), 'первая строка про туман');
  /* порядок сохранён: каждая следующая метка не меньше предыдущей */
  for (let i = 1; i < разбор.строки.length; i++) {
    assert.ok(разбор.строки[i].времяМс >= разбор.строки[i - 1].времяМс, 'порядок меток нарушен на ' + i);
  }
});

test('обратная сборка: разобрали → собрали → разобрали, строки те же', () => {
  const сырой = readFileSync(join(корень, 'minus', 'n01.lrc'), 'utf-8');
  const разбор1 = ЛРЦ.разобрать(сырой);
  const текст2 = ЛРЦ.собратьLRC(разбор1.строки.map(с => ({ времяМс: с.времяМс, текст: с.текст })));
  const разбор2 = ЛРЦ.разобрать(текст2);
  assert.equal(разбор2.строки.length, разбор1.строки.length);
  for (let i = 0; i < разбор1.строки.length; i++) {
    assert.equal(разбор2.строки[i].времяМс, разбор1.строки[i].времяМс);
    assert.equal(разбор2.строки[i].текст, разбор1.строки[i].текст);
  }
});

test('честные русские отказы донора', () => {
  assert.throws(() => ЛРЦ.разобрать(42), TypeError);
  assert.throws(() => ЛРЦ.разобрать('[05:70]секунды больше 59'), RangeError);
});

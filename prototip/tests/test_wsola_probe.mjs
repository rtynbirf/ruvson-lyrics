/* ═══════════════════════════════════════════════════════════════════════════
   проба wsola-донора: синус 440 Гц ×2 по времени, частота стоит
   запуск: node --test tests/test_wsola_probe.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const корень = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
await import(join(корень, 'js', 'wsola-core.js'));
await import(join(корень, 'js', 'pitch-core.js'));
const ВСОЛА = globalThis.window.__ВСОЛА;

function синус(герц, сек, чд) {
  const н = Math.floor(сек * чд);
  const х = new Float32Array(н);
  for (let i = 0; i < н; i++) х[i] = 0.5 * Math.sin(2 * Math.PI * герц * i / чд);
  return х;
}

function доминирующийГерц(х, чд) {
  /* грубая автокорреляция: пик времени задержки → частота */
  let лучший = 0, лучшаяКорр = -Infinity;
  for (let лаг = 2; лаг < Math.floor(чд / 50); лаг++) {
    let с = 0;
    for (let i = 0; i < х.length - лаг; i += 4) с += х[i] * х[i + лаг];
    с /= (х.length - лаг);
    if (с > лучшаяКорр) { лучшаяКорр = с; лучший = лаг; }
  }
  return чд / лучший;
}

test('WSOLA ×0.5 растягивает вход вдвое по времени (коэффициент = скорость)', () => {
  const чд = 44100;
  const вход = синус(440, 1.2, чд);
  const выход = ВСОЛА.растянуть(вход, { коэффициент: 0.5, частотаСэмплов: чд });
  assert.ok(выход instanceof Float32Array);
  const ожидание = вход.length * 2; /* длительность_вых = длительность_вх / коэффициент */
  const разброс = Math.abs(выход.length - ожидание) / ожидание;
  assert.ok(разброс < 0.05, 'длина ' + выход.length + ' далеко от ' + ожидание);
});

test('WSOLA бережёт высоту: 440 Гц на входе ≈ 440 Гц на выходе (проба через YIN)', () => {
  const чд = 44100;
  const вход = синус(440, 1.2, чд);
  const выход = ВСОЛА.растянуть(вход, { коэффициент: 0.5, частотаСэмплов: чд });
  const питч = globalThis.window.__ПИТЧ.высота(выход.subarray(0, 4096), чд);
  assert.ok(питч, 'YIN должен услышать тон в растянутом выходе');
  assert.ok(Math.abs(питч.герц - 440) < 12, 'высота уползла: ' + питч.герц + ' (тон обязан стоять)');
});

test('детерминизм: два прогона — одинаковые байты', () => {
  const чд = 44100;
  const вход = синус(330, 0.7, чд);
  const а = ВСОЛА.растянуть(вход, { коэффициент: 1.5, частотаСэмплов: чд });
  const б = ВСОЛА.растянуть(вход, { коэффициент: 1.5, частотаСэмплов: чд });
  assert.equal(а.length, б.length);
  for (let i = 0; i < а.length; i++) assert.equal(а[i], б[i], 'расхождение на ' + i);
});

test('честные русские отказы', () => {
  const чд = 44100;
  assert.throws(() => ВСОЛА.растянуть('не массив', { коэффициент: 1 }), TypeError);
  assert.throws(() => ВСОЛА.растянуть(new Float32Array(1000), { коэффициент: 9 }), RangeError);
});

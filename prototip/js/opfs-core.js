/* ═══════════════════════════════════════════════════════════════════
   СИНГУЛЯР · js/opfs-core.js — порт канона opfs-core/0.1 для лиц дома
   (ПВ1 «СТОЙКОСТЬ», такт v11.22, С100, PAT №27)

   Порт 1:1 канона ДОКУМЕНТЫ/ТРЕКИ/КАРАОКЕ_СИНХРОН/src/opfs-core.mjs
   (28/28 узловых проб) в классический скрипт ES2019 — закон дома
   (Chromium 76). Ядро встаёт в window.__ОПФС: хранилище фонограмм
   без вытеснения (OPFS) + закрепление (Storage Persistence).

   Законы: 0 сети, 0 DOM-правок, 0 случайности, 0 записей без явного
   вызова, честные русские отказы, падение операции не роняет комнату.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__ОПФС) return; /* повторная вставка — молча, один канон */

  var ИМЯ = 'opfs-core/0.1';
  var ЗАКОН_ИД = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

  function ид_чист(ид) {
    return typeof ид === 'string' && ЗАКОН_ИД.test(ид) && ид.indexOf('..') === -1;
  }
  function честная_причина(е) {
    return (е && е.message) ? String(е.message) : String(е);
  }

  window.__ОПФС = (function создатьЯдро(опоры) {
    опоры = опоры || {};
    var хранилище = ('хранилище' in опоры)
      ? опоры.хранилище
      : ((navigator && navigator.storage) || null);
    var каталогИмя = (typeof опоры.каталог === 'string' && опоры.каталог) ? опоры.каталог : 'фонограммы';

    function возможности() {
      return {
        opfs: !!(хранилище && typeof хранилище.getDirectory === 'function'),
        persist: !!(хранилище && typeof хранилище.persist === 'function'),
        оценка: !!(хранилище && typeof хранилище.estimate === 'function'),
        каталог: каталогИмя
      };
    }

    async function постоянное() {
      try {
        if (!хранилище || typeof хранилище.persisted !== 'function') return null;
        var р = await хранилище.persisted();
        return р === true;
      } catch (е) { return null; }
    }

    async function закрепить() {
      try {
        if (!хранилище || typeof хранилище.persist !== 'function') {
          return { ок: false, причина: 'Storage API недоступен — закрепить нельзя' };
        }
        var уже = null;
        if (typeof хранилище.persisted === 'function') {
          try { уже = (await хранилище.persisted()) === true; } catch (е) { уже = null; }
        }
        if (уже === true) return { ок: true, уже: true };
        var р = await хранилище.persist();
        return { ок: true, уже: false, результат: р === true };
      } catch (е) {
        return { ок: false, причина: 'закрепление не прошло: ' + честная_причина(е) };
      }
    }

    async function каталог() {
      var корень = await хранилище.getDirectory();
      return await корень.getDirectoryHandle(каталогИмя, { create: true });
    }

    async function байты(данные) {
      if (данные instanceof Uint8Array) return данные;
      if (typeof ArrayBuffer !== 'undefined' && данные instanceof ArrayBuffer) return new Uint8Array(данные);
      if (typeof Blob !== 'undefined' && данные instanceof Blob) return new Uint8Array(await данные.arrayBuffer());
      if (typeof данные === 'string') {
        if (typeof TextEncoder === 'undefined') throw new Error('TextEncoder недоступен — строку не закодировать');
        return new TextEncoder().encode(данные);
      }
      throw new Error('данные не распознаны: жду Uint8Array, ArrayBuffer, Blob или строку');
    }

    async function положить(ид, данные) {
      try {
        if (!ид_чист(ид)) {
          return { ок: false, причина: 'ид не проходит закон (ASCII буквы/цифры/._-, 1..120, без «..»): ' + String(ид).slice(0, 40) };
        }
        if (!хранилище || typeof хранилище.getDirectory !== 'function') {
          return { ок: false, причина: 'OPFS недоступен — положить нельзя' };
        }
        var б = await байты(данные);
        var кат = await каталог();
        var ф = await кат.getFileHandle(ид, { create: true });
        if (typeof ф.createWritable !== 'function') {
          return { ок: false, причина: 'запись в OPFS недоступна (createWritable нет)' };
        }
        var п = await ф.createWritable();
        await п.write(б);
        await п.close();
        return { ок: true, размер: б.byteLength };
      } catch (е) {
        return { ок: false, причина: 'положить не вышло: ' + честная_причина(е) };
      }
    }

    async function взять(ид) {
      try {
        if (!ид_чист(ид)) throw new Error('ид не проходит закон: ' + String(ид).slice(0, 40));
        if (!хранилище || typeof хранилище.getDirectory !== 'function') return null;
        var кат = await каталог();
        var ф = await кат.getFileHandle(ид, { create: false });
        var файл = await ф.getFile();
        if (typeof Blob === 'function' && typeof файл.arrayBuffer === 'function' && опоры.вернутьБлоб !== false) {
          return new Blob([await файл.arrayBuffer()], { type: (файл && файл.type) || 'application/octet-stream' });
        }
        return new Uint8Array(await файл.arrayBuffer());
      } catch (е) {
        return null; /* нет файла / нет OPFS — честное «нет» */
      }
    }

    async function есть(ид) {
      try {
        if (!ид_чист(ид)) return false;
        if (!хранилище || typeof хранилище.getDirectory !== 'function') return false;
        var кат = await каталог();
        await кат.getFileHandle(ид, { create: false });
        return true;
      } catch (е) { return false; }
    }

    async function убрать(ид) {
      try {
        if (!ид_чист(ид)) return false;
        if (!хранилище || typeof хранилище.getDirectory !== 'function') return false;
        var кат = await каталог();
        await кат.removeEntry(ид);
        return true;
      } catch (е) { return false; }
    }

    async function список() {
      try {
        if (!хранилище || typeof хранилище.getDirectory !== 'function') return [];
        var кат = await каталог();
        var из = [];
        if (typeof кат.keys !== 'function') return [];
        var ход = кат.keys();
        while (true) {
          var шаг = await ход.next();
          if (шаг.done) break;
          var ключ = шаг.value;
          if (typeof ключ === 'string' && ид_чист(ключ)) из.push(ключ);
        }
        из.sort();
        return из;
      } catch (е) { return []; }
    }

    async function оценка() {
      try {
        if (!хранилище || typeof хранилище.estimate !== 'function') return null;
        var р = await хранилище.estimate();
        if (!р) return null;
        return { использование: р.usage == null ? null : Number(р.usage), квота: р.quota == null ? null : Number(р.quota) };
      } catch (е) { return null; }
    }

    return {
      ИМЯ: ИМЯ, возможности: возможности, постоянное: постоянное, закрепить: закрепить,
      положить: положить, взять: взять, есть: есть, убрать: убрать, список: список, оценка: оценка
    };
  })(/* опоры по умолчанию — navigator.storage берётся внутри */);
}());

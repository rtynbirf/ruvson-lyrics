'use strict';
/* ============================================================
   КАРАОКЕ МЕЧТЫ 2.0 — интерфейс и логика (app.js)
   Экраны: Библиотека · Сцена · Синхро · Пати · Голос.
   Счёт, эталон-контур, «Зелёный коридор», турнир вечера.
   ============================================================ */

(function () {
  const { $, $$, clamp, fmtTime, Store, toast, midiToName, freqToMidi,
    octFold, median, flattenLines, linesWithTimes, getTimings, setTimings,
    isSynced, toLRC, parseLRC, Transport, Pad, Mic } = window.KM;

  /* ---------- состояние ---------- */
  const state = {
    view: 'library',
    song: null,          // выбранная песня
    mode: Store.get('mode', 'friendly'),
    party: Store.get('party', { singers: [], active: false, results: [] })
  };

  const SINGER_COLORS = ['#ff2ec4', '#23e6ff', '#2bff88', '#ffc23e', '#ff4d6d', '#b18cff', '#7dffb2', '#ff8ac2'];

  function saveParty() { Store.set('party', state.party); }

  /* ============================================================
     БИБЛИОТЕКА
     ============================================================ */
  function bestOf(songId, mode) { return Store.get('best:' + songId + ':' + mode, null); }
  function corridorOf(songId) { return Store.get('corridor:' + songId, { offset: 0 }); }
  function setCorridor(songId, c) { Store.set('corridor:' + songId, c); }

  function renderLibrary() {
    const grid = $('#song-grid');
    grid.innerHTML = '';
    window.SONGS.forEach(song => {
      const synced = isSynced(song);
      const bf = bestOf(song.id, 'friendly'), bj = bestOf(song.id, 'judge');
      const cor = corridorOf(song.id);
      const nLines = flattenLines(song).length;
      const card = document.createElement('div');
      card.className = 'song-card';
      card.innerHTML =
        '<div class="num">НОМЕР ' + String(song.num).padStart(2, '0') + '</div>' +
        '<h3>' + song.title + '</h3>' +
        '<div class="meta"><span class="badge clean">ЧИСТОВИК</span>' +
        (synced ? '<span class="badge synced">СИНХРОН</span>' : '') +
        '<span>' + song.dur + ' · ' + nLines + ' строк</span></div>' +
        '<div class="card-stats">' +
        '<span>Дружелюбный: <b>' + (bf == null ? '—' : Math.round(bf)) + '</b></span>' +
        '<span>Судья: <b>' + (bj == null ? '—' : Math.round(bj)) + '</b></span>' +
        '<span>Коридор: <b>' + (cor.offset === 0 ? 'оригинал' : (cor.offset > 0 ? '+' : '') + cor.offset + ' пт') + '</b></span>' +
        '</div>' +
        '<div class="corridor-track"><div class="corridor-fill" style="width:' +
        Math.round((12 - Math.abs(cor.offset)) / 12 * 100) + '%"></div></div>';
      card.addEventListener('click', () => openSong(song));
      grid.appendChild(card);
    });
  }

  /* ============================================================
     СЦЕНА
     ============================================================ */
  function openSong(song) {
    state.song = song;
    renderStage();
    renderSync();
    showView('stage');
  }

  function sourceReady() {
    if (Transport.mode === 'synth') return true;
    return Transport.mode === 'file' && !!document.getElementById('audio').src;
  }

  function renderStage() {
    const song = state.song;
    if (!song) {
      $('#stage-root').innerHTML =
        '<div class="stage-empty panel">Сцена пуста.<br>Выбери песню в Библиотеке — и вектор получит поле.</div>';
      return;
    }
    const flat = linesWithTimes(song);
    const cor = corridorOf(song.id);
    const root = $('#stage-root');
    root.innerHTML =
      '<div class="stage-head">' +
      '<h2>№' + song.num + ' — ' + song.title + '</h2>' +
      '<a class="yt" href="' + song.youtube + '" target="_blank" rel="noopener">оригинал на YouTube · ' + song.dur + '</a>' +
      '</div>' +

      '<div class="panel transport-panel">' +
      '<div class="transport-row">' +
      '<button id="st-file" class="btn small">Минус из файла</button>' +
      '<input type="file" id="st-file-in" accept="audio/*" hidden>' +
      '<button id="st-synth" class="btn small' + (Transport.mode === 'synth' ? ' go' : '') + '">Синт-минус</button>' +
      '<button id="st-play" class="btn primary">Играть</button>' +
      '<button id="st-back3" class="btn small">−3 сек</button>' +
      '<button id="st-fwd3" class="btn small">+3 сек</button>' +
      '<span class="timecode" id="st-time">0:00.0</span>' +
      '<span class="hint" id="st-source"></span>' +
      '</div>' +
      '<div class="transpose-row">' +
      '<span>Тональность</span>' +
      '<input type="range" id="st-trans" min="-12" max="12" step="1" value="' + cor.offset + '" style="width:220px">' +
      '<span class="transpose-val" id="st-trans-val">' + (cor.offset === 0 ? 'оригинал' : (cor.offset > 0 ? '+' : '') + cor.offset + ' пт') + '</span>' +
      '<button id="st-trans-reset" class="btn small">В оригинал</button>' +
      '</div>' +
      '<div class="corridor-panel">' +
      '<span class="corridor-label">Зелёный коридор <span class="val" id="st-cor-val">' +
      (cor.offset === 0 ? 'открыт' : 'до оригинала: ' + Math.abs(cor.offset) + ' пт') + '</span></span>' +
      '<div class="corridor-track"><div class="corridor-fill" id="st-cor-fill" style="width:' +
      Math.round((12 - Math.abs(cor.offset)) / 12 * 100) + '%"></div></div>' +
      '<button id="st-cor-reset" class="btn small">Сброс</button>' +
      '</div>' +
      '</div>' +

      '<div class="lyrics-box" id="st-lyrics">' +
      (!isSynced(song)
        ? '<div class="panel hint" style="margin-bottom:14px">Строки ещё не синхронизированы. Зайди в <b>Синхро</b>, запусти трек и проставь метки пробелом — после этого заработают подсветка, отсчёт и счёт.</div>'
        : '') +
      '</div>' +
      '<div class="score-hud">' +
      '<span>Оценка <b class="big ' + (state.mode === 'judge' ? 'judge' : '') + '" id="sc-big">—</b></span>' +
      '<span>Строки <b id="sc-lines">0/0</b></span>' +
      '<span>Голос <b id="sc-voice">0%</b></span>' +
      '<span>Лучший (' + (state.mode === 'judge' ? 'судья' : 'друг') + ') <b id="sc-best">' +
      (bestOf(song.id, state.mode) == null ? '—' : Math.round(bestOf(song.id, state.mode))) + '</b></span>' +
      '<span id="sc-suggest" class="hint"></span>' +
      '<span style="margin-left:auto" class="mode-switch">' +
      '<button id="md-friend" class="' + (state.mode === 'friendly' ? 'active' : '') + '">Дружелюбный</button>' +
      '<button id="md-judge" class="' + (state.mode === 'judge' ? 'active judge' : '') + '">Судья</button>' +
      '</span>' +
      '<button id="st-mic" class="chip-btn">Микрофон: выкл</button>' +
      '</div>' +
      '<canvas id="pitch-canvas"></canvas>' +
      '<p class="hint" style="margin-top:10px">Счёт работает при включённом микрофоне: среда измеряет присутствие, устойчивость и близость к эталон-контуру. Возьми хорошую попытку — она станет эталоном для следующих. Звук с микрофона никуда не передаётся.</p>';

    // строки
    const box = $('#st-lyrics');
    const ref = Store.get('ref:' + song.id, null);
    flat.forEach((l, i) => {
      const div = document.createElement('div');
      div.className = 'lyrics-line';
      div.dataset.idx = i;
      let html = (l.label ? '<span class="sec-label">' + l.label + '</span>' : '');
      html += '<span class="txt">' + l.text + '</span>';
      if (ref && ref.lines[i] && ref.lines[i].dir) {
        html += '<span class="guide">' + (ref.lines[i].dir === 'up' ? '↑' : ref.lines[i].dir === 'down' ? '↓' : '→') + '</span>';
      }
      div.innerHTML = html;
      box.appendChild(div);
    });
    if (isSynced(song)) {
      const cd = document.createElement('div');
      cd.className = 'countdown'; cd.id = 'st-countdown'; cd.hidden = true;
      box.appendChild(cd);
    }

    // обработчики
    $('#st-file').addEventListener('click', () => $('#st-file-in').click());
    $('#st-file-in').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      await Transport.useFile(f);
      toast('Минус загружен: ' + f.name);
      updateStageMeta();
    });
    $('#st-synth').addEventListener('click', async () => {
      await Transport.useSynth();
      toast('Синт-минус включён: Am–F–C–G, 96 BPM. Транспонирование живое.');
      renderStage();
    });
    $('#st-play').addEventListener('click', async () => {
      if (!sourceReady()) { toast('Сначала выбери источник: файл или синт-минус', true); return; }
      if (!Transport.playing) Take.begin();
      Transport.toggle();
    });
    $('#st-back3').addEventListener('click', () => { Take.abort(); Transport.seek(Transport.time() - 3); });
    $('#st-fwd3').addEventListener('click', () => { Take.abort(); Transport.seek(Transport.time() + 3); });
    $('#st-trans').addEventListener('input', e => {
      const v = +e.target.value;
      Transport.setSemitones(v);
      $('#st-trans-val').textContent = v === 0 ? 'оригинал' : (v > 0 ? '+' : '') + v + ' пт';
    });
    $('#st-trans-reset').addEventListener('click', () => {
      $('#st-trans').value = 0; Transport.setSemitones(0);
      $('#st-trans-val').textContent = 'оригинал';
    });
    $('#st-cor-reset').addEventListener('click', () => {
      setCorridor(song.id, { offset: 0 });
      applyCorridor(); toast('Коридор сброшен: поём в оригинале');
    });
    $('#md-friend').addEventListener('click', () => setMode('friendly'));
    $('#md-judge').addEventListener('click', () => setMode('judge'));
    $('#st-mic').addEventListener('click', toggleMic);

    // drag&drop файла на лирику
    box.addEventListener('dragover', e => { e.preventDefault(); });
    box.addEventListener('drop', async e => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /audio|video/.test(f.type) || (f && /\.(mp3|wav|ogg|m4a|flac|opus)$/i.test(f.name))) {
        await Transport.useFile(f);
        toast('Минус загружен: ' + f.name);
        updateStageMeta();
      }
    });

    applyCorridor();
    updateStageMeta();
    updateScoreHud();
  }

  function setMode(m) {
    state.mode = m; Store.set('mode', m);
    if (state.view === 'stage') renderStage();
  }

  function applyCorridor() {
    if (!state.song) return;
    const off = corridorOf(state.song.id).offset;
    Transport.setSemitones(off);
    const s = $('#st-trans');
    if (s) { s.value = off; $('#st-trans-val').textContent = off === 0 ? 'оригинал' : (off > 0 ? '+' : '') + off + ' пт'; }
  }

  function updateStageMeta() {
    const el = $('#st-source');
    if (el) {
      el.textContent = Transport.mode === 'synth'
        ? 'источник: синт-минус'
        : (document.getElementById('audio').src ? 'источник: ' + (Transport.fileName || 'файл') : 'источник не выбран');
    }
    const micBtn = $('#st-mic');
    if (micBtn) { micBtn.textContent = 'Микрофон: ' + (Mic.on ? 'вкл' : 'выкл'); micBtn.classList.toggle('on', Mic.on); }
  }

  async function toggleMic() {
    if (Mic.on) { Mic.stop(); }
    else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Микрофон недоступен: нужен https или localhost (file:// не даёт доступ). Запусти: python3 -m http.server', true);
        return;
      }
      try { await Mic.start(); }
      catch (e) { toast('Микрофон не открылся: ' + e.message, true); return; }
    }
    updateStageMeta();
  }

  /* ============================================================
     СЧЁТ И ЭТАЛОН
     ============================================================ */
  const Take = {
    active: false,
    acc: null,          // Map idx -> {frames, voiced, semis[]}
    curIdx: -2,
    cur: null,
    voicedTotal: 0,
    framesTotal: 0,

    begin() {
      this.active = true;
      this.acc = new Map();
      this.curIdx = -2;
      this.cur = null;
      this.voicedTotal = 0; this.framesTotal = 0;
    },
    abort() { this.active = false; this.cur = null; },
    feed(t, idx, pitch) {
      if (!this.active) return;
      if (idx !== this.curIdx) {
        this.closeCur();
        this.curIdx = idx;
        this.cur = { frames: 0, voiced: 0, semis: [] };
      }
      this.cur.frames++;
      this.framesTotal++;
      if (pitch && pitch.freq > 0 && pitch.conf >= (state.mode === 'judge' ? 0.5 : 0.35)) {
        this.cur.voiced++;
        this.voicedTotal++;
        this.cur.semis.push(freqToMidi(pitch.freq));
      }
    },
    closeCur() {
      if (this.cur && this.curIdx >= 0 && this.cur.frames > 0) {
        this.acc.set(this.curIdx, this.cur);
      }
      this.cur = null;
    },
    data() {
      this.closeCur();
      return this.acc;
    }
  };

  function currentLineIdx(t, flat) {
    let idx = -1;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i].start != null && flat[i].start <= t) idx = i; else break;
    }
    return idx;
  }

  function lineScore(flatIdx, a, flat, ref, off) {
    const gate = state.mode === 'judge' ? 0.5 : 0.35;
    const p = a.frames ? a.voiced / a.frames : 0;
    let s = 0, r = 0, hasR = false;
    if (a.semis.length >= 3) {
      const m = median(a.semis);
      const dev = a.semis.map(x => Math.abs(octFold(x - m)));
      const mad = median(dev);
      s = 1 - clamp(mad / (state.mode === 'judge' ? 3.5 : 5), 0, 1);
      if (ref && ref.lines[flatIdx] && typeof ref.lines[flatIdx].m === 'number') {
        const expected = ref.lines[flatIdx].m + (off - ref.offset);
        const delta = Math.abs(octFold(m - expected));
        r = 1 - clamp(delta / (state.mode === 'judge' ? 5 : 7), 0, 1);
        hasR = true;
      }
    }
    const w = state.mode === 'judge' ? [0.45, 0.35, 0.20] : [0.55, 0.30, 0.15];
    const wNoR = state.mode === 'judge' ? [0.56, 0.44] : [0.62, 0.38];
    const raw01 = hasR
      ? w[0] * p + w[1] * s + w[2] * r
      : wNoR[0] * p + wNoR[1] * s;
    let sc = 100 * raw01;
    if (state.mode === 'friendly') sc = 100 * Math.sqrt(clamp(sc, 0, 100) / 100);
    return sc;
  }

  function finalizeTake() {
    if (!Take.active) return;
    Take.active = false;
    const song = state.song;
    if (!song) return;
    const flat = linesWithTimes(song);
    const acc = Take.data();
    const off = Transport.semitones;
    const ref = Store.get('ref:' + song.id, null);

    const included = [];
    let sumW = 0, sumS = 0;
    for (let i = 0; i < flat.length; i++) {
      const a = acc.get(i);
      if (!a) continue;
      if (a.frames < 8) continue;
      let sc;
      if (a.voiced < 3) sc = 0;                    // строка была — голоса не было
      else sc = lineScore(i, a, flat, ref, off);
      const w = Math.max(a.frames, 1);
      included.push({ i, sc, w, a });
      sumW += w; sumS += sc * w;
    }
    if (!included.length) { toast('Попытка слишком короткая для счёта', true); return; }

    const score = sumS / sumW;
    const coverage = included.length / flat.filter(l => l.start != null).length;
    const voicePct = Take.framesTotal ? Math.round(100 * Take.voicedTotal / Take.framesTotal) : 0;

    // лучший результат
    const key = 'best:' + song.id + ':' + state.mode;
    const prevBest = Store.get(key, null);
    const full = coverage >= 0.6;
    if (full && (prevBest == null || score > prevBest)) Store.set(key, score);

    // эталон-контур: лучшая по покрытию попытка
    if (full && (!ref || coverage >= (ref.coverage || 0))) {
      const lines = [];
      for (let i = 0; i < flat.length; i++) {
        const a = acc.get(i);
        if (a && a.semis.length >= 6) {
          const m = median(a.semis);
          const h1 = median(a.semis.slice(0, Math.ceil(a.semis.length / 2)));
          const h2 = median(a.semis.slice(Math.ceil(a.semis.length / 2)));
          lines[i] = { m, dir: h2 - h1 > 0.7 ? 'up' : h2 - h1 < -0.7 ? 'down' : 'hold' };
        } else lines[i] = null;
      }
      Store.set('ref:' + song.id, { offset: off, coverage, lines });
    }

    // Зелёный коридор: среда сужается, когда вектор дорос
    const th = state.mode === 'judge' ? 65 : 75;
    let corMsg = '';
    if (full) {
      const cor = corridorOf(song.id);
      if (score >= th && cor.offset !== 0) {
        cor.offset += cor.offset > 0 ? -1 : 1;
        setCorridor(song.id, cor);
        applyCorridor();
        corMsg = ' · Зелёный коридор сузился: ' +
          (cor.offset === 0 ? 'ОРИГИНАЛ!' : Math.abs(cor.offset) + ' пт до оригинала');
      }
    }

    // подсказка по диапазону (Голосовой комфорт)
    const v = Store.get('voice', null);
    let sug = '';
    if (v && Take.voicedTotal > 40) {
      const allSemis = [];
      acc.forEach(a => allSemis.push(...a.semis));
      const m = median(allSemis);
      if (v.low && m < v.low - 1) sug = 'Совет: голос ниже комфортного — попробуй +' + Math.ceil(v.low - m) + ' пт';
      else if (v.high && m > v.high + 1) sug = 'Совет: голос выше комфортного — попробуй −' + Math.ceil(m - v.high) + ' пт';
    }

    // пати
    if (state.party.active && state.party.singers.length && full) {
      const cur = currentSinger();
      state.party.results.push({
        singer: cur, song: '№' + song.num + ' ' + song.title,
        score: Math.round(score), mode: state.mode, ts: Date.now()
      });
      saveParty();
      if (state.view === 'party') renderParty();
    }

    toast('Попытка: ' + Math.round(score) + ' / 100' +
      (full ? ' · покрытие ' + Math.round(coverage * 100) + '%' : ' · частичная (' + Math.round(coverage * 100) + '%), в зачёт не идёт') +
      corMsg);
    const sugEl = $('#sc-suggest');
    if (sugEl) sugEl.textContent = sug;
    updateScoreHud(score);
  }

  function updateScoreHud(preview) {
    const song = state.song;
    if (!song || !$('#sc-big')) return;
    if (typeof preview === 'number') $('#sc-big').textContent = Math.round(preview);
    const b = bestOf(song.id, state.mode);
    $('#sc-best').textContent = b == null ? '—' : Math.round(b);
  }

  /* ============================================================
     РАМКА-ЦИКЛ (тик сцены)
     ============================================================ */
  let pitchTrail = [];

  function tick() {
    requestAnimationFrame(tick);
    const playing = Transport.playing;
    const t = Transport.time();

    if (state.view === 'stage' && state.song) {
      const timeEl = $('#st-time');
      if (timeEl) timeEl.textContent = fmtTime(t) + (Transport.mode === 'file' ? ' / ' + fmtTime(Transport.duration()) : '');
      const playBtn = $('#st-play');
      if (playBtn) playBtn.textContent = playing ? 'Пауза' : 'Играть';

      const flat = linesWithTimes(state.song);
      const synced = isSynced(state.song);
      let idx = -1;
      if (synced && playing) idx = currentLineIdx(t, flat);

      const box = $('#st-lyrics');
      const lineEls = $$('.lyrics-line', box);
      lineEls.forEach((el, i) => {
        el.classList.toggle('current', i === idx);
        el.classList.toggle('past', idx >= 0 && i < idx);
        el.classList.toggle('next1', i === idx + 1);
        const fill = $('.fill', el);
        if (fill) fill.remove();
        if (i === idx) {
          const l = flat[i];
          if (l.start != null && l.end != null && l.end > l.start) {
            const p = clamp((t - l.start) / (l.end - l.start), 0, 1);
            const f = document.createElement('div');
            f.className = 'fill'; f.style.width = (p * 100) + '%';
            el.appendChild(f);
          }
        }
      });
      if (idx >= 0 && lineEls[idx]) {
        const top = lineEls[idx].offsetTop - box.clientHeight * 0.35;
        if (Math.abs(box.scrollTop - top) > 8) box.scrollTop = top;
      }

      // отсчёт перед первой строкой
      const cd = $('#st-countdown');
      if (cd) {
        const first = flat.find(l => l.start != null);
        if (playing && first && t < first.start && first.start - t <= 3.6) {
          cd.hidden = false;
          cd.textContent = Math.max(1, Math.ceil(first.start - t));
        } else cd.hidden = true;
      }

      // микрофон и счёт
      if (Mic.on) {
        const pitch = Mic.read();
        if (pitch.freq > 0) pitchTrail.push({ t, midi: freqToMidi(pitch.freq), conf: pitch.conf });
        if (pitchTrail.length > 700) pitchTrail.splice(0, pitchTrail.length - 700);
        drawPitch();
        if (playing && synced && Take.active) {
          // скормить счёт: активная строка с окном
          let feedIdx = -1;
          for (let i = 0; i < flat.length; i++) {
            const l = flat[i];
            if (l.start != null && t >= l.start - 0.1 && t < (l.end != null ? l.end + 0.25 : l.start + 10)) { feedIdx = i; break; }
          }
          if (feedIdx >= 0) Take.feed(t, feedIdx, pitch);
          const voiceEl = $('#sc-voice');
          if (voiceEl && Take.framesTotal) voiceEl.textContent = Math.round(100 * Take.voicedTotal / Take.framesTotal) + '%';
        }
      } else {
        pitchTrail.length = 0;
        drawPitch();
      }

      // конец трека
      if (playing && synced) {
        const last = flat[flat.length - 1];
        if (Transport.mode === 'file') {
          const el = document.getElementById('audio');
          if (el.ended) { Transport.pause(); finalizeTake(); }
        } else if (last.end != null && t > last.end + 1.5) {
          Transport.pause(); finalizeTake();
        }
      }
    }

    if (state.view === 'voice') {
      const live = $('#voice-live');
      if (live && Mic.on) {
        const p = Mic.read();
        live.textContent = p.freq > 0 ? midiToName(Math.round(freqToMidi(p.freq))) : '—';
      }
    }

    if (state.view === 'sync') {
      const el = $('#sync-time');
      if (el) el.textContent = fmtTime(t);
      const pb = $('#sync-play');
      if (pb) pb.textContent = playing ? 'Пауза' : 'Играть / Пауза';
    }
  }

  function drawPitch() {
    const cv = document.getElementById('pitch-canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!pitchTrail.length) return;
    const now = Transport.time();
    const t0 = now - 6;
    const pts = pitchTrail.filter(p => p.t >= t0);
    if (!pts.length) return;
    const mids = pts.map(p => p.midi);
    let lo = Math.min(...mids) - 2, hi = Math.max(...mids) + 2;
    if (hi - lo < 10) { const c = (hi + lo) / 2; lo = c - 5; hi = c + 5; }
    g.strokeStyle = 'rgba(43,255,136,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    let started = false;
    pts.forEach(p => {
      const x = (p.t - t0) / 6 * W;
      const y = H - (p.midi - lo) / (hi - lo) * H;
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    });
    g.shadowColor = 'rgba(43,255,136,0.8)'; g.shadowBlur = 8;
    g.stroke();
    g.shadowBlur = 0;
  }

  /* ============================================================
     СИНХРО
     ============================================================ */
  let syncIdx = 0;

  function renderSync() {
    const song = state.song;
    const holder = $('#sync-list');
    const hint = $('#sync-song-hint');
    if (!song) {
      holder.innerHTML = '<p class="hint">Выбери песню в Библиотеке.</p>';
      hint.textContent = '';
      return;
    }
    hint.textContent = 'Песня: №' + song.num + ' — ' + song.title + '. Источник звука: ' +
      (Transport.mode === 'synth' ? 'синт-минус' : (document.getElementById('audio').src ? 'файл' : 'не выбран (иди на Сцену)'));
    const flat = linesWithTimes(song);
    const tm = getTimings(song.id);
    const starts = (tm && tm.starts) || [];
    // курсор: первая непроставленная
    syncIdx = starts.length ? starts.findIndex(s => typeof s !== 'number') : 0;
    if (syncIdx < 0) syncIdx = flat.length;
    holder.innerHTML = '';
    flat.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'sync-line' + (i === syncIdx ? ' current' : '');
      row.dataset.idx = i;
      const has = typeof starts[i] === 'number';
      row.innerHTML =
        '<span class="ts' + (has ? '' : ' unset') + '">' + (has ? fmtTime(starts[i]) : '—:—.—') + '</span>' +
        '<span>' + (l.label ? '<b style="color:var(--magenta);font-size:11px;letter-spacing:.15em;margin-right:8px">' + l.label + '</b>' : '') +
        l.text + '</span>';
      row.addEventListener('click', () => { syncIdx = i; renderSync(); });
      holder.appendChild(row);
    });
    updateSyncProgress();
  }

  function updateSyncProgress() {
    const song = state.song;
    if (!song) return;
    const tm = getTimings(song.id);
    const starts = (tm && tm.starts) || [];
    const done = starts.filter(s => typeof s === 'number').length;
    const total = flattenLines(song).length;
    $('#sync-progress').textContent = done + ' / ' + total;
  }

  function syncTap() {
    const song = state.song;
    if (!song) { toast('Выбери песню в Библиотеке', true); return; }
    if (!sourceReady()) { toast('Сначала выбери источник звука на Сцене', true); return; }
    if (!Transport.playing) { Take.abort(); Transport.play(); }
    const flat = flattenLines(song);
    if (syncIdx >= flat.length) { toast('Все строки уже проставлены — сохраняй', false); return; }
    const tm = getTimings(song.id) || { starts: new Array(flat.length).fill(null) };
    if (!tm.starts || tm.starts.length !== flat.length) tm.starts = new Array(flat.length).fill(null);
    tm.starts[syncIdx] = Math.max(0, Transport.time());
    setTimings(song.id, tm);
    syncIdx++;
    renderSync();
  }

  function syncUndo() {
    const song = state.song;
    if (!song) return;
    const flat = flattenLines(song);
    const tm = getTimings(song.id) || { starts: new Array(flat.length).fill(null) };
    if (!tm.starts || tm.starts.length !== flat.length) tm.starts = new Array(flat.length).fill(null);
    syncIdx = Math.min(syncIdx, flat.length);
    if (syncIdx > 0) syncIdx--;
    tm.starts[syncIdx] = null;
    setTimings(song.id, tm);
    renderSync();
  }

  function syncSave() {
    const song = state.song;
    if (!song) return;
    const flat = flattenLines(song);
    const tm = getTimings(song.id);
    const done = tm && tm.starts ? tm.starts.filter(s => typeof s === 'number').length : 0;
    toast('Синхронизация сохранена: ' + done + ' / ' + flat.length + ' строк');
    renderLibrary();
  }

  function syncExport() {
    const song = state.song;
    if (!song) return;
    const tm = getTimings(song.id);
    const starts = (tm && tm.starts) || [];
    if (!starts.some(s => typeof s === 'number')) { toast('Пока нет ни одной метки', true); return; }
    const lrc = toLRC(song, starts);
    downloadBlob(lrc, song.num + '_' + song.title.replace(/[\\/:*?"<>|]/g, '') + '.lrc', 'text/plain');
  }

  function syncImport(file) {
    const song = state.song;
    if (!song) return;
    const reader = new FileReader();
    reader.onload = () => {
      const times = parseLRC(String(reader.result));
      const flat = flattenLines(song);
      if (!times.length) { toast('В файле не найдено меток времени', true); return; }
      if (times.length !== flat.length) {
        toast('Меток ' + times.length + ', а строк ' + flat.length + ' — импорт отклонён', true);
        return;
      }
      setTimings(song.id, { starts: times.map(x => x.t), audioName: null });
      toast('Импортировано: ' + times.length + ' строк');
      renderSync(); renderLibrary();
    };
    reader.readAsText(file, 'utf-8');
  }

  function downloadBlob(text, name, type) {
    const b = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* ============================================================
     ПАТИ
     ============================================================ */
  function currentSinger() {
    const p = state.party;
    if (!p.singers.length) return null;
    return p.singers[p.results.length % p.singers.length].name;
  }

  function renderParty() {
    const p = state.party;
    const holders = $('#party-singers');
    holders.innerHTML = '';
    if (!p.singers.length) holders.innerHTML = '<p class="hint">Пока никого. Добавь первого певца.</p>';
    const cur = currentSinger();
    p.singers.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'singer-row';
      row.innerHTML =
        '<span class="singer-dot" style="background:' + s.color + ';color:' + s.color + '"></span>' +
        '<span class="who">' + s.name + '</span>' +
        (p.active && cur === s.name ? '<span class="badge synced">сейчас поёт</span>' : '') +
        '<span class="acts"><button class="btn small" data-del="' + i + '">Убрать</button></span>';
      holders.appendChild(row);
    });
    $$('button[data-del]', holders).forEach(b =>
      b.addEventListener('click', () => {
        p.singers.splice(+b.dataset.del, 1);
        saveParty(); renderParty();
      }));

    const tg = $('#party-toggle');
    tg.textContent = 'Режим пати: ' + (p.active ? 'вкл' : 'выкл');
    tg.classList.toggle('on', p.active);

    const board = $('#party-board');
    if (!p.results.length) { board.innerHTML = '<p class="hint">Зал славы пуст. Пой на Сцене при включённом режиме пати.</p>'; return; }
    const rows = p.results.slice().sort((a, b) => b.score - a.score);
    board.innerHTML = '<table class="lb"><tr><th>#</th><th>Певец</th><th>Песня</th><th>Режим</th><th>Счёт</th></tr>' +
      rows.map((r, i) =>
        '<tr' + (i === 0 ? ' class="top"' : '') + '><td>' + (i + 1) + '</td><td>' + r.singer +
        '</td><td>' + r.song + '</td><td>' + (r.mode === 'judge' ? 'судья' : 'друг') + '</td>' +
        '<td class="score">' + r.score + '</td></tr>').join('') +
      '</table>';
  }

  /* ============================================================
     ГОЛОС
     ============================================================ */
  const VoiceTest = {
    step: 0, listening: false, data: { free: [], low: [], high: [] },
    steps: [
      { key: 'free', label: 'как удобно' },
      { key: 'low', label: 'самый низкий комфорт' },
      { key: 'high', label: 'самый высокий комфорт' }
    ]
  };

  function renderVoice() {
    const v = Store.get('voice', null);
    const el = $('#voice-result');
    if (!v) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div class="voice-stat"><b>' + midiToName(Math.round(v.free)) + '</b>свободный центр</div>' +
      '<div class="voice-stat"><b>' + midiToName(Math.round(v.low)) + '</b>комфортный низ</div>' +
      '<div class="voice-stat"><b>' + midiToName(Math.round(v.high)) + '</b>комфортный верх</div>' +
      '<div class="voice-stat"><b>' + (v.high - v.low) + '</b>полутонов диапазона</div>';
  }

  async function voiceRun() {
    if (!Mic.on) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Микрофон недоступен: нужен https или localhost', true); return;
      }
      try { await Mic.start(); } catch (e) { toast('Микрофон не открылся: ' + e.message, true); return; }
      updateStageMeta();
    }
    const btn = $('#voice-start');
    btn.disabled = true;
    VoiceTest.data = { free: [], low: [], high: [] };
    for (let s = 0; s < VoiceTest.steps.length; s++) {
      const st = VoiceTest.steps[s];
      toast('Тяни «а-а-а»: ' + st.label + ' — пошёл замер');
      const t0 = performance.now();
      while (performance.now() - t0 < 3200) {
        const p = Mic.read();
        if (p.freq > 0 && p.conf > 0.3) VoiceTest.data[st.key].push(freqToMidi(p.freq));
        await new Promise(r => setTimeout(r, 60));
      }
    }
    const d = VoiceTest.data;
    if (d.free.length < 10 || d.low.length < 10 || d.high.length < 10) {
      toast('Замер не удался: микрофон молчал. Попробуй ещё раз, громче', true);
      btn.disabled = false; return;
    }
    const v = {
      free: median(d.free), low: median(d.low), high: median(d.high), ts: Date.now()
    };
    if (v.high < v.low) { const tmp = v.high; v.high = v.low; v.low = tmp; }
    Store.set('voice', v);
    toast('Диапазон записан: ' + midiToName(Math.round(v.low)) + ' – ' + midiToName(Math.round(v.high)));
    renderVoice();
    btn.disabled = false;
  }

  /* ============================================================
     ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ И ШАПКА
     ============================================================ */
  function showView(v) {
    state.view = v;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach(el => el.hidden = (el.id !== 'view-' + v));
    if (v === 'library') renderLibrary();
    if (v === 'stage') renderStage();
    if (v === 'sync') renderSync();
    if (v === 'party') renderParty();
    if (v === 'voice') renderVoice();
  }

  function initHeader() {
    $$('#nav button').forEach(b => b.addEventListener('click', () => {
      Take.abort();
      if (Transport.playing && (b.dataset.view !== 'stage')) Transport.pause();
      showView(b.dataset.view);
    }));

    $('#btn-pad').addEventListener('click', () => {
      const on = Pad.toggle();
      const btn = $('#btn-pad');
      btn.textContent = 'Пад: ' + (on ? 'вкл' : 'выкл');
      btn.classList.toggle('on', on);
    });
    document.addEventListener('km-transport', () => {
      // пад глохнет при игре — синхронизируем чип
      if (Transport.playing && Pad.on) {
        Pad.on = false;
        const btn = $('#btn-pad');
        btn.textContent = 'Пад: выкл'; btn.classList.remove('on');
      }
    });
    $('#btn-big').addEventListener('click', () => {
      document.body.classList.toggle('bigmode');
      $('#btn-big').classList.toggle('on');
    });
    $('#btn-fs').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    });
  }

  function initSync() {
    $('#sync-tap').addEventListener('click', syncTap);
    $('#sync-play').addEventListener('click', () => {
      if (!sourceReady()) { toast('Сначала выбери источник звука на Сцене', true); return; }
      Transport.toggle();
    });
    $('#sync-back').addEventListener('click', () => { Take.abort(); Transport.seek(Transport.time() - 3); });
    $('#sync-undo').addEventListener('click', syncUndo);
    $('#sync-save').addEventListener('click', syncSave);
    $('#sync-clear').addEventListener('click', function () {
      const song = state.song;
      if (!song) return;
      if (!this.dataset.armed) {
        this.dataset.armed = '1';
        this.textContent = 'Точно стереть?';
        setTimeout(() => { delete this.dataset.armed; this.textContent = 'Очистить всё'; }, 2500);
        return;
      }
      delete this.dataset.armed; this.textContent = 'Очистить всё';
      setTimings(song.id, { starts: new Array(flattenLines(song).length).fill(null) });
      renderSync(); renderLibrary();
      toast('Метки стёрты');
    });
    $('#sync-export').addEventListener('click', syncExport);
    $('#sync-import').addEventListener('click', () => $('#sync-import-file').click());
    $('#sync-import-file').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) syncImport(f);
      e.target.value = '';
    });
    document.addEventListener('keydown', e => {
      if (state.view !== 'sync') return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); syncTap(); }
    });
  }

  function initParty() {
    const nameIn = $('#party-name');
    $('#party-add').addEventListener('click', () => {
      const name = nameIn.value.trim();
      if (!name) { toast('Введи имя певца', true); return; }
      if (state.party.singers.some(s => s.name === name)) { toast('Такой уже в очереди', true); return; }
      state.party.singers.push({
        name,
        color: SINGER_COLORS[state.party.singers.length % SINGER_COLORS.length]
      });
      nameIn.value = '';
      saveParty(); renderParty();
    });
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('#party-add').click(); });
    $('#party-toggle').addEventListener('click', () => {
      state.party.active = !state.party.active;
      if (state.party.active && !state.party.singers.length) {
        state.party.active = false;
        toast('Сначала добавь певцов', true);
      }
      saveParty(); renderParty();
    });
    $('#party-clear').addEventListener('click', function () {
      if (!this.dataset.armed) {
        this.dataset.armed = '1'; this.textContent = 'Точно сбросить?';
        setTimeout(() => { delete this.dataset.armed; this.textContent = 'Сброс вечера'; }, 2500);
        return;
      }
      delete this.dataset.armed; this.textContent = 'Сброс вечера';
      state.party.results = [];
      saveParty(); renderParty();
    });
  }

  function initVoice() {
    $('#voice-start').addEventListener('click', voiceRun);
  }

  /* ============================================================
     СТАРТ
     ============================================================ */
  function init() {
    initHeader();
    initSync();
    initParty();
    initVoice();
    renderLibrary();
    renderStage();
    renderParty();
    showView('library');
    requestAnimationFrame(tick);
    document.getElementById('audio').addEventListener('ended', () => {
      Transport.playing = false;
      finalizeTake();
      document.dispatchEvent(new CustomEvent('km-transport'));
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

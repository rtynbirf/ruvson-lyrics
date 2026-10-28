'use strict';
/* ============================================================
   КАРАОКЕ МЕЧТЫ 2.0 — интерфейс и логика (app.js)
   Экраны: Библиотека · Сцена · Синхро · Пати · Голос.
   Счёт, эталон-контур, «Зелёный коридор», турнир вечера.
   ============================================================ */

(function () {
  const { $, $$, clamp, fmtTime, Store, toast, midiToName, freqToMidi,
    octFold, median, flattenLines, linesWithTimes, getTimings, setTimings,
    isSynced, toLRC, parseLRC, Transport, Pad, Mic, Recorder, TakesDB, detectKey } = window.KM;

  /* ---------- состояние ---------- */
  const state = {
    view: 'library',
    song: null,          // выбранная песня
    mode: Store.get('mode', 'friendly'),
    party: Store.get('party', { singers: [], active: false, results: [] }),
    userSongs: Store.get('userSongs', []),
    recOn: Store.get('recOn', false),
    duet: Store.get('duet', false),
    _duetMap: null,
    _lastFile: null,
    guidePlayingId: null,
    _mediaPosTs: 0,
    _lrcTried: {}
  };

  const SINGER_COLORS = ['#ff2ec4', '#23e6ff', '#2bff88', '#ffc23e', '#ff4d6d', '#b18cff', '#7dffb2', '#ff8ac2'];

  function saveParty() { Store.set('party', state.party); }

  /* ============================================================
     БИБЛИОТЕКА
     ============================================================ */
  function bestOf(songId, mode) { return Store.get('best:' + songId + ':' + mode, null); }
  function corridorOf(songId) {
    const c = Store.get('corridor:' + songId, null);
    return c ? { offset: c.offset || 0, credit: c.credit || 0 } : { offset: 0, credit: 0 };
  }
  function setCorridor(songId, c) { Store.set('corridor:' + songId, c); }

  function allSongs() { return window.SONGS.concat(state.userSongs); }

  function renderLibrary() {
    const grid = $('#song-grid');
    grid.innerHTML = '';
    allSongs().forEach(song => {
      const synced = isSynced(song);
      const bf = bestOf(song.id, 'friendly'), bj = bestOf(song.id, 'judge');
      const cor = corridorOf(song.id);
      const nLines = flattenLines(song).length;
      const card = document.createElement('div');
      card.className = 'song-card';
      card.innerHTML =
        '<div class="num">' + (song.custom
          ? 'СВОЯ ПЕСНЯ <button class="del-song" title="Удалить песню">×</button>'
          : 'НОМЕР ' + String(song.num).padStart(2, '0')) + '</div>' +
        '<h3>' + song.title + '</h3>' +
        '<div class="meta"><span class="badge ' + (song.custom ? 'own' : 'clean') + '">' + (song.custom ? 'СВОЯ' : 'ЧИСТОВИК') + '</span>' +
        (synced ? '<span class="badge synced">СИНХРОН</span>' : '') +
        '<span>' + song.dur + ' · ' + nLines + ' строк</span></div>' +
        '<div class="card-stats">' +
        '<span>Дружелюбный: <b>' + (bf == null ? '—' : Math.round(bf)) + '</b></span>' +
        '<span>Судья: <b>' + (bj == null ? '—' : Math.round(bj)) + '</b></span>' +
        '<span>Коридор: <b>' + (cor.offset === 0 ? 'оригинал' : (cor.offset > 0 ? '+' : '') + cor.offset + ' пт') + '</b></span>' +
        (Store.get('corridorSteps:' + song.id, 0) > 0
          ? '<span class="delta-up">Пройдено: ' + Store.get('corridorSteps:' + song.id, 0) + ' пт</span>' : '') +
        '</div>' +
        '<div class="corridor-track"><div class="corridor-fill" style="width:' +
        Math.round((12 - Math.abs(cor.offset)) / 12 * 100) + '%"></div></div>';
      card.addEventListener('click', () => openSong(song));
      const del = $('.del-song', card);
      if (del) del.addEventListener('click', e => { e.stopPropagation(); deleteUserSong(song.id); });
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
    tryRepoLrc(song);
  }

  // Этап 1: базовые метки живут в репозитории (karaoke/lrc/<id>.lrc).
  // Если у песни ещё нет своей синхронизации — тихо подхватываем их.
  async function tryRepoLrc(song) {
    if (!song || song.custom || state._lrcTried[song.id]) return;
    state._lrcTried[song.id] = true;
    if (isSynced(song)) return;
    try {
      const resp = await fetch('lrc/' + song.id + '.lrc');
      if (!resp.ok) return;
      const times = parseLRC(await resp.text());
      const n = flattenLines(song).length;
      if (!times.length || times.length !== n) return;
      setTimings(song.id, { starts: times.map(x => x.t), audioName: null, base: 'repo' });
      toast('Метки подгружены из репозитория (базовые). Точнее — тапами в «Синхро».');
      renderStage(); renderSync(); renderLibrary();
    } catch (e) { /* file:// или офлайн — молча */ }
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
      '<h2>' + (song.custom ? 'СВОЯ — ' : '№' + song.num + ' — ') + song.title + '</h2>' +
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
      (cor.offset === 0 ? 'открыт' : 'до оригинала: ' + Math.abs(cor.offset) + ' пт') +
      (cor.credit ? ' · в копилке полшага' : '') + '</span></span>' +
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
      '<canvas id="tube-canvas"></canvas>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button id="st-rec" class="chip-btn' + (state.recOn ? ' on' : '') + '">Запись дубля: ' + (state.recOn ? 'вкл' : 'выкл') + '</button>' +
      (state.party.active && state.party.singers.length >= 2
        ? '<button id="st-duet" class="chip-btn' + (state.duet ? ' on' : '') + '">Дуэт: ' + (state.duet ? 'вкл' : 'выкл') + '</button>' : '') +
      '<button id="st-key" class="chip-btn">Тональность файла: ' + keyLabel(song) + '</button>' +
      '<button id="st-takes" class="chip-btn">Дубли</button>' +
      '</div>' +
      '<div id="worst-panel" class="panel" style="margin-top:12px" hidden></div>' +
      '<div id="takes-panel" class="panel" style="margin-top:12px" hidden></div>' +
      '<p class="hint" style="margin-top:10px">Счёт работает при включённом микрофоне: среда измеряет присутствие, устойчивость и близость к эталон-контуру. Нотные трубки появятся после первой полной попытки — трасса эталона и твой голос на ней. Дубли пишутся (минус + голос) только по включению записи и хранятся лишь в этом браузере. Октава вверх/вниз и другая тональность счёту не мешают — главное не дрейфовать.</p>' +
      '<p class="hint" id="st-guide-hint"></p>';

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
      state._lastFile = f;
      await Transport.useFile(f);
      toast('Минус загружен: ' + f.name);
      updateStageMeta();
      autoKey(f);
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
    $('#st-rec').addEventListener('click', () => {
      state.recOn = !state.recOn; Store.set('recOn', state.recOn);
      $('#st-rec').textContent = 'Запись дубля: ' + (state.recOn ? 'вкл' : 'выкл');
      $('#st-rec').classList.toggle('on', state.recOn);
    });
    const duetBtn = $('#st-duet');
    if (duetBtn) duetBtn.addEventListener('click', () => {
      state.duet = !state.duet; Store.set('duet', state.duet);
      state._duetMap = duetAssign(song);
      duetBtn.textContent = 'Дуэт: ' + (state.duet ? 'вкл' : 'выкл');
      duetBtn.classList.toggle('on', state.duet);
    });
    const keyBtn = $('#st-key');
    if (keyBtn) keyBtn.addEventListener('click', () => {
      const k = Store.get('key:' + song.id, null);
      if (k && k.fileName === (Transport.fileName || '')) suggestKeyStart();
      else if (state._lastFile) autoKey(state._lastFile);
      else toast('Сначала загрузи минус из файла', true);
    });
    $('#st-takes').addEventListener('click', () => {
      const p = $('#takes-panel');
      p.hidden = !p.hidden;
      if (!p.hidden) refreshTakes();
    });
    renderWorst();
    refreshTakes();

    // drag&drop файла на лирику
    box.addEventListener('dragover', e => { e.preventDefault(); });
    box.addEventListener('drop', async e => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /audio|video/.test(f.type) || (f && /\.(mp3|wav|ogg|m4a|flac|opus)$/i.test(f.name))) {
        state._lastFile = f;
        await Transport.useFile(f);
        toast('Минус загружен: ' + f.name);
        updateStageMeta();
        autoKey(f);
      }
    });

    applyCorridor();
    updateStageMeta();
    updateScoreHud();
    state._duetMap = duetAssign(song);
    updateMediaMeta();
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
        this.cur = { frames: 0, voiced: 0, semis: [], pts: [] };
      }
      this.cur.frames++;
      this.framesTotal++;
      if (pitch && pitch.freq > 0 && pitch.conf >= (state.mode === 'judge' ? 0.5 : 0.35)) {
        this.cur.voiced++;
        this.voicedTotal++;
        const midi = freqToMidi(pitch.freq);
        this.cur.semis.push(midi);
        this.cur.pts.push([t, midi]);
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

  async function finalizeTake() {
    if (!Take.active) return;
    Take.active = false;
    const song = state.song;
    if (!song) return;
    const recBlob = state.recOn ? await Recorder.stop() : null;
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

    // эталон-контур с траекторией: лучшая по покрытию попытка
    if (full && (!ref || coverage >= (ref.coverage || 0))) {
      const lines = [];
      for (let i = 0; i < flat.length; i++) {
        const a = acc.get(i);
        if (a && a.semis.length >= 6) {
          const m = median(a.semis);
          const h1 = median(a.semis.slice(0, Math.ceil(a.semis.length / 2)));
          const h2 = median(a.semis.slice(Math.ceil(a.semis.length / 2)));
          lines[i] = { m, dir: h2 - h1 > 0.7 ? 'up' : h2 - h1 < -0.7 ? 'down' : 'hold', path: buildPath(a.pts, flat[i], m) };
        } else lines[i] = null;
      }
      Store.set('ref:' + song.id, { offset: off, coverage, lines });
    }

    // что тренировать: слабые строки полной попытки
    if (full) {
      const worst = included.filter(x => x.sc < 60).sort((x, y) => x.sc - y.sc).slice(0, 3)
        .map(x => ({ i: x.i, sc: Math.round(x.sc), text: flat[x.i].text, start: flat[x.i].start }));
      Store.set('worst:' + song.id, worst);
    }

    // хайлайты вечера: лучшая строка попытки
    const bestLine = included.slice().sort((x, y) => y.sc - x.sc)[0];
    if (full && bestLine && bestLine.sc >= 70) {
      const hs = Store.get('session', { date: new Date().toDateString(), items: [] });
      if (hs.date !== new Date().toDateString()) { hs.date = new Date().toDateString(); hs.items = []; }
      hs.items.push({
        song: '№' + song.num + ' ' + song.title,
        text: flat[bestLine.i].text,
        score: Math.round(bestLine.sc),
        singer: (state.party.active && state.party.singers.length) ? currentSinger() : null,
        ts: Date.now()
      });
      hs.items.sort((a, b) => b.score - a.score);
      hs.items = hs.items.slice(0, 12);
      Store.set('session', hs);
    }

    // Зелёный коридор (этап 4, умный): удачная попытка кладёт полшага
    // в копилку, две подряд — полный полутон к оригиналу; провал сжигает
    // копилку. Пройденные полутоны копятся за всё время (corridorSteps).
    const th = state.mode === 'judge' ? 65 : 75;
    let corMsg = '';
    if (full) {
      const cor = corridorOf(song.id);
      if (score >= th && cor.offset !== 0) {
        cor.credit += 0.5;
        if (cor.credit >= 0.999) {
          cor.credit = 0;
          cor.offset += cor.offset > 0 ? -1 : 1;
          Store.set('corridorSteps:' + song.id, Store.get('corridorSteps:' + song.id, 0) + 1);
          corMsg = ' · Зелёный коридор сузился: ' +
            (cor.offset === 0 ? 'ОРИГИНАЛ!' : Math.abs(cor.offset) + ' пт до оригинала');
        } else {
          corMsg = ' · Коридор копит шаг: полшага есть — нужна вторая удачная подряд';
        }
        setCorridor(song.id, cor);
        applyCorridor();
      } else if (score < th && cor.credit > 0) {
        cor.credit = 0;
        setCorridor(song.id, cor);
        corMsg = ' · Стрик коридора прерван — полшага сгорел';
      }
      // профиль вектора: история полных попыток (этап 4)
      const vec = Store.get('vector:' + song.id, []);
      vec.push({ t: Date.now(), mode: state.mode, score: Math.round(score), cor: cor.offset, cov: Math.round(coverage * 100) });
      while (vec.length > 80) vec.shift();
      Store.set('vector:' + song.id, vec);
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
        score: Math.round(score), mode: state.mode, ts: Date.now(),
        parts: duetParts(included)
      });
      saveParty();
      if (state.view === 'party') renderParty();
    }

    // сохранение дубля (минус + голос)
    if (recBlob) {
      try {
        await TakesDB.put({
          id: song.id + ':' + Date.now(),
          songId: song.id,
          songTitle: '№' + song.num + ' — ' + song.title,
          ts: Date.now(),
          score: Math.round(score), mode: state.mode,
          mime: recBlob.type, blob: recBlob
        });
        const tp = $('#takes-panel');
        if (tp && !tp.hidden) refreshTakes();
      } catch (e) { toast('Дубль не сохранился: ' + e, true); }
    }

    toast('Попытка: ' + Math.round(score) + ' / 100' +
      (full ? ' · покрытие ' + Math.round(coverage * 100) + '%' : ' · частичная (' + Math.round(coverage * 100) + '%), в зачёт не идёт') +
      corMsg);
    const sugEl = $('#sc-suggest');
    if (sugEl) sugEl.textContent = sug;
    updateScoreHud(score);
    renderWorst();
    if (state.view === 'profile') renderProfile();
  }

  function updateScoreHud(preview) {
    const song = state.song;
    if (!song || !$('#sc-big')) return;
    if (typeof preview === 'number') $('#sc-big').textContent = Math.round(preview);
    const b = bestOf(song.id, state.mode);
    $('#sc-best').textContent = b == null ? '—' : Math.round(b);
  }

  /* ============================================================
     ЭТАП 4 — ПРОГРЕСС КАК ПОЛЕ (профиль вектора)
     ============================================================ */
  function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

  function renderProfile() {
    const holder = $('#profile-root');
    if (!holder) return;
    const song = state.song;
    if (!song) {
      holder.innerHTML = '<div class="stage-empty panel">Профиль ждёт песню.<br>Выбери её в Библиотеке — поле должно знать, кого растит.</div>';
      return;
    }
    const vec = Store.get('vector:' + song.id, []);
    const steps = Store.get('corridorSteps:' + song.id, 0);
    const cor = corridorOf(song.id);
    const scores = vec.map(v => v.score);
    const best = scores.length ? Math.max.apply(null, scores) : null;
    const dv = vec.length >= 2 ? avg(scores.slice(-5)) - avg(scores.slice(0, 5)) : null;
    holder.innerHTML =
      '<div class="party-grid">' +
      '<div class="panel">' +
      '<h3 style="margin-bottom:10px">Поле песни: ' + (song.num ? '№' + song.num + ' — ' : 'СВОЯ — ') + esc(song.title) + '</h3>' +
      '<div class="btn-row" style="flex-wrap:wrap;gap:14px">' +
      '<div class="voice-stat"><b>' + vec.length + '</b>полных попыток</div>' +
      '<div class="voice-stat"><b>' + (best == null ? '—' : best) + '</b>лучший счёт</div>' +
      '<div class="voice-stat"><b class="' + (dv == null ? '' : dv >= 0 ? 'delta-up' : 'delta-down') + '">' +
      (dv == null ? '—' : (dv >= 0 ? '+' : '') + dv.toFixed(1)) + '</b>Δv (последние 5 − первые 5)</div>' +
      '<div class="voice-stat"><b class="delta-up">' + steps + '</b>полутонов отвоевано коридором</div>' +
      '</div>' +
      '<p class="hint" style="margin-top:10px">Коридор сейчас: ' +
      (cor.offset === 0 ? 'в оригинале' : (cor.offset > 0 ? '+' : '') + cor.offset + ' пт до оригинала') +
      (cor.credit ? ' · в копилке полшага' : '') +
      '. Две удачные подряд (дружелюбный ≥ 75, судья ≥ 65) — полутон к оригиналу; провал сжигает копилку. Кнопка «Сброс» на Сцене не трогает отвоёванное — пройденное не отбирают.</p>' +
      '</div>' +
      '<div class="panel"><h3 style="margin-bottom:10px">Кривая роста</h3>' +
      '<div class="growth-wrap"><canvas id="growth-canvas"></canvas></div>' +
      '<p class="hint" style="margin-top:6px">Каждая точка — полная попытка. Пунктир — средняя цена голоса в этой песне.</p>' +
      '</div>' +
      '</div>' +
      '<div class="panel" style="margin-top:16px"><h3 style="margin-bottom:10px">Журнал попыток</h3>' +
      (vec.length
        ? '<table class="lb"><tr><th>#</th><th>Когда</th><th>Режим</th><th>Счёт</th><th>Покрытие</th><th>Коридор после</th></tr>' +
          vec.slice().reverse().slice(0, 12).map((v, i) =>
            '<tr><td>' + (vec.length - i) + '</td><td class="hint">' + new Date(v.t).toLocaleString() + '</td><td>' +
            (v.mode === 'judge' ? 'судья' : 'друг') + '</td><td class="score">' + v.score + '</td><td>' + v.cov + '%</td><td>' +
            (v.cor === 0 ? 'оригинал' : (v.cor > 0 ? '+' : '') + v.cor + ' пт') + '</td></tr>').join('') + '</table>'
        : '<p class="hint">Полных попыток ещё не было. Сцена ждёт: микрофон, минус, трек без пауз — и первая точка ляжет на кривую.</p>') +
      '<div class="btn-row" style="margin-top:10px"><button id="profile-wipe" class="btn small">Стереть профиль песни</button></div></div>' +
      '<div class="panel" style="margin-top:16px"><h3 style="margin-bottom:10px">Сводка по всем песням</h3>' +
      allSongsTable() + '</div>';
    $('#profile-wipe').addEventListener('click', function () {
      if (!this.dataset.armed) {
        this.dataset.armed = '1'; this.textContent = 'Точно стереть?';
        setTimeout(() => { delete this.dataset.armed; this.textContent = 'Стереть профиль песни'; }, 2500);
        return;
      }
      delete this.dataset.armed;
      Store.del('vector:' + song.id);
      Store.del('corridorSteps:' + song.id);
      setCorridor(song.id, { offset: 0, credit: 0 });
      renderProfile(); renderLibrary();
      toast('Профиль песни стёрт — поле чисто');
    });
    $$('tr[data-song]', holder).forEach(tr => tr.addEventListener('click', () => {
      const s = allSongs().find(x => x.id === tr.dataset.song);
      if (s) openSong(s);
    }));
    drawGrowth(scores);
  }

  function allSongsTable() {
    const rows = allSongs().map(song => {
      const vec = Store.get('vector:' + song.id, []);
      const steps = Store.get('corridorSteps:' + song.id, 0);
      const cor = corridorOf(song.id);
      const bf = bestOf(song.id, 'friendly'), bj = bestOf(song.id, 'judge');
      const b = [bf, bj].filter(x => x != null);
      const bestV = b.length ? Math.round(Math.max.apply(null, b)) : null;
      return '<tr data-song="' + song.id + '" style="cursor:pointer"><td>' + esc(song.title) + '</td><td>' + vec.length + '</td><td class="score">' +
        (bestV == null ? '—' : bestV) + '</td><td>' + (cor.offset === 0 ? 'оригинал' : (cor.offset > 0 ? '+' : '') + cor.offset + ' пт') +
        '</td><td class="delta-up">' + steps + '</td></tr>';
    }).join('');
    return '<table class="lb"><tr><th>Песня</th><th>Попыток</th><th>Лучший</th><th>Коридор</th><th>Пройдено пт</th></tr>' + rows + '</table>' +
      '<p class="hint" style="margin-top:8px">Клик по строке — открыть песню.</p>';
  }

  function drawGrowth(scores) {
    const cv = document.getElementById('growth-canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || (cv.parentElement ? cv.parentElement.clientWidth : 400);
    const H = cv.clientHeight || 150;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '12px ' + getComputedStyle(document.body).fontFamily;
    if (!scores.length) {
      g.fillStyle = 'rgba(138,138,176,0.9)';
      g.fillText('Кривая появится после первой полной попытки.', 14, H / 2);
      return;
    }
    if (scores.length === 1) {
      g.fillStyle = 'rgba(43,255,136,0.9)';
      g.beginPath(); g.arc(W / 2, H / 2, 4, 0, Math.PI * 2); g.fill();
      g.fillText(scores[0] + ' — одна точка. Вектору нужна вторая, чтобы показать направление.', W / 2 + 12, H / 2 + 4);
      return;
    }
    const pad = { l: 30, r: 14, t: 12, b: 18 };
    const lo = Math.max(0, Math.min.apply(null, scores) - 6);
    const hi = Math.min(100, Math.max.apply(null, scores) + 6);
    const X = i => pad.l + (W - pad.l - pad.r) * (i / (scores.length - 1));
    const Y = v => H - pad.b - (H - pad.t - pad.b) * ((v - lo) / ((hi - lo) || 1));
    g.strokeStyle = 'rgba(120,120,200,0.14)'; g.lineWidth = 1;
    g.fillStyle = 'rgba(138,138,176,0.85)';
    [lo, (lo + hi) / 2, hi].forEach(v => {
      g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(W - pad.r, Y(v)); g.stroke();
      g.fillText(String(Math.round(v)), 6, Y(v) + 4);
    });
    const m = avg(scores);
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,194,62,0.55)';
    g.beginPath(); g.moveTo(pad.l, Y(m)); g.lineTo(W - pad.r, Y(m)); g.stroke();
    g.setLineDash([]);
    g.beginPath();
    scores.forEach((v, i) => { const x = X(i), y = Y(v); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = 'rgba(43,255,136,0.95)'; g.lineWidth = 2.2;
    g.shadowColor = 'rgba(43,255,136,0.7)'; g.shadowBlur = 10;
    g.stroke();
    g.shadowBlur = 0;
    g.lineTo(X(scores.length - 1), H - pad.b); g.lineTo(X(0), H - pad.b); g.closePath();
    g.fillStyle = 'rgba(43,255,136,0.08)'; g.fill();
    scores.forEach((v, i) => {
      const last = i === scores.length - 1;
      g.fillStyle = last ? 'rgba(35,230,255,1)' : 'rgba(43,255,136,0.8)';
      g.beginPath(); g.arc(X(i), Y(v), last ? 4.5 : 2.6, 0, Math.PI * 2); g.fill();
      if (last) {
        g.fillStyle = 'rgba(35,230,255,0.95)';
        g.fillText(String(v), Math.min(X(i) + 8, W - 26), Y(v) - 8);
      }
    });
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

      drawTubes(t, flat, idx);
      applyDuetColors(lineEls);
      syncGuide(t, playing);
      updateMediaPosition();
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
     v3.0 — ЭМЕРДЖЕНТНОЕ: трубки, дуэты, дубли+гид, свои песни,
     хайлайты, тональность, разогрев, MediaSession
     ============================================================ */
  const TUBE_BUCKETS = 24;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Траектория строки: 24 ведра по времени, медианы, относительные (полутона от медианы строки).
  function buildPath(pts, line, m) {
    if (!pts || pts.length < 8) return null;
    const d = (line.end != null && line.start != null) ? (line.end - line.start) : 0;
    if (!(d > 0.4)) return null;
    const B = TUBE_BUCKETS;
    const bk = Array.from({ length: B }, () => []);
    pts.forEach(pair => {
      const b = Math.floor((pair[0] - line.start) / d * B);
      if (b >= 0 && b < B) bk[b].push(octFold(pair[1] - m));
    });
    const filled = bk.filter(a => a.length).length;
    if (filled < B * 0.6) return null;
    const path = bk.map(a => a.length ? +median(a).toFixed(1) : null);
    for (let b = 0; b < B; b++) {
      if (path[b] == null) {
        let l = b - 1, r = b + 1;
        while (l >= 0 && path[l] == null) l--;
        while (r < B && path[r] == null) r++;
        if (l >= 0 && r < B) path[b] = +(((path[l] + path[r]) / 2).toFixed(1));
        else if (l >= 0) path[b] = path[l];
        else if (r < B) path[b] = path[r];
      }
    }
    return path;
  }

  function drawTubes(t, flat, idx) {
    const cv = document.getElementById('tube-canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cur = idx >= 0 ? flat[idx] : null;
    const refAll = state.song ? Store.get('ref:' + state.song.id, null) : null;
    const refLine = (cur && refAll && refAll.lines[idx]) ? refAll.lines[idx] : null;
    if (!cur || cur.start == null || cur.end == null) return;
    const t0 = cur.start - 0.2, t1 = Math.max(cur.end, t0 + 1);
    const x = tt => (tt - t0) / (t1 - t0) * W;
    const yOf = rel => H / 2 - clamp(rel, -8, 8) / 8 * (H / 2 - 8);
    const offDelta = refAll ? (Transport.semitones - refAll.offset) : 0;

    // сетка полутонос
    g.strokeStyle = 'rgba(120,120,200,0.12)';
    g.lineWidth = 1;
    [-4, 4].forEach(rel => {
      g.beginPath(); g.moveTo(0, yOf(rel)); g.lineTo(W, yOf(rel)); g.stroke();
    });

    if (refLine && refLine.path) {
      // трубка эталона
      const path = refLine.path;
      g.lineJoin = 'round'; g.lineCap = 'round';
      [[12, 'rgba(43,255,136,0.22)'], [5, 'rgba(43,255,136,0.85)']].forEach(pair => {
        g.lineWidth = pair[0]; g.strokeStyle = pair[1];
        g.beginPath();
        for (let b = 0; b < TUBE_BUCKETS; b++) {
          const px = x(cur.start + (b + 0.5) / TUBE_BUCKETS * (cur.end - cur.start));
          const py = yOf(path[b]);
          if (b === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      });
    } else {
      g.setLineDash([4, 6]);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      g.setLineDash([]);
    }

    // живой голос в окне строки
    const pts = pitchTrail.filter(p => p.t >= t0 && p.t <= t1 + 0.2);
    if (!pts.length) return;
    let center = 0;
    if (refLine && typeof refLine.m === 'number') center = refLine.m + offDelta;
    else center = median(pts.slice(-24).map(p => p.midi));
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.shadowColor = 'rgba(35,230,255,0.9)'; g.shadowBlur = 6;
    pts.forEach(p => {
      const rel = octFold(p.midi - center);
      g.beginPath();
      g.arc(x(p.t), yOf(rel), p === pts[pts.length - 1] ? 4.5 : 2.5, 0, Math.PI * 2);
      g.fill();
    });
    g.shadowBlur = 0;
  }

  /* ---------- дуэты: распределение строк ---------- */
  function duetAssign(song) {
    if (!state.duet || !state.party.active || state.party.singers.length < 2) return null;
    const n = state.party.singers.length;
    const map = [];
    song.sections.forEach((sec, si) => {
      const a = sec.type === 'chorus' ? -1 : (si % n); // припевы — хором
      sec.lines.forEach(() => map.push(a));
    });
    return map;
  }

  function applyDuetColors(lineEls) {
    const map = state._duetMap;
    if (!map || map.length !== lineEls.length) return;
    lineEls.forEach((el, i) => {
      let chip = $('.duet-chip', el);
      const a = map[i];
      if (a == null || a < 0) {
        if (chip) chip.remove();
        return;
      }
      const s = state.party.singers[a];
      if (!s) return;
      if (!el.classList.contains('current')) el.style.boxShadow = 'inset 3px 0 0 ' + s.color;
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'duet-chip';
        el.appendChild(chip);
      }
      chip.textContent = s.name;
      chip.style.color = s.color;
    });
  }

  function duetParts(included) {
    const map = state._duetMap;
    if (!map || !state.duet || state.party.singers.length < 2) return null;
    const sums = {};
    included.forEach(x => {
      const a = map[x.i];
      if (a == null || a < 0) return;
      const s = state.party.singers[a];
      if (!s) return;
      if (!sums[s.name]) sums[s.name] = { color: s.color, sum: 0, n: 0 };
      sums[s.name].sum += x.sc; sums[s.name].n++;
    });
    const keys = Object.keys(sums);
    if (keys.length < 2) return null;
    return keys.map(name => ({ name, color: sums[name].color, score: Math.round(sums[name].sum / sums[name].n) }));
  }

  /* ---------- что тренировать + точечный реплей ---------- */
  function renderWorst() {
    const song = state.song;
    const el = $('#worst-panel');
    if (!el || !song) return;
    const w = Store.get('worst:' + song.id, []);
    if (!w.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<b style="color:var(--amber)">Что тренировать</b> <span class="hint">— слабые строки последней полной попытки. Клик — переход к строке:</span>' +
      '<div class="btn-row" style="margin-top:8px">' +
      w.map(x => '<button class="btn small worst-line" data-i="' + x.i + '">' + x.sc + ' · «' + esc(x.text.slice(0, 26)) + (x.text.length > 26 ? '…' : '') + '»</button>').join('') +
      '</div>';
    $$('.worst-line', el).forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      const tm = getTimings(song.id);
      const st = tm && tm.starts && tm.starts[i];
      if (typeof st !== 'number') return;
      Take.abort();
      Transport.seek(Math.max(0, st - 0.8));
      if (!Transport.playing) Transport.play();
    }));
  }

  /* ---------- дубли и гид-вокал ---------- */
  async function refreshTakes() {
    const song = state.song;
    const el = $('#takes-panel');
    if (!el || !song) return;
    let takes = [];
    try { takes = await TakesDB.list(song.id); } catch (e) { takes = []; }
    if (!takes.length) {
      el.innerHTML = '<span class="hint">Дублей пока нет. Включи «Запись дубля» — попытка сохранится сюда (минус + голос). Файлы живут только в этом браузере.</span>';
      return;
    }
    takes.sort((a, b) => b.ts - a.ts);
    const guideId = Store.get('guide:' + song.id, null);
    el.innerHTML = '<b>Дубли песни</b> <span class="hint">— «Гид» назначает дубль подсказчиком: он тихо играет, пока ты поёшь.</span>' +
      '<div class="takes-list">' + takes.map(tk =>
        '<div class="take-row" data-id="' + tk.id + '">' +
        '<span class="take-name">' + new Date(tk.ts).toLocaleString() + ' · ' + tk.score + ' (' + (tk.mode === 'judge' ? 'судья' : 'друг') + ')</span>' +
        '<span class="acts">' +
        '<button class="btn small tk-play">Слушать</button>' +
        '<button class="btn small tk-guide' + (guideId === tk.id ? ' go' : '') + '">Гид</button>' +
        '<a class="btn small tk-dl" download="' + esc((tk.songTitle || 'take').replace(/[\\/:*?"<>|]/g, '')) + '_' + tk.ts + '.webm">Скачать</a>' +
        '<button class="btn small tk-del">Удалить</button>' +
        '</span></div>').join('') + '</div>';
    $$('.take-row', el).forEach(row => {
      const id = row.dataset.id;
      const tk = takes.find(x => x.id === id);
      $('.tk-play', row).addEventListener('click', () => playTake(tk));
      $('.tk-guide', row).addEventListener('click', () => {
        const cur = Store.get('guide:' + song.id, null);
        Store.set('guide:' + song.id, cur === id ? null : id);
        stopGuide();
        refreshTakes();
        toast(cur === id ? 'Гид выключен' : 'Гид назначен: дубль от ' + new Date(tk.ts).toLocaleTimeString());
      });
      const dl = $('.tk-dl', row);
      if (tk) dl.href = URL.createObjectURL(tk.blob);
      $('.tk-del', row).addEventListener('click', async () => {
        await TakesDB.del(id);
        if (Store.get('guide:' + song.id, null) === id) { Store.set('guide:' + song.id, null); stopGuide(); }
        refreshTakes();
      });
    });
    const gh = $('#st-guide-hint');
    if (gh) gh.textContent = guideId ? 'Гид включён — дубль будет подыгрывать при следующем запуске трека.' : '';
  }

  function playTake(tk) {
    if (!tk) return;
    const a = document.getElementById('guide-audio');
    if (state.guidePlayingId === tk.id && a && !a.paused) { a.pause(); return; }
    stopGuide();
    a.src = URL.createObjectURL(tk.blob);
    a.volume = 0.9;
    a.play().catch(() => {});
    state.guidePlayingId = tk.id;
  }

  function stopGuide() {
    const a = document.getElementById('guide-audio');
    if (a) { try { a.pause(); } catch (e) {} a.removeAttribute('src'); }
    state.guidePlayingId = null;
  }

  function syncGuide(t, playing) {
    const song = state.song;
    if (!song) return;
    const a = document.getElementById('guide-audio');
    if (!a) return;
    const gid = Store.get('guide:' + song.id, null);
    if (!gid || !playing) {
      if (!a.paused) a.pause();
      return;
    }
    if (state.guidePlayingId !== gid) {
      TakesDB.get(gid).then(tk => {
        if (!tk) return;
        a.src = URL.createObjectURL(tk.blob);
        a.volume = 0.22;
        a.play().catch(() => {});
        state.guidePlayingId = gid;
      });
      return;
    }
    if (!a.paused && isFinite(a.duration) && a.duration > 0 && Math.abs(a.currentTime - t) > 0.35) {
      try { a.currentTime = clamp(t, 0, Math.max(0, a.duration - 0.05)); } catch (e) {}
    }
  }

  /* ---------- тональность файла (Krumhansl-Schmuckler) ---------- */
  function keyLabel(song) {
    const k = song ? Store.get('key:' + song.id, null) : null;
    return k && k.fileName === (Transport.fileName || '') ? k.name : '?';
  }

  async function autoKey(file) {
    if (!file || file.size > 60 * 1024 * 1024) return;
    const song = state.song;
    const btn = $('#st-key');
    if (!btn || !song) return;
    const cached = Store.get('key:' + song.id, null);
    if (cached && cached.fileName === file.name) {
      btn.textContent = 'Тональность файла: ' + cached.name;
      return;
    }
    btn.textContent = 'Тональность файла: анализ…';
    try {
      const k = await detectKey(file, p => { btn.textContent = 'Тональность файла: анализ ' + Math.round(p * 100) + '%'; });
      if (!k) { btn.textContent = 'Тональность файла: не вышло'; return; }
      Store.set('key:' + song.id, { fileName: file.name, name: k.name, tonicMidi: k.tonicMidi });
      btn.textContent = 'Тональность файла: ' + k.name;
      toast('Тональность: ' + k.name + '. Второй клик по чипу — старт от голоса.');
    } catch (e) {
      btn.textContent = 'Тональность файла: не вышло';
    }
  }

  function suggestKeyStart() {
    const song = state.song;
    const k = song && Store.get('key:' + song.id, null);
    const v = Store.get('voice', null);
    if (!k || !v) { toast('Нужны: тональность файла и тест голоса (раздел «Голос»)', true); return; }
    const tonic = k.tonicMidi + 12 * Math.round((v.free - k.tonicMidi) / 12);
    const off = clamp(Math.round(v.free - tonic), -12, 12);
    setCorridor(song.id, { offset: off });
    applyCorridor();
    toast('Старт по голосу: ' + (off === 0 ? 'оригинал' : (off > 0 ? '+' : '') + off + ' пт') + '. Коридор сам поведёт к оригиналу.');
  }

  /* ---------- свои песни ---------- */
  function guessType(label) {
    const l = label.toLowerCase();
    if (/припев|chorus|hook/.test(l)) return 'chorus';
    if (/бридж|bridge/.test(l)) return 'bridge';
    if (/аутро|outro|концовк/.test(l)) return 'outro';
    if (/финал|final/.test(l)) return 'final';
    return 'verse';
  }

  function parseLyrics(text) {
    const sections = [];
    let cur = null, lines = 0;
    text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length).forEach(raw => {
      if (raw.endsWith(':') && raw.length <= 24) {
        cur = { label: raw.replace(/:$/, '').trim(), type: guessType(raw), lines: [] };
        sections.push(cur);
        return;
      }
      if (!cur) { cur = { label: 'Куплет 1', type: 'verse', lines: [] }; sections.push(cur); }
      cur.lines.push(raw);
      lines++;
    });
    return { sections: sections.filter(s => s.lines.length), lines };
  }

  function initAddSong() {
    const btn = $('#add-song-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const p = $('#add-song-panel');
      p.hidden = !p.hidden;
    });
    $('#add-song-save').addEventListener('click', () => {
      const title = $('#add-song-title').value.trim();
      const text = $('#add-song-text').value;
      const durRaw = $('#add-song-dur').value.trim();
      const yt = $('#add-song-yt').value.trim();
      if (!title) { toast('Дай песне имя', true); return; }
      const parsed = parseLyrics(text);
      if (!parsed.lines) { toast('Нет строк: вставь текст песни', true); return; }
      let durSec = 210, dur = '3:30';
      const mm = durRaw.match(/^(\d{1,2}):(\d{2})$/);
      if (mm) { durSec = +mm[1] * 60 + +mm[2]; dur = durRaw; }
      state.userSongs.push({
        id: 'u' + Date.now(), custom: true, num: 0, title,
        dur, durSec, youtube: yt || '', sections: parsed.sections
      });
      Store.set('userSongs', state.userSongs);
      ['#add-song-title', '#add-song-text', '#add-song-dur', '#add-song-yt'].forEach(s => { $(s).value = ''; });
      $('#add-song-panel').hidden = true;
      toast('Песня добавлена: ' + title + ' · ' + parsed.lines + ' строк. Теперь Синхро.');
      renderLibrary();
    });
  }

  function deleteUserSong(id) {
    state.userSongs = state.userSongs.filter(s => s.id !== id);
    Store.set('userSongs', state.userSongs);
    ['timings', 'best:friendly', 'best:judge', 'ref', 'corridor', 'worst', 'key', 'guide']
      .forEach(k => Store.del(k + ':' + id));
    if (state.song && state.song.id === id) { state.song = null; renderStage(); }
    renderLibrary();
    toast('Песня удалена');
  }

  /* ---------- хайлайты вечера ---------- */
  function renderHighlights() {
    const el = $('#party-highlights');
    if (!el) return;
    const hs = Store.get('session', { date: '', items: [] });
    if (!hs.items.length) {
      el.innerHTML = '<p class="hint">Хайлайтов пока нет. Лучшие строки вечера (70+) появятся здесь.</p>';
      return;
    }
    el.innerHTML = '<b>Хайлайты вечера</b>' +
      '<table class="lb" style="margin-top:8px">' +
      hs.items.slice(0, 8).map(h =>
        '<tr><td class="score">' + h.score + '</td><td>' +
        (h.singer ? '<span style="color:var(--cyan)">' + esc(h.singer) + '</span> · ' : '') + esc(h.song) +
        '</td><td class="hint">«' + esc(h.text.slice(0, 34)) + (h.text.length > 34 ? '…' : '') + '»</td></tr>'
      ).join('') + '</table>' +
      '<div class="btn-row" style="margin-top:10px"><button id="hl-clear" class="btn small">Очистить</button></div>';
    $('#hl-clear').addEventListener('click', () => {
      Store.set('session', { date: '', items: [] });
      renderHighlights();
    });
  }

  /* ---------- разогрев (60 сек) ---------- */
  const Warmup = {
    running: false, timers: [],
    stop() {
      this.running = false;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      const b = $('#warmup-btn');
      if (b) { b.textContent = 'Разогрев 60 сек'; b.disabled = false; }
    },
    after(ms, fn) { this.timers.push(setTimeout(() => { if (this.running) fn(); }, ms)); },
    run() {
      if (this.running) { this.stop(); return; }
      this.running = true;
      const b = $('#warmup-btn');
      if (b) b.textContent = 'Остановить';
      const st = $('#warmup-status');
      const say = s => { if (st) st.textContent = s; };
      say('0:10 — Дыши. Длинный выдох на «с-с-с»');
      this.after(10000, () => say('10:18 — Сирена «у-у» вверх и вниз, тянись за нотой'));
      this.after(10000, () => playGliss(48, 60, 4));
      this.after(14000, () => playGliss(60, 48, 4));
      this.after(18000, () => say('18:26 — Пять нот вверх на «мэ-ми-ма-мо-му»'));
      [60, 62, 64, 65, 67].forEach((m, i) => this.after(18000 + i * 1400, () => playGliss(m, m + 2, 1.1)));
      this.after(26000, () => say('26:34 — Пять нот вниз'));
      [67, 65, 64, 62, 60].forEach((m, i) => this.after(26000 + i * 1400, () => playGliss(m, m - 2, 1.1)));
      this.after(34000, () => say('34:44 — «Бр-р-р» губами в ритме, спокойно'));
      this.after(44000, () => say('44:60 — Свободная сирена на «а», где удобно. Следи за живой нотой'));
      this.after(44000, () => playGliss(50, 62, 6));
      this.after(50000, () => playGliss(62, 50, 6));
      this.after(60000, () => {
        say('Готово. Голос заведён.');
        Store.set('warmupLast', Date.now());
        renderVoice();
        this.stop();
      });
    }
  };

  /* ---------- MediaSession ---------- */
  function initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => { if (!Transport.playing && sourceReady()) { Take.begin(); Transport.toggle(); } });
      navigator.mediaSession.setActionHandler('pause', () => { if (Transport.playing) Transport.toggle(); });
      navigator.mediaSession.setActionHandler('seekbackward', () => Transport.seek(Transport.time() - 3));
      navigator.mediaSession.setActionHandler('seekforward', () => Transport.seek(Transport.time() + 3));
    } catch (e) {}
  }

  function updateMediaMeta() {
    if (!('mediaSession' in navigator) || !state.song) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: (state.song.num ? '№' + state.song.num + ' — ' : '') + state.song.title,
        artist: 'RUVSON · КАРАОКЕ МЕЧТЫ 2.0',
        album: 'ЧИСТОВИК'
      });
    } catch (e) {}
  }

  function updateMediaPosition() {
    if (!('mediaSession' in navigator) || Transport.mode !== 'file') return;
    const now = Date.now();
    if (now - state._mediaPosTs < 900) return;
    state._mediaPosTs = now;
    try {
      const d = Transport.duration();
      if (isFinite(d) && d > 0 && Transport.playing) {
        navigator.mediaSession.setPositionState({
          duration: d, playbackRate: 1, position: clamp(Transport.time(), 0, d)
        });
      }
    } catch (e) {}
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
    const tmNow = getTimings(song.id);
    hint.textContent = 'Песня: №' + song.num + ' — ' + song.title + '. Источник звука: ' +
      (Transport.mode === 'synth' ? 'синт-минус' : (document.getElementById('audio').src ? 'файл' : 'не выбран (иди на Сцену)')) +
      (tmNow && tmNow.base === 'repo' ? '. Метки: базовые из репозитория — подправь тапами' : '');
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
        '<tr' + (i === 0 ? ' class="top"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(r.singer) +
        (r.parts ? '<br>' + r.parts.map(p => '<span style="color:' + p.color + ';font-size:12px">' + esc(p.name) + ' ' + p.score + '</span>').join(' · ') : '') +
        '</td><td>' + esc(r.song) + '</td><td>' + (r.mode === 'judge' ? 'судья' : 'друг') + '</td>' +
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
    if (!v) { el.innerHTML = ''; } else {
      el.innerHTML =
        '<div class="voice-stat"><b>' + midiToName(Math.round(v.free)) + '</b>свободный центр</div>' +
        '<div class="voice-stat"><b>' + midiToName(Math.round(v.low)) + '</b>комфортный низ</div>' +
        '<div class="voice-stat"><b>' + midiToName(Math.round(v.high)) + '</b>комфортный верх</div>' +
        '<div class="voice-stat"><b>' + (v.high - v.low) + '</b>полутонов диапазона</div>';
    }
    const wl = $('#warmup-last');
    if (wl) {
      const last = Store.get('warmupLast', null);
      wl.textContent = last ? 'Последний разогрев: ' + new Date(last).toLocaleString() : 'Разогрев ещё не проводился — а он дешевле, чем лечение сорванного голоса.';
    }
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
    if (v === 'party') { renderParty(); renderHighlights(); }
    if (v === 'voice') renderVoice();
    if (v === 'profile') renderProfile();
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
    const wb = $('#warmup-btn');
    if (wb) wb.addEventListener('click', () => Warmup.run());
  }

  /* ============================================================
     СТАРТ
     ============================================================ */
  function init() {
    initHeader();
    initSync();
    initParty();
    initVoice();
    initAddSong();
    initMediaSession();
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

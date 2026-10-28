'use strict';
/* ============================================================
   КАРАОКЕ МЕЧТЫ 2.0 — движок (engine.js)
   Транспорт (файл / синт-минус), гранулярный питч-шифтер
   (AudioWorklet), детектор высоты голоса (автокорреляция),
   микрофон, неон-пад. Всё локально: ни один байт не уходит
   из вкладки.
   ============================================================ */

window.KM = (function () {

  /* ---------- утилиты ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t * 10) % 10);
    return m + ':' + String(s).padStart(2, '0') + '.' + d;
  }

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiToName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function octFold(d) { return d - 12 * Math.round(d / 12); }

  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* ---------- хранилище ---------- */
  const PREFIX = 'km2:';
  const Store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) { /* приватный режим */ }
    },
    del(key) { try { localStorage.removeItem(PREFIX + key); } catch (e) {} }
  };

  /* ---------- тосты ---------- */
  let toastTimer = null;
  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------- детектор высоты (автокорреляция) ---------- */
  // Возвращает { freq, conf, rms }; freq=0 — тишина/шум.
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.006) return { freq: 0, conf: 0, rms };

    // обрезаем края по амплитуде (устойчивее к тишине в окне)
    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2 * rms;
    for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; } else break; }
    for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; } else break; }
    const b = buf.slice(r1, r2);
    const N = b.length;
    if (N < 256) return { freq: 0, conf: 0, rms };

    const MAX_SAMPLES = Math.min(N >> 1, 2205); // до ~20 Гц при 44.1к
    const MIN_SAMPLES = Math.floor(sampleRate / 1000); // до 1000 Гц
    const c = new Float32Array(MAX_SAMPLES);
    // нормированная взаимная корреляция
    for (let lag = 0; lag < MAX_SAMPLES; lag++) {
      let sum = 0, n = 0;
      for (let i = 0; i < MAX_SAMPLES; i++) {
        const x = b[i], y = b[i + lag];
        if (i + lag < N) { sum += x * y; n++; }
      }
      c[lag] = n ? sum / n : 0;
    }
    let d = 0; while (d < MAX_SAMPLES - 1 && c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < MAX_SAMPLES; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
    let T0 = maxpos;
    if (T0 <= MIN_SAMPLES || maxval <= 0) return { freq: 0, conf: 0, rms };
    // параболическая интерполяция вершины
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1] !== undefined ? c[T0 + 1] : 0;
    const a2 = (x1 + x3 - 2 * x2) / 2, a3 = (x3 - x1) / 2;
    if (a2) T0 = T0 - a3 / (2 * a2);
    const freq = sampleRate / T0;
    if (freq < 65 || freq > 1200) return { freq: 0, conf: 0, rms };
    return { freq, conf: clamp(maxval, 0, 1), rms };
  }

  /* ---------- гранулярный питч-шифтер (AudioWorklet) ---------- */
  // Классическая схема «пила на линии задержки + перекрёстные окна Ханна».
  const WORKLET_SRC = `
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.G = 2200;                       // зерно, сэмплов (~50 мс)
    this.buf = new Float32Array(16384);  // кольцевой буфер
    this.mask = 16383;
    this.w = 0;
    this.da = 0;                         // задержка линии A
    this.db = this.G / 2;                // задержка линии B
    this.winA = new Float32Array(this.G);
    this.winB = new Float32Array(this.G);
    for (let i = 0; i < this.G; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.G);
      this.winA[i] = w;
      this.winB[(i + this.G / 2) % this.G] = w;
    }
  }
  read(delay) {
    const pos = this.w - delay;
    const i0 = Math.floor(pos);
    const fr = pos - i0;
    const s0 = this.buf[i0 & this.mask];
    const s1 = this.buf[(i0 + 1) & this.mask];
    return s0 + (s1 - s0) * fr;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const out = outputs[0][0];
    if (!out) return true;
    const st = params.semitones.length ? params.semitones[0] : 0;
    const N = out.length;
    if (!input || !input[0]) { out.fill(0); return true; }
    const inCh = input[0];
    if (Math.abs(st) < 0.005) {           // байпас: чистый звук
      for (let i = 0; i < N; i++) {
        this.buf[this.w & this.mask] = inCh[i]; this.w++;
        out[i] = inCh[i];
      }
      return true;
    }
    const k = 1 - Math.pow(2, st / 12);   // скорость дрейфа задержки
    for (let i = 0; i < N; i++) {
      this.buf[this.w & this.mask] = inCh[i]; this.w++;
      const a = this.read(this.da);
      const b = this.read(this.db);
      const ia = Math.floor(this.da) % this.G, ib = Math.floor(this.db) % this.G;
      out[i] = a * this.winA[ia < 0 ? ia + this.G : ia] + b * this.winB[ib < 0 ? ib + this.G : ib];
      this.da += k; if (this.da >= this.G) this.da -= this.G; if (this.da < 0) this.da += this.G;
      this.db += k; if (this.db >= this.G) this.db -= this.G; if (this.db < 0) this.db += this.G;
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);
`;

  /* ---------- общий аудиоконтекст ---------- */
  let ctx = null;
  let master = null;
  let shifterNode = null;
  let shifterReady = false;
  let mediaSrc = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function ensureShifter() {
    ensureCtx();
    if (shifterReady) return shifterNode;
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      shifterNode = new AudioWorkletNode(ctx, 'pitch-shifter', { outputChannelCount: [1] });
      shifterReady = true;
      return shifterNode;
    } catch (e) {
      shifterNode = null;
      return null;
    }
  }

  function setSemitones(n) {
    if (shifterNode && shifterNode.parameters) {
      shifterNode.parameters.get('semitones').value = n;
    }
  }

  /* ---------- транспорт ---------- */
  // Два источника: 'file' (audio-элемент) и 'synth' (встроенный минус).
  const audioEl = () => document.getElementById('audio');

  const Transport = {
    mode: 'file',            // 'file' | 'synth'
    fileName: null,
    playing: false,
    // synth-состояние
    _synth: null,
    _synthStartCtx: 0,
    _synthStartPos: 0,
    _synthPausePos: 0,

    duration() {
      if (this.mode === 'file') {
        const d = audioEl().duration;
        return isFinite(d) ? d : 0;
      }
      return Infinity; // синт лупится — конец считаем по последней строке
    },
    time() {
      if (this.mode === 'file') return audioEl().currentTime;
      if (!this.playing) return this._synthPausePos;
      return this._synthStartPos + (ctx.currentTime - this._synthStartCtx);
    },
    async play() {
      ensureCtx();
      Pad.stop(); // пад умолкает, когда поют
      if (this.mode === 'file') {
        await audioEl().play();
        this.playing = true;
      } else {
        this._synthStartPos = this._synthPausePos;
        this._synthStartCtx = ctx.currentTime;
        this._synth = SynthMinus.start(ctx, master, () => this.semitones || 0);
        this.playing = true;
      }
      document.dispatchEvent(new CustomEvent('km-transport'));
    },
    pause() {
      if (this.mode === 'file') { audioEl().pause(); }
      else {
        this._synthPausePos = this.time();
        if (this._synth) { this._synth.stop(); this._synth = null; }
      }
      this.playing = false;
      document.dispatchEvent(new CustomEvent('km-transport'));
    },
    toggle() { this.playing ? this.pause() : this.play(); },
    seek(t) {
      if (this.mode === 'file') { audioEl().currentTime = clamp(t, 0, Math.max(0, (audioEl().duration || 0) - 0.05)); }
      else { this._synthPausePos = Math.max(0, t); if (this.playing) this._synthStartCtx = ctx.currentTime, this._synthStartPos = this._synthPausePos; }
      document.dispatchEvent(new CustomEvent('km-transport'));
    },
    async useFile(file) {
      ensureCtx();
      const el = audioEl();
      el.src = URL.createObjectURL(file);
      this.fileName = file.name;
      this.mode = 'file';
      if (!mediaSrc) {
        mediaSrc = ctx.createMediaElementSource(el);
        const sh = await ensureShifter();
        if (sh) {
          mediaSrc.connect(sh);
          sh.connect(master);
        } else {
          mediaSrc.connect(master);
          toast('Питч-шифтер недоступен в этом браузере: транспонирование файла отключено, остальное работает', true);
        }
      }
      // если синт играл — остановить
      if (this._synth) { this._synth.stop(); this._synth = null; this.playing = false; }
      document.dispatchEvent(new CustomEvent('km-transport'));
    },
    async useSynth() {
      ensureCtx();
      audioEl().pause();
      audioEl().removeAttribute('src');
      this.mode = 'synth';
      this.fileName = null;
      this._synthPausePos = 0;
      document.dispatchEvent(new CustomEvent('km-transport'));
    },
    // транспонирование
    _semitones: 0,
    get semitones() { return this._semitones; },
    setSemitones(n) {
      this._semitones = n;
      setSemitones(n); // для файла
      // синт читает при старте; если уже играет — перезапустим расписание
      if (this.mode === 'synth' && this.playing && this._synth) {
        const t = this.time();
        this._synth.stop();
        this._synthPausePos = t;
        this._synthStartPos = t;
        this._synthStartCtx = ctx.currentTime;
        this._synth = SynthMinus.start(ctx, master, () => this._semitones);
      }
      document.dispatchEvent(new CustomEvent('km-transport'));
    }
  };

  /* ---------- синт-минус (встроенный бэкинг) ---------- */
  // Прогрессия Am–F–C–G, 96 BPM, 4/4: пад, бас, клик, снейр.
  const SynthMinus = {
    BPM: 96,
    PROG: [
      [57, 60, 64], // Am
      [53, 57, 60], // F
      [48, 52, 55], // C
      [55, 59, 62]  // G
    ],
    start(ctx, dest, getSemis) {
      const st = {
        running: true,
        timer: null,
        nextBeat: 0,
        beatNo: 0,
        nodes: [],
        getSemis: getSemis || (() => 0)
      };
      const spb = 60 / this.BPM; // сек на долю
      st.nextBeat = ctx.currentTime + 0.08;

      const f = m => midiToFreq(m + (st.getSemis() || 0));

      function padChord(t, chord) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.06, t + 0.25);
        g.gain.setValueAtTime(0.06, t + spb * 3.4);
        g.gain.linearRampToValueAtTime(0.0001, t + spb * 4);
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass'; flt.frequency.value = 1100;
        g.connect(flt); flt.connect(dest);
        chord.forEach((m, i) => {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f(m);
          o.detune.value = (i - 1) * 4;
          o.connect(g); o.start(t); o.stop(t + spb * 4.05);
          st.nodes.push(o);
        });
      }
      function bassPulse(t, root, dur) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f(root - 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + dur + 0.05);
        st.nodes.push(o);
      }
      function click(t, accent) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = accent ? 2100 : 1500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(accent ? 0.05 : 0.028, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.05);
        st.nodes.push(o);
      }
      function snare(t) {
        const len = 0.09;
        const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const s = ctx.createBufferSource(); s.buffer = b;
        const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 1800;
        const g = ctx.createGain(); g.gain.value = 0.09;
        s.connect(flt); flt.connect(g); g.connect(dest);
        s.start(t);
        st.nodes.push(s);
      }

      function schedule() {
        if (!st.running) return;
        while (st.nextBeat < ctx.currentTime + 0.15) {
          const t = st.nextBeat;
          const beat = st.beatNo % 4;
          const bar = Math.floor(st.beatNo / 4);
          const chord = SynthMinus.PROG[bar % 4];
          if (beat === 0) padChord(t, chord);
          if (beat === 0 || beat === 2) bassPulse(t, chord[0], spb * 1.8);
          click(t, beat === 0);
          if (beat === 1 || beat === 3) snare(t);
          st.nextBeat += spb;
          st.beatNo++;
        }
      }
      schedule();
      st.timer = setInterval(schedule, 40);
      st.stop = function () {
        st.running = false;
        clearInterval(st.timer);
        st.nodes.forEach(n => { try { n.stop(); } catch (e) {} });
      };
      return st;
    }
  };

  /* ---------- неон-пад (атмосфера между песнями) ---------- */
  const Pad = {
    _st: null,
    on: false,
    toggle() {
      this.on ? this.stop() : this.start();
      return this.on;
    },
    start() {
      const c = ensureCtx();
      if (this._st) return;
      const st = { osc: [], lfo: null, g: ctx.createGain(), timer: null, step: 0 };
      st.g.gain.value = 0;
      st.g.gain.linearRampToValueAtTime(0.05, c.currentTime + 3);
      const flt = c.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 700; flt.Q.value = 0.7;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = c.createGain(); lfoG.gain.value = 260;
      lfo.connect(lfoG); lfoG.connect(flt.frequency); lfo.start();
      st.lfo = lfo;
      flt.connect(st.g); st.g.connect(c.destination);
      const chords = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
      function voice(mm) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(mm);
        o.connect(flt); o.start();
        st.osc.push(o);
        return o;
      }
      function setChord() {
        const ch = chords[st.step % chords.length];
        // плавно: старые гасим, новые заводим
        const old = st.osc; st.osc = [];
        old.forEach(o => { try { o.frequency.linearRampToValueAtTime(o.frequency.value, c.currentTime); o.stop(c.currentTime + 4); } catch (e) {} });
        ch.forEach(m => voice(m));
        st.step++;
      }
      setChord();
      st.timer = setInterval(setChord, 8000);
      this._st = st;
      this.on = true;
    },
    stop() {
      const st = this._st;
      if (!st) return;
      clearInterval(st.timer);
      try { st.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8); } catch (e) {}
      const osc = st.osc, lfo = st.lfo, g = st.g;
      setTimeout(() => {
        osc.forEach(o => { try { o.stop(); } catch (e) {} });
        try { lfo.stop(); } catch (e) {}
        try { g.disconnect(); } catch (e) {}
      }, 900);
      this._st = null;
      this.on = false;
    }
  };

  /* ---------- микрофон ---------- */
  const Mic = {
    stream: null,
    analyser: null,
    buf: null,
    on: false,
    async start() {
      const c = ensureCtx();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const src = c.createMediaStreamSource(this.stream);
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser); // НЕ подключаем к destination — иначе заводка
      this.buf = new Float32Array(this.analyser.fftSize);
      this.on = true;
      return true;
    },
    stop() {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null; this.analyser = null; this.on = false;
    },
    read() {
      if (!this.on || !this.analyser) return { freq: 0, conf: 0, rms: 0 };
      this.analyser.getFloatTimeDomainData(this.buf);
      return autoCorrelate(this.buf, ctx.sampleRate);
    }
  };

  /* ---------- тестовые тоны (Голос) ---------- */
  function playTone(midi, seconds) {
    const c = ensureCtx();
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.value = midiToFreq(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(0.12, c.currentTime + 0.1);
    g.gain.setValueAtTime(0.12, c.currentTime + seconds - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, c.currentTime + seconds);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + seconds + 0.05);
  }

  /* ---------- flatten строк песни ---------- */
  function flattenLines(song) {
    const out = [];
    song.sections.forEach((sec, si) => {
      sec.lines.forEach((text, li) => {
        out.push({ si, li, label: li === 0 ? sec.label : null, type: sec.type, text });
      });
    });
    return out;
  }

  // Навешиваем тайминги: { starts: [sec|null], audioName }
  function getTimings(songId) { return Store.get('timings:' + songId, null); }
  function setTimings(songId, t) { Store.set('timings:' + songId, t); }

  function linesWithTimes(song) {
    const flat = flattenLines(song);
    const tm = getTimings(song.id);
    const starts = tm && tm.starts ? tm.starts : [];
    flat.forEach((l, i) => {
      l.start = typeof starts[i] === 'number' ? starts[i] : null;
    });
    // end = start следующей проставленной строки (или null у последней)
    for (let i = 0; i < flat.length; i++) {
      let end = null;
      for (let j = i + 1; j < flat.length; j++) {
        if (flat[j].start != null) { end = flat[j].start; break; }
      }
      if (end == null && song.durSec) end = song.durSec;
      flat[i].end = end;
    }
    return flat;
  }

  function isSynced(song) {
    const tm = getTimings(song.id);
    return !!(tm && tm.starts && tm.starts.filter(s => typeof s === 'number').length > 0);
  }

  /* ---------- LRC ---------- */
  function toLRC(song, starts) {
    const flat = flattenLines(song);
    const out = [];
    out.push('[ti:' + song.title + ']');
    out.push('[ar:RUVSON]');
    out.push('[al:КАРАОКЕ МЕЧТЫ 2.0 · ЧИСТОВИК]');
    out.push('[offset:0]');
    let lastLabel = null;
    flat.forEach((l, i) => {
      const t = starts[i];
      if (typeof t !== 'number') return;
      if (l.label && l.label !== lastLabel) { out.push('[label:' + l.label + ']'); lastLabel = l.label; }
      const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
      out.push('[' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0') + ']' + l.text);
    });
    return out.join('\n');
  }

  function parseLRC(text) {
    const times = [];
    const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    text.split(/\r?\n/).forEach(line => {
      let lastEnd = 0, m, t = null;
      while ((m = re.exec(line))) {
        const min = +m[1], sec = +m[2];
        const fracRaw = m[3] || '0';
        const frac = +fracRaw / Math.pow(10, fracRaw.length);
        t = min * 60 + sec + frac;
        lastEnd = re.lastIndex;
      }
      const body = line.slice(lastEnd).trim();
      // теги без времени ([ti:..], [label:..]) отсекаются самим регэкспом:
      // t остаётся null → строка пропускается
      if (t != null && body) times.push({ t, text: body });
    });
    times.sort((a, b) => a.t - b.t);
    return times;
  }

  /* ---------- экспорт ---------- */
  return {
    $, $$, clamp, fmtTime, midiToName, freqToMidi, midiToFreq, octFold, median,
    Store, toast, autoCorrelate,
    Transport, Pad, Mic, playTone,
    flattenLines, linesWithTimes, getTimings, setTimings, isSynced,
    toLRC, parseLRC,
    get ctx() { return ctx; }
  };
})();

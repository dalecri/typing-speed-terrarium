// Glue: wire typing test → terrarium + UI + SFX
(function () {
  const promptEl = document.getElementById('promptText');
  const inp = document.getElementById('inp');
  const wpmV = document.getElementById('wpmV');
  const accV = document.getElementById('accV');
  const errV = document.getElementById('errV');
  const timeV = document.getElementById('timeV');
  const timerRing = document.getElementById('timerRing');
  const timerFill = document.getElementById('timerFill');
  const idleBadge = document.getElementById('idleBadge');
  const results = document.getElementById('results');
  const rWpm = document.getElementById('rWpm');
  const rAcc = document.getElementById('rAcc');
  const rErr = document.getElementById('rErr');
  const ecoLine = document.getElementById('ecoLine');
  const verdictT = document.getElementById('verdictT');
  const btnReset = document.getElementById('btnReset');
  const presets = document.getElementById('presets');
  const soundTog = document.getElementById('soundTog');
  const soundLabel = document.getElementById('soundLabel');
  const history = document.getElementById('history');
  const historyRows = document.getElementById('historyRows');
  const bestLine = document.getElementById('bestLine');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const promptWrap = document.querySelector('.prompt-wrap');
  const legendEl = document.querySelector('.legend');

  // ---- Run history (localStorage) ----
  const HISTORY_KEY = 'tst_runs_v1';
  const MAX_HISTORY = 20;

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveHistory(runs) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(runs)); }
    catch (e) { /* quota / private mode — silently ignore */ }
  }
  function addRun(run) {
    const runs = loadHistory();
    runs.unshift(run);
    if (runs.length > MAX_HISTORY) runs.length = MAX_HISTORY;
    saveHistory(runs);
    return runs;
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function renderHistory(highlightTs) {
    const runs = loadHistory();
    if (runs.length === 0) {
      historyRows.innerHTML = '<div class="empty">No runs yet — start typing to grow one.</div>';
      bestLine.textContent = '';
      return;
    }
    const topWpm = Math.max(...runs.map(r => r.wpm));
    bestLine.textContent = `Best · ${topWpm} WPM`;
    historyRows.innerHTML = runs.map(r => {
      const isTop = r.wpm === topWpm;
      const isHighlight = r.ts === highlightTs;
      return `
        <div class="row${isHighlight ? ' highlight' : ''}">
          <div class="date">${fmtDate(r.ts)}</div>
          <div class="wpm${isTop ? ' top' : ''}">${r.wpm}w</div>
          <div class="acc">${r.accuracy}%</div>
          <div class="mode">${r.duration}s</div>
        </div>
      `;
    }).join('');
  }

  // ---- Sound: WebAudio small synth cues ----
  let audioCtx = null;
  let soundOn = true;
  function ac() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { soundOn = false; }
    }
    return audioCtx;
  }
  function tick(pitch = 1) {
    if (!soundOn) return;
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(720 * pitch + (Math.random() * 40 - 20), c.currentTime);
    g.gain.setValueAtTime(0.05, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.08);
  }
  function chime() {
    if (!soundOn) return;
    const c = ac(); if (!c) return;
    const freqs = [660, 880, 1320];
    freqs.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t0 = c.currentTime + i * 0.04;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + 0.55);
    });
  }
  function thud() {
    if (!soundOn) return;
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(35, c.currentTime + 0.22);
    f.type = 'lowpass'; f.frequency.value = 400;
    g.gain.setValueAtTime(0.28, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    o.connect(f).connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.3);
    // noise burst
    const buf = c.createBuffer(1, 0.15 * c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const ng = c.createGain(); ng.gain.value = 0.08;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 1200;
    src.connect(nf).connect(ng).connect(c.destination);
    src.start();
  }
  function err() {
    if (!soundOn) return;
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(160, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(90, c.currentTime + 0.08);
    g.gain.setValueAtTime(0.05, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.12);
  }

  soundTog.addEventListener('click', () => {
    soundOn = !soundOn;
    soundLabel.textContent = soundOn ? 'Sound' : 'Muted';
    soundTog.style.opacity = soundOn ? '1' : '0.55';
  });

  // ---- Initialize terrarium ----
  Terrarium.init(document.getElementById('scene'));
  Terrarium.setOnGrowth(() => chime());
  Terrarium.setOnRockLand(() => thud());

  // ---- State ----
  let duration = 30;
  let mode = 'beginner';
  let wordsCompleted = 0;

  function updateTimerBar(remaining) {
    const pct = clamp(remaining / duration, 0, 1);
    timerFill.style.transform = `scaleX(${pct})`;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Create test
  const test = new window.TypingTest({
    promptEl, inputEl: inp, durationSec: duration, mode,
    onEvent: (e) => {
      if (e.type === 'start') {
        idleBadge.classList.remove('show');
        timerRing.classList.add('show');
      } else if (e.type === 'tick') {
        wpmV.textContent = e.wpm;
        accV.textContent = e.accuracy;
        errV.textContent = e.errors;
        timeV.textContent = Math.ceil(e.remaining);
        updateTimerBar(e.remaining);
        Terrarium.setWPM(e.wpm);
      } else if (e.type === 'char-ok') {
        tick(1 + (Math.random() * 0.15));
      } else if (e.type === 'typo') {
        err();
        // drop rock near typo — map progress to gridX (0..BOX_W-1)
        const gridX = Math.floor(e.progress * 9) % 9;
        Terrarium.dropRock(gridX);
      } else if (e.type === 'word-complete') {
        wordsCompleted++;
        // 1-2 growth ticks per word
        Terrarium.growPlant(wordsCompleted);
        if (wordsCompleted % 3 === 0) Terrarium.growPlant(wordsCompleted);
      } else if (e.type === 'word-skipped') {
        // nothing visual; already errored chars
      } else if (e.type === 'restart') {
        restart();
      } else if (e.type === 'end') {
        finish(e);
      }
    },
  });

  // Focus input
  function focusInput() { inp.focus({ preventScroll: true }); }
  document.body.addEventListener('click', () => focusInput());
  promptEl.parentElement.addEventListener('click', () => focusInput());
  setTimeout(focusInput, 100);

  // Presets (time + mode)
  presets.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.t) {
        presets.querySelectorAll('button[data-t]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        duration = parseInt(b.dataset.t, 10);
        timeV.textContent = duration;
        idleBadge.querySelector('.sub').textContent = `click anywhere \u00b7 ${duration} seconds \u00b7 ${modeLabel()}`;
      } else if (b.dataset.m) {
        presets.querySelectorAll('button[data-m]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        mode = b.dataset.m;
        idleBadge.querySelector('.sub').textContent = `click anywhere \u00b7 ${duration} seconds \u00b7 ${modeLabel()}`;
      }
      restart();
    });
  });

  function modeLabel() {
    return mode === 'quotes' ? 'famous quotes' : 'beginner words';
  }

  function restart() {
    wordsCompleted = 0;
    results.classList.remove('show');
    history.classList.remove('show');
    promptWrap.classList.remove('dim');
    legendEl.classList.remove('dim');
    timerRing.classList.remove('show');
    idleBadge.classList.add('show');
    timerFill.style.transform = 'scaleX(1)';
    wpmV.textContent = '0';
    accV.textContent = '100';
    errV.textContent = '0';
    timeV.textContent = duration;
    Terrarium.reset();
    test.reset(duration, mode);
    focusInput();
  }

  function finish(e) {
    timerRing.classList.remove('show');
    rWpm.textContent = e.wpm;
    rAcc.textContent = e.accuracy + '%';
    rErr.textContent = e.errors;
    const snap = Terrarium.snapshot();
    ecoLine.innerHTML = `
      <span><i style="background:oklch(0.72 0.14 145)"></i>${snap.plantCount} plants</span>
      <span><i style="background:oklch(0.6 0.03 270)"></i>${snap.rockCount} rocks</span>
      <span><i style="background:oklch(0.88 0.16 85)"></i>${snap.fireflyCount} fireflies</span>
    `;
    verdictT.innerHTML = verdictFor(e.wpm, e.accuracy);

    // Record this run + refresh history panel
    const ts = Date.now();
    addRun({
      ts,
      wpm: e.wpm,
      accuracy: e.accuracy,
      errors: e.errors,
      duration,
      mode,
      plants: snap.plantCount,
      rocks: snap.rockCount,
      fireflies: snap.fireflyCount,
    });
    renderHistory(ts);

    // Dim prompt + legend so the terrarium is visible in the center
    promptWrap.classList.add('dim');
    legendEl.classList.add('dim');

    setTimeout(() => {
      results.classList.add('show');
      history.classList.add('show');
    }, 300);
  }

  function verdictFor(wpm, acc) {
    if (wpm >= 90 && acc >= 95) return 'A <span class="em">luminous grove</span>.';
    if (wpm >= 70) return 'The glass <span class="em">hums with fireflies</span>.';
    if (wpm >= 55) return 'Ferns unfurl in <span class="em">soft dusk</span>.';
    if (wpm >= 40) return 'A first <span class="em">firefly</span> wakes.';
    if (wpm >= 25) return 'Moss creeps along the soil.';
    if (wpm >= 10) return 'A quiet meadow begins.';
    return 'Seeds wait in the dark.';
  }

  btnReset.addEventListener('click', () => {
    restart();
  });

  btnClearHistory.addEventListener('click', () => {
    if (confirm('Clear all run history?')) {
      saveHistory([]);
      renderHistory();
    }
  });
})();

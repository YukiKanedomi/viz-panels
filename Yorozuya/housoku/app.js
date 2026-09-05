/* app.js — 上演側（Phase 1〜3）
   物理は事前計算済み（timeline.js）。台本は director.js。ここでは再生・スクラブ・ゴースト・分岐点・描画（影・版ずれ）・音・HUD を行う。
   見た目の規則は Codex の指定（review2-codex.md §C 共通規則・§D）に従う。 */
(function () {
  'use strict';
  const TL = window.TIMELINE, D = window.Director;
  const W = TL.W, H = TL.H, G = TL.G, Q = 10, QA = 1000, FPS = TL.fps;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const lawsEl = document.getElementById('laws');
  const lawBtns = Array.from(lawsEl.querySelectorAll('.law'));
  const playBtn = document.getElementById('play'), slowBtn = document.getElementById('slow'), ghostBtn = document.getElementById('ghost');
  const againBtn = document.getElementById('again'), sndBtn = document.getElementById('snd');
  const track = document.getElementById('track'), knob = document.getElementById('knob'), marks = document.getElementById('marks');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);

  const META = {
    normal:   { label: 'いつもの重力', line: 'いつもの順番で動く',   end: '受け皿に入り、鐘が鳴った。',   tint: 'rgba(217,161,43,.22)' },
    jelly:    { label: 'ぜんぶゼリー', line: 'ぶつかるたび、よく弾む', end: '跳ね返り、小さな玉は飛ばなかった。', tint: 'rgba(47,111,116,.26)' },
    inverted: { label: 'さかさ重力',   line: '上へ落ちていく',       end: '天井の鐘に届いた。',           tint: 'rgba(200,68,44,.22)' },
    magnet:   { label: '右へ磁石',     line: 'みんな右へ引かれる',   end: '右の磁石に集まった。',         tint: 'rgba(43,42,40,.18)' },
  };
  const COL = { paper: '#efe3c8', paper2: '#f7efdc', ink: '#2b2a28', red: '#c8442c', blue: '#2f6f74', mustard: '#d9a12b' };

  // 「一つだけ変える」の表示は実数から生成する（手入力しない）
  function quantityText(law) {
    const P = TL.LAW[law], B = TL.LAW.normal, g = (v) => (v > 0 ? '↓' : '↑') + Math.abs(v).toFixed(2);
    if (law === 'normal') return { main: '重力 ' + g(P.gravityY) + '（基準）', aid: null };
    if (law === 'jelly') return { main: '反発 ' + B.restitution.toFixed(2) + ' → ' + P.restitution.toFixed(2), aid: '補助：' + P.aid };
    if (law === 'inverted') return { main: '重力 ' + g(B.gravityY) + ' → ' + g(P.gravityY), aid: null };
    if (law === 'magnet') return { main: '磁力 0.00 → ' + (P.magnet * TL.dt2).toFixed(2) + ' px/f²', aid: '重力 ' + g(P.gravityY) + '／補助：' + P.aid };
    return { main: '', aid: null };
  }

  // ---- 画像（Phase 3 の新素材があれば使い、無ければ旧素材へ後退） ----
  const NAMES = ['paper-background-v3', 'paper-background', 'route-guide', 'slide', 'ball-a', 'ball-b', 'ball-c', 'domino', 'slope', 'shelf', 'seesaw', 'fulcrum', 'c-ledge', 'stop-under', 'arm-stop', 'floor-stop', 'chute-01', 'chute-02', 'chute-03', 'chute-04', 'catcher', 'bell-bottom', 'bell-top', 'magnet-body', 'magnet-emblem', 'magnet', 'jelly-overlay', 'post'];
  const IMG = {}, MASK = {}, SHADOW = {};
  let imgTick = 0, lastImgTick = -1;
  NAMES.forEach(n => { const im = new Image(); im.decoding = 'async'; im.src = 'assets/' + n + '.webp'; im.onload = () => { IMG[n] = im; imgTick++; }; });
  (function () { const g = document.getElementById('gallery'); if (!g) return; NAMES.forEach(n => { const f = document.createElement('figure'); const im = document.createElement('img'); im.src = 'assets/' + n + '.webp'; im.alt = n; im.loading = 'lazy'; im.onerror = () => f.remove(); f.appendChild(im); f.appendChild(document.createTextNode(n)); g.appendChild(f); }); })();
  // 墨のアルファマスク（影と版ずれの基準輪郭に使う）。画像ごとに一度だけ作る
  function maskOf(name) {
    if (MASK[name]) return MASK[name];
    const im = IMG[name]; if (!im) return null;
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = COL.ink; g.fillRect(0, 0, c.width, c.height);
    return (MASK[name] = c);
  }
  const canFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
  // ぼかした影は画像ごとに一度だけ作る（毎フレームの filter は headless や低速端末で桁違いに遅い）
  function shadowOf(name) {
    if (SHADOW[name]) return SHADOW[name];
    const m = maskOf(name); if (!m) return null;
    const pad = 6, c = document.createElement('canvas'); c.width = m.width + pad * 2; c.height = m.height + pad * 2;
    const g = c.getContext('2d'); if (canFilter) g.filter = 'blur(2.4px)'; g.drawImage(m, pad, pad);
    return (SHADOW[name] = { c, pad });
  }

  // ---- 音（Web Audio 合成） ----
  let AC = null, soundOn = false, unlocked = false, lastClick = 0;
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } } return AC; }
  function env(node, t0, a, d, peak) { const g = ac().createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); node.connect(g); g.connect(ac().destination); return g; }
  // 材質別フォーリー（合成のみ）: 紙の玉＝柔らかい低音、木のドミノ＝帯域ノイズ＋木の共鳴、金属の鐘＝倍音の長い減衰、ゼリー＝ビブラート付き下降音
  let noiseBuf = null;
  function noise() { if (noiseBuf) return noiseBuf; const n = ac().sampleRate * 0.25, b = ac().createBuffer(1, n, ac().sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return (noiseBuf = b); }
  function burst(now, freq, q, dur, peak) { const s = ac().createBufferSource(); s.buffer = noise(); const f = ac().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; s.connect(f); env(f, now, 0.002, dur, peak); s.start(now); s.stop(now + dur + 0.05); }
  function tone(now, type, f0, f1, dur, peak, a) { const o = ac().createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, now); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, now + dur * 0.8); env(o, now, a || 0.004, dur, peak); o.start(now); o.stop(now + dur + 0.05); return o; }
  const sfx = {
    click(v) { // 木のドミノ: カタッ（速度でピッチと音量が変わる）
      if (!soundOn || !ac()) return; const now = ac().currentTime; if (now - lastClick < 0.04) return; lastClick = now;
      const k = Math.min(1, (v || 1) / 4); burst(now, 2600 + 900 * k, 1.8, 0.05, 0.22 + 0.25 * k); tone(now, 'triangle', 520 + 120 * k, 420, 0.07, 0.10 + 0.10 * k); },
    thud() { // 重い玉がシーソーへ: 低いドン＋木のきしみ
      if (!soundOn || !ac()) return; const now = ac().currentTime; tone(now, 'sine', 110, 42, 0.28, 0.7); burst(now, 700, 0.9, 0.09, 0.35); },
    creak() { if (!soundOn || !ac()) return; const now = ac().currentTime + 0.05; const o = ac().createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(190, now); o.frequency.linearRampToValueAtTime(300, now + 0.3); const f = ac().createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; o.connect(f); env(f, now, 0.03, 0.32, 0.07); o.start(now); o.stop(now + 0.4); },
    boing() { // ゼリー: ぼよん（ビブラート）
      if (!soundOn || !ac()) return; const now = ac().currentTime; const o = tone(now, 'sine', 560, 170, 0.42, 0.4, 0.01); const lfo = ac().createOscillator(); lfo.frequency.value = 11; const g = ac().createGain(); g.gain.value = 22; lfo.connect(g); g.connect(o.frequency); lfo.start(now); lfo.stop(now + 0.5); burst(now, 900, 1.2, 0.06, 0.12); },
    bell(hi) { // 金の鐘: 倍音3本＋わずかな揺らぎ
      if (!soundOn || !ac()) return; const now = ac().currentTime; const base = hi ? 1320 : 880;
      [[1, 1.0, 1.9], [2.0, 0.45, 1.3], [2.76, 0.35, 1.0], [5.4, 0.12, 0.6]].forEach(([r, a, d], i) => { const o = ac().createOscillator(); o.type = 'sine'; o.frequency.value = base * r * (i === 1 ? 1.003 : 1); env(o, now, 0.003, d, 0.32 * a); o.start(now); o.stop(now + d + 0.05); });
      burst(now, 4000, 2, 0.03, 0.15); },
    tap() { // 磁石・壁・天井: 金属のカチッ
      if (!soundOn || !ac()) return; const now = ac().currentTime; tone(now, 'sine', 1240, 1180, 0.08, 0.16); tone(now, 'sine', 1930, 1900, 0.06, 0.08); burst(now, 3200, 3, 0.03, 0.1); },
    paper(v) { // 紙の玉が板に落ちる: 柔らかいトン
      if (!soundOn || !ac()) return; const now = ac().currentTime; const k = Math.min(1, (v || 1) / 5); tone(now, 'sine', 240 + 80 * k, 120, 0.12, 0.18 + 0.2 * k); burst(now, 1200, 0.8, 0.04, 0.08); },
  };
  function unlockAudio() { if (unlocked) return; unlocked = true; const a = ac(); if (a && a.state === 'suspended') a.resume(); }

  // 法則別の音楽モチーフ（Codex 仕様 review3-codex.md §B）: 短い署名。同時2音まで、各音240ms以内、フォーリーの35%以下
  const NOTE = { C4: 261.63, Eb4: 311.13, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, Bb4: 466.16, C5: 523.25, D4: 293.66, D5: 587.33 };
  const MOTIF = {
    normal:   { bpm: 92,  notes: ['C4', 'E4', 'G4'], timbre: 'xylo', resolve: 'C5' },
    jelly:    { bpm: 104, notes: ['C4', 'G4'], later: ['Eb4', 'C4'], timbre: 'rubber' },
    inverted: { bpm: 76,  notes: ['C4', 'F4', 'Bb4'], timbre: 'whistle' },
    magnet:   { bpm: 110, notes: ['D4', 'A4', 'D5'], timbre: 'pluck', pan: [0, 0.45, 0.8] },
  };
  function motifNote(when, name, timbre, pan) {
    if (!soundOn || !ac()) return;
    const a = ac(), f = NOTE[name], t0 = Math.max(a.currentTime, when), rel = 0.16, peak = 0.11;
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06 + rel);
    let out = g;
    if (pan != null && a.createStereoPanner) { const p = a.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(a.destination);
    if (timbre === 'xylo') { const o = a.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t0); o.stop(t0 + 0.24); const s = a.createBufferSource(); s.buffer = noise(); const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 4; bp.Q.value = 6; const ng = a.createGain(); ng.gain.setValueAtTime(0.25, t0); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05); s.connect(bp); bp.connect(ng); ng.connect(g); s.start(t0); s.stop(t0 + 0.06); }
    else if (timbre === 'rubber') { const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 1.06, t0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.03); const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; o.connect(lp); lp.connect(g); o.start(t0); o.stop(t0 + 0.24); }
    else if (timbre === 'whistle') { const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = f * 2; const o2 = a.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2; const g2 = a.createGain(); g2.gain.value = 0.25; o.connect(g); o2.connect(g2); g2.connect(g); o.start(t0); o2.start(t0); o.stop(t0 + 0.24); o2.stop(t0 + 0.24); }
    else { const o = a.createOscillator(); o.type = 'square'; o.frequency.value = f; const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 4; o.connect(bp); bp.connect(g); o.start(t0); o.stop(t0 + 0.2); }
  }
  function playMotif(names, pans) { if (!soundOn || !ac()) return; const m = MOTIF[law], step = 60 / m.bpm; names.forEach((n, i) => motifNote(ac().currentTime + i * step, n, m.timbre, pans ? pans[i] : null)); }
  const haptic = (p) => { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } };

  // ---- 再生状態 ----
  let law = 'normal', L = TL.laws.normal, BASE = TL.laws.normal;
  let t = 0, playing = false, userSlow = false, ghostOn = true, scrubbing = false;
  let idleLeft = 0, evIndex = 0, flash = null, tween = null, dir = null;
  let effects = [], squash = {}, jellyBoinged = false, bellRang = { bottom: -1, top: -1 };
  let firstEndingShown = false, magnetAppear = 0, lastTs = 0, acc = 0;
  const fastEnd = params.get('fast') === '1' || params.get('t') === 'end';
  const camOff = params.get('cam') === '0' || reduced;

  function poseAt(TLlaw, f) {
    const fr = TLlaw.frames, n = fr.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1), k = Math.min(1, Math.max(0, f - i0));
    const A = fr[i0], B = fr[i1], out = [];
    for (let i = 0; i < TLlaw.bodies.length; i++) {
      const x0 = A[i * 3] / Q, y0 = A[i * 3 + 1] / Q, a0 = A[i * 3 + 2] / QA, x1 = B[i * 3] / Q, y1 = B[i * 3 + 1] / Q, a1 = B[i * 3 + 2] / QA;
      out.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, a: a0 + (a1 - a0) * k });
    }
    return out;
  }
  const endFrame = () => L.frames.length - 1;
  const speedAt = (f) => (userSlow ? 0.25 : (camOff ? 1 : D.speedAt(f, dir)));

  function setLaw(newLaw, opts) {
    opts = opts || {};
    const from = poseAt(L, t);
    law = newLaw; L = TL.laws[law]; dir = D.build(law, L);
    effects = []; squash = {}; jellyBoinged = false; bellRang = { bottom: -1, top: -1 }; magnetAppear = 0; evIndex = 0; t = 0; motifFired = {}; userStarted = !opts.initial;
    if (!opts.initial) { // カードを差し込む合図（ゼリーは前2音、磁石は1音）
      if (law === 'jelly') playMotif(MOTIF.jelly.notes); else if (law === 'magnet') playMotif(['D4'], [0]);
    }
    lawBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.law === law)));
    canvas.setAttribute('aria-label', '連鎖装置。法則は' + META[law].label + '、' + META[law].line + '。');
    buildMarks();
    if (opts.initial) { idleLeft = reduced ? 1 : dir.idle; playing = true; tween = null; flash = null; }
    else { idleLeft = reduced ? 0 : Math.max(0, dir.idle - 24); playing = true; tween = reduced ? null : { from, n: 0, total: 21 }; flash = (reduced || law === 'normal') ? null : { t: 0, total: 15, text: META[law].label, tint: META[law].tint }; }
    if (fastEnd) { t = endFrame(); playing = false; tween = null; flash = null; idleLeft = 0; syncToTime(); }
    else if (params.get('t') && !isNaN(+params.get('t')) && opts.initial) { t = Math.min(endFrame(), +params.get('t')); playing = false; idleLeft = 0; syncToTime(); }
    updatePlayBtn();
  }
  function syncToTime() {
    evIndex = 0; while (evIndex < L.events.length && L.events[evIndex].f <= t) evIndex++;
    bellRang = { bottom: (L.arrival === 'catcher' && L.arrivedFrame <= t) ? L.arrivedFrame : -1, top: (L.arrival === 'bellTop' && L.arrivedFrame <= t) ? L.arrivedFrame : -1 };
    if (law === 'magnet') magnetAppear = 1;
  }
  function fireEventsUpTo(f) {
    const evs = L.events;
    while (evIndex < evs.length && evs[evIndex].f <= f) {
      const e = evs[evIndex++];
      if (e.t === 'impact') {
        const pair = e.a + '|' + e.b;
        if (law === 'jelly') {
          if (e.v > 1.2) effects.push({ x: e.x, y: e.y, t: 0, total: 26 });
          [e.a, e.b].forEach(lbl => { if (L.bodies.some(b => b.label === lbl)) squash[lbl] = { t: 0, total: 14, k: Math.min(0.28, e.v * 0.05) }; });
          if (!jellyBoinged && e.v > 2.5) { jellyBoinged = true; sfx.boing(); }
          continue;
        }
        if (/ballB/.test(pair) && /seesaw/.test(pair)) { sfx.thud(); sfx.creak(); continue; }
        if (/wallR|ceiling|magnetBody/.test(pair) && e.v > 1.5) { sfx.tap(); continue; }
        if (/domino/.test(pair) && e.v > 0.9) { sfx.click(e.v); continue; }
        if (/ball[ABC]/.test(pair) && /slope|shelf|chute|seesaw|floor|catcher|cLedge|armStop/.test(pair) && e.v > 1.2) sfx.paper(e.v);
      } else if (e.t === 'arrive') {
        if (e.what === 'catcher') { bellRang.bottom = e.f; sfx.bell(false); if (law === 'normal') motifNote(ac() ? ac().currentTime + 0.05 : 0, MOTIF.normal.resolve, 'xylo'); }
        else if (e.what === 'bellTop') { bellRang.top = e.f; sfx.bell(true); }
        else if (e.what === 'magnet') { sfx.tap(); playMotif(['D5'], [0.8]); }
        if (userStarted) haptic(e.what === 'catcher' || e.what === 'bellTop' ? [10, 35, 16] : 14);
      }
    }
    // モチーフの節目（法則ごとの合図）
    const A = L.anchors;
    if (law === 'jelly' && A.hitD0 >= 0 && !motifFired.hit && f >= A.hitD0) { motifFired.hit = true; playMotif(MOTIF.jelly.later); }
    if (law === 'inverted' && !motifFired.rise && f >= 2) { motifFired.rise = true; playMotif(MOTIF.inverted.notes); }
    if (law === 'magnet' && A.cMove >= 0 && !motifFired.move && f >= A.cMove) { motifFired.move = true; playMotif(['A4'], [0.45]); }
    if (law === 'normal' && !motifFired.start && f >= 1) { motifFired.start = true; playMotif(MOTIF.normal.notes); }
  }
  let motifFired = {}, userStarted = false;
  function onEnded() {
    playing = false; updatePlayBtn(); markSeen(law);
    canvas.setAttribute('aria-label', '連鎖装置。法則は' + META[law].label + '。結末: ' + META[law].end);
    if (!firstEndingShown && !reduced) { firstEndingShown = true; lawsEl.classList.add('lift'); setTimeout(() => lawsEl.classList.remove('lift'), 320); }
  }

  // ---- スクラブバー ----
  function buildMarks() {
    marks.innerHTML = '';
    const n = endFrame();
    const add = (f, cls, title) => { const s = document.createElement('span'); s.className = 'mk ' + cls; s.style.left = (f / n * 100) + '%'; if (title) s.title = title; marks.appendChild(s); };
    L.events.forEach(e => { if (e.t === 'impact' && e.v > 1.0) add(e.f, 'hit', ''); });
    if (L.divergence) add(L.divergence.f, 'div', 'ここで基準と分かれた');
    if (L.arrivedFrame > 0) add(L.arrivedFrame, 'arr', '到着');
  }
  function updateKnob() { knob.style.setProperty('--k', String(t / endFrame())); track.setAttribute('aria-valuenow', String(Math.round(t / FPS * 10) / 10)); track.setAttribute('aria-valuemax', String(Math.round(endFrame() / FPS * 10) / 10)); }
  let crossedDiv = false;
  function scrubTo(clientX) {
    const r = track.getBoundingClientRect(); const k = Math.min(1, Math.max(0, (clientX - r.left - 10) / (r.width - 20)));
    const before = t; t = k * endFrame(); idleLeft = 0; tween = null; flash = null; syncToTime();
    if (L.divergence && !crossedDiv && ((before < L.divergence.f) !== (t < L.divergence.f))) { crossedDiv = true; haptic(6); }
    draw();
  }
  track.addEventListener('pointerdown', e => { unlockAudio(); scrubbing = true; playing = false; updatePlayBtn(); track.setPointerCapture(e.pointerId); scrubTo(e.clientX); });
  track.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e.clientX); });
  track.addEventListener('pointerup', () => { scrubbing = false; });
  track.addEventListener('pointercancel', () => { scrubbing = false; });
  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); playing = false; updatePlayBtn(); t = Math.min(endFrame(), Math.max(0, t + (e.key === 'ArrowRight' ? 2 : -2) * (e.shiftKey ? 5 : 1))); syncToTime(); draw(); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });

  // ---- 操作 ----
  function updatePlayBtn() { playBtn.textContent = playing ? '一時停止' : (t >= endFrame() ? 'はじめから' : '再生'); playBtn.setAttribute('aria-pressed', String(playing)); }
  function togglePlay() { unlockAudio(); if (playing) playing = false; else { if (t >= endFrame()) { t = 0; evIndex = 0; bellRang = { bottom: -1, top: -1 }; effects = []; jellyBoinged = false; } playing = true; idleLeft = 0; } updatePlayBtn(); }
  playBtn.addEventListener('click', togglePlay);
  slowBtn.addEventListener('click', () => { unlockAudio(); userSlow = !userSlow; slowBtn.setAttribute('aria-pressed', String(userSlow)); slowBtn.textContent = userSlow ? 'スロー ×0.25' : 'スロー'; });
  ghostBtn.addEventListener('click', () => { ghostOn = !ghostOn; ghostBtn.setAttribute('aria-pressed', String(ghostOn)); draw(); });
  // 法則カードの差し込み（Codex §B: 0〜90ms 手前へ → 90〜210ms スロットへ → 210〜300ms 着座）。連打は最後の選択だけ採用
  let insertTimer = null;
  lawBtns.forEach(b => b.addEventListener('click', () => {
    unlockAudio(); haptic(8);
    lawBtns.forEach(x => x.classList.remove('insert'));
    if (reduced) { setLaw(b.dataset.law, {}); return; }
    b.classList.add('insert');
    if (insertTimer) clearTimeout(insertTimer);
    insertTimer = setTimeout(() => { b.classList.remove('insert'); haptic(12); setLaw(b.dataset.law, {}); insertTimer = null; }, 300);
  }));
  // 共有: 最後に見た法則と時刻を URL に含める
  const shareBtn = document.getElementById('share');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?law=' + law + '&t=' + Math.round(t);
    const data = { title: '法則をひとつ変えたら', text: '同じ連鎖装置を、四つの法則で見比べる。', url };
    try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); shareBtn.querySelector('span').textContent = 'リンクをコピーしました'; setTimeout(() => { shareBtn.querySelector('span').textContent = '共有'; }, 1800); } catch (e) { prompt('このリンクを共有', url); }
  });
  againBtn.addEventListener('click', () => { unlockAudio(); setLaw(law, {}); });
  sndBtn.addEventListener('click', () => { unlockAudio(); soundOn = !soundOn; sndBtn.setAttribute('aria-pressed', String(soundOn)); sndBtn.textContent = soundOn ? '音あり' : '音なし'; if (soundOn) sfx.click(1); });
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 150));
  document.addEventListener('keydown', e => { if (e.target === track || /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) return; if (e.key === ' ') { e.preventDefault(); togglePlay(); } });

  // ---- 描画 ----
  let S = 1, cam = D.WHOLE, curPose = [];
  function fit() {
    const stage = canvas.parentElement, side = document.querySelector('.side'), header = document.querySelector('header');
    const landscape = window.matchMedia('(min-width:700px) and (orientation:landscape)').matches;
    let availH = window.innerHeight - header.offsetHeight - (landscape ? 30 : (side.offsetHeight + 40));
    availH = Math.max(320, availH);
    const w = Math.max(240, Math.min(stage.clientWidth, availH * W / H, 420));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = w + 'px'; canvas.style.height = (w * H / W) + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * H / W * dpr);
    ctx.imageSmoothingEnabled = true;
    draw();
  }
  const worldTransform = () => { ctx.setTransform(S, 0, 0, S, 0, 0); ctx.translate(W / 2, H / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.cx, -cam.cy); };
  const screenTransform = () => ctx.setTransform(S, 0, 0, S, 0, 0);
  const project = (x, y) => ({ x: (x - cam.cx) * cam.z + W / 2, y: (y - cam.cy) * cam.z + H / 2 });

  // 素材の描き方（Codex §C 共通規則）: 影(墨 .16, 右2/下3, blur1.2) → 墨の基準輪郭 → 色版を右0.55/上0.35ずらす
  const FIXED_SHADOW = { dx: 1.5, dy: 2 }, MOVING_SHADOW = { dx: 2, dy: 3 };
  function paper(name, x, y, w, h, angle, kind, fallback) {
    const im = IMG[name];
    ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle);
    if (!im) { ctx.fillStyle = fallback || COL.ink; if (kind === 'circle') { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore(); return; }
    const mask = maskOf(name), sh = kind === 'fixed' ? FIXED_SHADOW : MOVING_SHADOW;
    if (mask && kind !== 'flat') {
      // 影はワールド座標で一定方向（回転に影響されない）。ぼかしは事前計算済み
      const s = shadowOf(name), kx = w / mask.width, ky = h / mask.height;
      ctx.save(); ctx.rotate(-(angle || 0)); ctx.translate(sh.dx, sh.dy); ctx.rotate(angle || 0);
      ctx.globalAlpha = 0.16;
      ctx.drawImage(s.c, -w / 2 - s.pad * kx, -h / 2 - s.pad * ky, w + 2 * s.pad * kx, h + 2 * s.pad * ky); ctx.restore();
      ctx.drawImage(mask, -w / 2, -h / 2, w, h);                      // 墨の基準輪郭（当たり判定を示す）
      ctx.drawImage(im, -w / 2 + 0.55, -h / 2 - 0.35, w, h);        // 色版の版ずれ
    } else ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  function label(text, x, y, o) {
    o = o || {}; ctx.save();
    ctx.font = (o.weight || 600) + ' ' + (o.size || 12) + 'px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = o.align || 'left';
    const m = ctx.measureText(text).width, pad = 7, h = (o.size || 12) + 10;
    const bx = x - (o.align === 'center' ? m / 2 + pad : (o.align === 'right' ? m + pad : pad));
    ctx.fillStyle = o.bg || 'rgba(247,239,220,.92)'; ctx.fillRect(bx, y - h / 2, m + pad * 2, h);
    ctx.strokeStyle = 'rgba(43,42,40,.35)'; ctx.lineWidth = 1; ctx.strokeRect(bx + .5, y - h / 2 + .5, m + pad * 2 - 1, h - 1);
    if (o.tick) { ctx.strokeStyle = COL.red; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + 3, y); ctx.lineTo(bx + 9, y); ctx.stroke(); }
    ctx.fillStyle = o.color || COL.ink; ctx.fillText(text, x + (o.tick ? 8 : 0), y + 1); ctx.restore();
    return { w: m + pad * 2, h, x: bx, y: y - h / 2 };
  }
  function bodyPose(i) {
    const p = curPose[i];
    if (tween && tween.from && tween.from[i]) { const k = tween.n / tween.total, s = D.smooth(k), f = tween.from[i]; return { x: f.x + (p.x - f.x) * s, y: f.y + (p.y - f.y) * s, a: f.a + (p.a - f.a) * s }; }
    return p;
  }
  const colorOf = (img) => /ball-a/.test(img) ? COL.red : /ball-b/.test(img) ? COL.blue : /ball-c/.test(img) ? COL.mustard : /shelf|seesaw|chute/.test(img) ? COL.mustard : /slope|slide/.test(img) ? COL.red : COL.ink;

  function draw() {
    S = canvas.width / W;
    cam = (tween || idleLeft > 0 || camOff) ? D.WHOLE : D.camAt(t, dir, L, poseAt);
    curPose = poseAt(L, t);
    screenTransform(); ctx.clearRect(0, 0, W, H); ctx.fillStyle = COL.paper; ctx.fillRect(0, 0, W, H);
    worldTransform();
    const bg = IMG['paper-background-v3'] || IMG['paper-background'];
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = COL.paper2; ctx.fillRect(0, 0, W, H); }
    if (IMG['route-guide']) ctx.drawImage(IMG['route-guide'], 0, 0, W, H);
    else { // 経路ガイドが届くまでの仮: 裁ち落とし印と部品番号
      ctx.save(); ctx.strokeStyle = COL.red; ctx.lineWidth = 1;
      [[6, 6, 1, 1], [W - 6, 6, -1, 1], [6, H - 6, 1, -1], [W - 6, H - 6, -1, -1]].forEach(([x, y, dx, dy]) => { ctx.beginPath(); ctx.moveTo(x, y + dy * 4); ctx.lineTo(x, y + dy * 14); ctx.moveTo(x + dx * 4, y); ctx.lineTo(x + dx * 14, y); ctx.stroke(); });
      ctx.fillStyle = 'rgba(43,42,40,.62)'; ctx.font = '500 9px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const NUM = [['01', 40, 40], ['02', 330, 192], ['03', 272, 322], ['04', 142, 488], ['05', 100, 386]]; if (law === 'magnet') NUM.push(['06', 330, 322]);
      NUM.forEach(([n, x, y]) => { ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x - 2, y); ctx.stroke(); ctx.fillText(n, x, y); });
      ctx.restore();
    }

    // 基準世界のゴースト（Codex §D: 鈍い青、塗り.08、破線輪郭.38、差が8px超の物体だけ t-6/t-12 の残像）
    if (ghostOn && law !== 'normal' && !tween) drawGhost();

    // 静的部品: 滑り台（一枚物があれば板3枚の代わりに描く）、棚、導き板、台、止め、受け皿、鐘、磁石
    const statics = L.statics;
    const hasSlide = !!IMG['slide'];
    for (const b of statics) {
      if (/^slope/.test(b.label)) { if (!hasSlide) paper('slope', b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed', COL.red); continue; }
      if (/^chute/.test(b.label)) { const n = 'chute-0' + (parseInt(b.label.slice(5), 10) + 1); paper(IMG[n] ? n : 'slope', b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed', COL.mustard); continue; }
      if (b.label === 'cLedge') { paper(IMG['c-ledge'] ? 'c-ledge' : 'post', b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed'); continue; }
      if (b.label === 'stopUnder') { paper(IMG['stop-under'] ? 'stop-under' : 'post', b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed'); continue; }
      if (b.label === 'armStop') { paper(IMG['arm-stop'] ? 'arm-stop' : 'post', b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed'); continue; }
      if (b.label === 'floorStop') { paper(IMG['floor-stop'] ? 'floor-stop' : 'post', b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed'); continue; }
      paper(b.sprite.img, b.x, b.y, b.sprite.w, b.sprite.h, b.a, 'fixed', colorOf(b.sprite.img));
    }
    if (hasSlide) paper('slide', 14 + 56, 46 + 60, 112, 120, 0, 'fixed', COL.red);
    const c = G.catcher;
    paper('catcher', c.x, c.wallY, c.w + 2 * c.wallW, c.wallH, 0, 'fixed', COL.blue);
    // 鐘（ひもと腕木はコード描画）
    const sw = (f0) => f0 >= 0 && t >= f0 ? Math.sin((t - f0) * 0.45) * 0.35 * Math.exp(-(t - f0) / 40) : 0;
    ctx.save(); ctx.strokeStyle = COL.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, G.bellBottom.y - 38); ctx.lineTo(G.bellBottom.x + 6, G.bellBottom.y - 38); ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(43,42,40,.7)'; ctx.beginPath(); ctx.moveTo(G.bellBottom.x, G.bellBottom.y - 38); ctx.lineTo(G.bellBottom.x, G.bellBottom.y - 22); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(G.bellBottom.x, G.bellBottom.y - 22); ctx.rotate(sw(bellRang.bottom)); paper('bell-bottom', 0, 22, 40, 44, 0, 'fixed', COL.mustard); ctx.restore();
    ctx.save(); ctx.translate(G.bellTop.x, G.bellTop.y + 22); ctx.rotate(sw(bellRang.top)); paper('bell-top', 0, -22, G.bellTop.w, G.bellTop.h, 0, 'fixed', COL.mustard); ctx.restore();
    function rang(x, y) { ctx.save(); ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.2; [-1, 1].forEach(sg => { [0, 6].forEach(o => { ctx.beginPath(); ctx.arc(x + sg * (30 + o), y, 7 + o, sg > 0 ? -0.6 : Math.PI - 0.6, sg > 0 ? 0.6 : Math.PI + 0.6); ctx.stroke(); }); }); ctx.restore(); }
    if (bellRang.bottom >= 0 && t >= bellRang.bottom) rang(G.bellBottom.x, G.bellBottom.y);
    if (bellRang.top >= 0 && t >= bellRang.top) rang(G.bellTop.x, G.bellTop.y);
    if (law === 'magnet') {
      magnetAppear = Math.min(1, magnetAppear + 0.08); const m = G.magnetBody, slide = (1 - magnetAppear) * 24;
      ctx.save(); ctx.globalAlpha = magnetAppear;
      if (IMG['magnet-body']) paper('magnet-body', m.x + slide, m.y, m.w, m.h, 0, 'fixed', COL.ink); else { ctx.fillStyle = COL.ink; ctx.fillRect(m.x - m.w / 2 + slide, m.y - m.h / 2, m.w, m.h); }
      paper(IMG['magnet-emblem'] ? 'magnet-emblem' : 'magnet', 326 + slide, m.y, 44, 44, IMG['magnet-emblem'] ? 0 : -Math.PI / 2, 'flat', COL.red);
      ctx.restore();
    }

    // 可動体（影付き）。支点はシーソーの前
    L.bodies.forEach((b, i) => {
      const p = bodyPose(i); let sx = 1, sy = 1;
      const q = squash[b.label]; if (q) { const k = q.k * (1 - q.t / q.total) * Math.sin(q.t / q.total * Math.PI * 2); sx = 1 + k; sy = 1 - k; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sx, sy); ctx.translate(-p.x, -p.y);
      paper(b.sprite.img, p.x, p.y, b.w, b.h, p.a, b.r ? 'circle-moving' : 'moving', colorOf(b.sprite.img));
      ctx.restore();
    });
    paper('fulcrum', G.seesaw.x, G.seesaw.y + 5 + 12, 24, 24, 0, 'fixed', COL.red);
    for (const e of effects) { const k = e.t / e.total; ctx.save(); ctx.globalAlpha = (1 - k) * 0.9; const r = 18 + k * 14; paper('jelly-overlay', e.x, e.y, r * 2, r * 2, 0, 'flat', 'rgba(47,111,116,.3)'); ctx.restore(); }

    drawDivergence();

    // HUD（画面座標）
    screenTransform();
    const m = META[law], qt = quantityText(law);
    const w1 = label(m.label, 8, 16, { size: 12 }).w;
    label(qt.main, 8 + w1 + 4, 16, { size: 11, weight: 500 });
    if (qt.aid) label(qt.aid, 8, 36, { size: 10, weight: 500, color: 'rgba(43,42,40,.75)' });
    const sp = speedAt(t);
    label((t / FPS).toFixed(1) + '秒' + (sp !== 1 ? '　×' + sp.toFixed(2).replace(/0$/, '') : ''), W - 8, 16, { size: 12, align: 'right', weight: 500 });
    if (t >= endFrame() - 0.5) drawEndingCard(m);
    if (flash) { const k = flash.t / flash.total; ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = flash.tint; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = Math.min(1, (1 - k) * 1.6); ctx.font = '700 30px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = COL.ink; ctx.fillText(flash.text, W / 2, H / 2 - 20); ctx.restore(); }
    updateKnob();
  }

  // 結末カード（Codex の切り紙枠 328×72 を下端 HUD 領域に）: 結末の一文＋三行解説（変わった力／分岐点／結果）
  // 三行解説（Codex 最終文言 review3-codex.md §C1）
  const EXPLAIN = {
    normal:   { force: 'なし。これが比較の基準', fork: '最初の衝突から基準になる', result: '小さな玉が受け皿で鐘を鳴らす' },
    jelly:    { force: '反発が0.05から0.92へ', fork: '玉Aが最初のドミノに触れた時', result: '跳ね返り、小さな玉は飛ばない' },
    inverted: { force: '重力の向きが下から上へ', fork: '動き出した瞬間、全体が上へ', result: '重い玉が天井の鐘に届く' },
    magnet:   { force: '右向きの磁力を加えた', fork: '玉Aが滑り台で基準を離れる', result: 'すべてが右の磁石に集まる' },
  };
  const INVITE = '基準を重ねて、分かれた瞬間を見る', COMPLETE = '四つの法則を見届けました。基準から比べよう。';
  let seen = {}; try { seen = JSON.parse(localStorage.getItem('housoku.seen') || '{}'); } catch (e) { seen = {}; }
  function markSeen(l) { seen[l] = true; try { localStorage.setItem('housoku.seen', JSON.stringify(seen)); } catch (e) {} }
  // 9-slice で枠を描く（切り紙の四隅を伸ばさない）
  function nineSlice(im, x, y, w, h, s) {
    const iw = im.naturalWidth, ih = im.naturalHeight, S2 = s * 2, d = s;
    const cols = [[0, S2, x, d], [S2, iw - 2 * S2, x + d, w - 2 * d], [iw - S2, S2, x + w - d, d]];
    const rows = [[0, S2, y, d], [S2, ih - 2 * S2, y + d, h - 2 * d], [ih - S2, S2, y + h - d, d]];
    for (const r of rows) for (const c of cols) ctx.drawImage(im, c[0], r[0], c[1], r[1], c[2], r[2], c[3], r[3]);
  }
  // 結末カードは右下に置き、左下の受け皿と鐘（通常の決め絵）を隠さない
  function drawEndingCard(m) {
    const allSeen = Object.keys(TL.laws).every(l => seen[l]);
    const cw = 232, ch = 100, x = W - cw - 10, y = H - ch - 10;
    ctx.save();
    if (IMG['ending-card-frame']) nineSlice(IMG['ending-card-frame'], x, y, cw, ch, 12); else { ctx.fillStyle = 'rgba(247,239,220,.96)'; ctx.fillRect(x, y, cw, ch); ctx.strokeStyle = 'rgba(43,42,40,.35)'; ctx.strokeRect(x + .5, y + .5, cw - 1, ch - 1); }
    ctx.fillStyle = COL.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 12.5px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif'; ctx.fillText(m.end, x + cw / 2, y + 19);
    const ex = EXPLAIN[law];
    ctx.font = '500 9.5px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif'; ctx.textAlign = 'left';
    [['変わった力', ex.force], ['分岐点', ex.fork], ['結果', ex.result]].forEach((row, i) => { ctx.fillStyle = COL.red; ctx.fillText(row[0], x + 14, y + 38 + i * 13); ctx.fillStyle = 'rgba(43,42,40,.85)'; ctx.fillText(row[1], x + 66, y + 38 + i * 13); });
    ctx.textAlign = 'center'; ctx.fillStyle = allSeen ? COL.blue : 'rgba(43,42,40,.62)'; ctx.font = '600 9px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif';
    ctx.fillText(allSeen ? COMPLETE : INVITE, x + cw / 2, y + ch - 11);
    ctx.restore();
  }

  function drawGhost() {
    const tb = Math.min(t, BASE.frames.length - 1);
    const gp = poseAt(BASE, tb), g6 = poseAt(BASE, Math.max(0, tb - 6)), g12 = poseAt(BASE, Math.max(0, tb - 12));
    ctx.save(); ctx.lineWidth = 1 / cam.z; ctx.setLineDash([4 / cam.z, 3 / cam.z]);
    const outline = (b, p, fillA, strokeA) => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.beginPath(); if (b.r) ctx.arc(0, 0, b.r, 0, Math.PI * 2); else ctx.rect(-b.w / 2, -b.h / 2, b.w, b.h);
      if (fillA) { ctx.globalAlpha = fillA; ctx.fillStyle = COL.blue; ctx.fill(); }
      ctx.globalAlpha = strokeA; ctx.strokeStyle = COL.blue; ctx.stroke(); ctx.restore();
    };
    BASE.bodies.forEach((b, i) => {
      const j = L.bodies.findIndex(x => x.label === b.label);
      const cur = j >= 0 ? curPose[j] : null;
      const far = cur ? Math.hypot(cur.x - gp[i].x, cur.y - gp[i].y) > 8 : true;
      if (far) { outline(b, g12[i], 0, 0.07); outline(b, g6[i], 0, 0.14); }
      outline(b, gp[i], 0.08, 0.38);
    });
    ctx.restore();
  }

  // 分岐点（Codex §D）: 実位置＝朱の二重円Ø8、基準位置＝鈍い青の破線円Ø6、朱→青の点線。出現時0.35秒だけ脈動。札は1.2秒。
  function drawDivergence() {
    const dv = L.divergence; if (!dv || law === 'normal' || t < dv.f || tween) return;
    const age = t - dv.f, pulse = age < 21 ? Math.sin(age / 21 * Math.PI) : 0, sc = 1 + pulse * 1.25;
    ctx.save();
    const grad = ctx.createLinearGradient(dv.x, dv.y, dv.bx, dv.by); grad.addColorStop(0, COL.red); grad.addColorStop(1, COL.blue);
    ctx.strokeStyle = grad; ctx.lineWidth = 1 / cam.z; ctx.setLineDash([2 / cam.z, 3 / cam.z]); ctx.beginPath(); ctx.moveTo(dv.x, dv.y); ctx.lineTo(dv.bx, dv.by); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = COL.red; ctx.lineWidth = 1.2 / cam.z;
    ctx.beginPath(); ctx.arc(dv.x, dv.y, 4 * sc / cam.z, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(dv.x, dv.y, 2 * sc / cam.z, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = COL.blue; ctx.setLineDash([2 / cam.z, 2 / cam.z]); ctx.beginPath(); ctx.arc(dv.bx, dv.by, 3 / cam.z, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (age < 72) {
      screenTransform();
      const p = project(dv.x, dv.y), text = 'ここで基準と分かれた';
      ctx.font = '600 11px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif';
      const tw = ctx.measureText(text).width + 14 + 8, th = 21;
      const forbidden = [[0, 0, 360, 48], [276, 0, 360, 36], [118, 450, 360, 560]];
      if (flash) forbidden.push([60, 200, 300, 360]);
      const cand = [[p.x + 14, p.y - 14 - th], [p.x - 14 - tw, p.y - 14 - th], [p.x + 14, p.y + 14], [p.x - 14 - tw, p.y + 14]];
      const bodyRects = curPose.map((q, i) => { const b = L.bodies[i], s = project(q.x, q.y), r = (b.r || Math.max(b.w, b.h) / 2) * cam.z + 12; return [s.x - r, s.y - r, s.x + r, s.y + r]; });
      const hit = (r, q) => !(r[2] < q[0] || r[0] > q[2] || r[3] < q[1] || r[1] > q[3]);
      for (const [x, y] of cand) {
        const r = [x, y, x + tw, y + th];
        if (x < 4 || y < 4 || x + tw > W - 4 || y + th > H - 4) continue;
        if (forbidden.some(f => hit(r, f)) || bodyRects.some(b => hit(r, b))) continue;
        label(text, x + 7, y + th / 2, { size: 11, color: COL.ink, tick: true }); break;
      }
    }
  }

  // ---- ループ ----
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts; let dt = ts - lastTs; lastTs = ts; if (dt > 100) dt = 100;
    acc += dt; let steps = 0;
    while (acc >= 1000 / FPS && steps < 4) {
      acc -= 1000 / FPS; steps++;
      if (flash) { flash.t++; if (flash.t >= flash.total) flash = null; }
      for (const k in squash) { squash[k].t++; if (squash[k].t >= squash[k].total) delete squash[k]; }
      effects = effects.filter(e => ++e.t < e.total);
      if (tween) { tween.n++; if (tween.n >= tween.total) tween = null; continue; }
      if (idleLeft > 0) { idleLeft--; continue; }
      if (playing && !scrubbing) {
        const before = t; t = Math.min(endFrame(), t + speedAt(t));
        fireEventsUpTo(Math.floor(t));
        if (t >= endFrame() && before < endFrame()) onEnded();
      }
    }
    // 静止中（再生も演出も無い）は画像の読み込み完了だけ拾って描き直す
    const active = playing || tween || flash || idleLeft > 0 || effects.length || Object.keys(squash).length;
    if (steps && (active || imgTick !== lastImgTick)) { lastImgTick = imgTick; draw(); }
  }

  const initLaw = TL.laws[params.get('law')] ? params.get('law') : 'normal';
  ghostBtn.setAttribute('aria-pressed', String(ghostOn));
  setLaw(initLaw, { initial: true });
  fit();
  requestAnimationFrame(frame);
})();

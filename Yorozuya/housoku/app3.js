/* app3.js — 第三期「法則を旅する装置」の上演側（グレーボックス）
   事前計算した timeline3.js を再生。縦長世界をカメラが主役を追って進む。エリアの紙色・看板・境界線、スクラブ、音。 */
(function () {
  'use strict';
  const TL = window.TIMELINE3;
  const W = TL.W, H = TL.H, FPS = TL.fps, Q = 10, QA = 1000;
  const VW = 360, VH = 560;                         // 画面（論理）
  const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  const track = document.getElementById('track'), knob = document.getElementById('knob'), marks = document.getElementById('marks');
  const playBtn = document.getElementById('play'), slowBtn = document.getElementById('slow'), againBtn = document.getElementById('again'), sndBtn = document.getElementById('snd');
  const zonesEl = document.getElementById('zones');
  const params = new URLSearchParams(location.search);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COL = { paper: '#efe3c8', paper2: '#f7efdc', ink: '#2b2a28', red: '#c8442c', blue: '#2f6f74', mustard: '#d9a12b' };

  // ---- 画像 ----
  const NAMES = ['paper-background-v3', 'ball-a', 'ball-b', 'ball-c', 'domino', 'slope', 'shelf', 'seesaw', 'fulcrum', 'catcher', 'bell-bottom', 'bell-top', 'magnet-emblem', 'post', 'jelly-overlay',
    // 第三期の新素材（Codex, beats-codex.md §C）。無い間は仮図形
    'sign-blank', 'boundary-dash', 'boundary-water', 'hero-scar', 'portal-envelope', 'magnet-moon', 'magnet-ring-on', 'flap-oneway', 'paper-fish', 'ring-big', 'ring-small', 'ring-restore', 'keyhole-wall', 'bubble', 'spring-pad', 'goal-cup', 'goal-lamp-off', 'goal-lamp-on', 'goal-dekita', 'confetti-sheet'];
  const IMG = {}; let imgTick = 0, lastImgTick = -1;
  NAMES.forEach(n => { const im = new Image(); im.src = 'assets/' + n + '.webp'; im.onload = () => { IMG[n] = im; imgTick++; }; });

  // ---- 音（前作のフォーリーを流用） ----
  let AC = null, soundOn = false, unlocked = false, lastClick = 0, noiseBuf = null;
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } } return AC; }
  function env(node, t0, a, d, peak) { const g = ac().createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); node.connect(g); g.connect(ac().destination); return g; }
  function noise() { if (noiseBuf) return noiseBuf; const n = ac().sampleRate * 0.25, b = ac().createBuffer(1, n, ac().sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return (noiseBuf = b); }
  function burst(now, freq, q, dur, peak) { const s = ac().createBufferSource(); s.buffer = noise(); const f = ac().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; s.connect(f); env(f, now, 0.002, dur, peak); s.start(now); s.stop(now + dur + 0.05); }
  function tone(now, type, f0, f1, dur, peak, a) { const o = ac().createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, now); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, now + dur * 0.8); env(o, now, a || 0.004, dur, peak); o.start(now); o.stop(now + dur + 0.05); return o; }
  const sfx = {
    click(v) { if (!soundOn || !ac()) return; const now = ac().currentTime; if (now - lastClick < 0.04) return; lastClick = now; const k = Math.min(1, (v || 1) / 4); burst(now, 2600 + 900 * k, 1.8, 0.05, 0.22 + 0.25 * k); tone(now, 'triangle', 520 + 120 * k, 420, 0.07, 0.10 + 0.10 * k); },
    paper(v) { if (!soundOn || !ac()) return; const now = ac().currentTime; const k = Math.min(1, (v || 1) / 5); tone(now, 'sine', 240 + 80 * k, 120, 0.12, 0.18 + 0.2 * k); burst(now, 1200, 0.8, 0.04, 0.08); },
    thud() { if (!soundOn || !ac()) return; const now = ac().currentTime; tone(now, 'sine', 110, 42, 0.28, 0.7); burst(now, 700, 0.9, 0.09, 0.35); },
    boing() { if (!soundOn || !ac()) return; const now = ac().currentTime; const o = tone(now, 'sine', 560, 170, 0.42, 0.4, 0.01); const lfo = ac().createOscillator(); lfo.frequency.value = 11; const g = ac().createGain(); g.gain.value = 22; lfo.connect(g); g.connect(o.frequency); lfo.start(now); lfo.stop(now + 0.5); },
    bell() { if (!soundOn || !ac()) return; const now = ac().currentTime; [[1, 1.0, 1.9], [2.0, 0.45, 1.3], [2.76, 0.35, 1.0], [5.4, 0.12, 0.6]].forEach(([r, a, d]) => { const o = ac().createOscillator(); o.type = 'sine'; o.frequency.value = 880 * r; env(o, now, 0.003, d, 0.32 * a); o.start(now); o.stop(now + d + 0.05); }); },
    chime(n) { if (!soundOn || !ac()) return; const now = ac().currentTime; tone(now, 'triangle', 660 * Math.pow(1.06, n || 0), 640, 0.25, 0.14); },
    whoosh() { if (!soundOn || !ac()) return; const now = ac().currentTime; const s = ac().createBufferSource(); s.buffer = noise(); const f = ac().createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, now); f.frequency.exponentialRampToValueAtTime(2400, now + 0.35); s.connect(f); env(f, now, 0.02, 0.4, 0.2); s.start(now); s.stop(now + 0.5); },
  };
  function unlockAudio() { if (unlocked) return; unlocked = true; const a = ac(); if (a && a.state === 'suspended') a.resume(); }

  // ---- 再生状態 ----
  let t = 0, playing = true, userSlow = false, scrubbing = false, evIndex = 0, idleLeft = reduced ? 1 : 30, lastTs = 0, acc = 0;
  let effects = [], zoneFlash = null, camPrev = null, ringPulse = null, goalT = -1, confetti = [], bubbles = [];
  const ZONE_COLORS = ['#efe3c8', '#f1d9d2', '#d9e6ec', '#e3d9ea', '#dfe9d6', '#ecece6', '#cfdbe8', '#d9a12b'];
  function spawnConfetti() { confetti = []; const g = goalPos(); for (let i = 0; i < 28; i++) { const a = -Math.PI / 2 + (i / 28 - 0.5) * 1.6; const sp = 3 + (i % 5) * 0.7; confetti.push({ x: g.x, y: g.y - 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: (i * 37) % 360, c: ZONE_COLORS[i % 8], t: 0 }); } }
  function goalPos() { const s = TL.statics.find(b => b.label === 'goalBase'); return s ? { x: s.x, y: s.y } : { x: 80, y: 3180 }; }
  const endFrame = () => TL.frames.length - 1;
  const NB = TL.bodies.length;
  function poseAt(f) {
    const fr = TL.frames, n = fr.length, i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1), k = Math.min(1, Math.max(0, f - i0));
    const A = fr[i0], B = fr[i1], out = [];
    for (let i = 0; i < NB; i++) { const j = i * 4; out.push({ x: (A[j] + (B[j] - A[j]) * k) / Q, y: (A[j + 1] + (B[j + 1] - A[j + 1]) * k) / Q, a: (A[j + 2] + (B[j + 2] - A[j + 2]) * k) / QA, r: (A[j + 3] + (B[j + 3] - A[j + 3]) * k) / Q }); }
    return out;
  }
  const mainIndex = (f) => TL.mainTrack[Math.max(0, Math.min(TL.mainTrack.length - 1, Math.round(f)))];
  const zoneAt = (y) => TL.zones.find(z => y >= z.y0 && y < z.y1) || TL.zones[TL.zones.length - 1];

  // ---- カメラ: 主役を追う（少し先読み）。ズームはエリアごとに一定。境界付近で少し引く ----
  const ZOOM = { desk: 1.35, roof: 1.35, town: 1.25, zero: 1.15, jelly: 1.3, size: 1.25, water: 1.3, goal: 1.3 };
  function camTarget(f) {
    const p = poseAt(f), i = mainIndex(f), q = poseAt(Math.min(endFrame(), f + 10))[i];
    const z = zoneAt(p[i].y);
    let zoom = ZOOM[z.id] || 1.25;
    const nearEdge = Math.min(Math.abs(p[i].y - z.y0), Math.abs(p[i].y - z.y1)) < 70;
    if (nearEdge) zoom *= 0.92;
    return { cx: (p[i].x + q.x) / 2, cy: (p[i].y + q.y) / 2, z: zoom };
  }
  function clampCam(c) { const hw = VW / (2 * c.z), hh = VH / (2 * c.z); return { cx: Math.min(W - hw, Math.max(hw, c.cx)), cy: Math.min(H - hh, Math.max(hh, c.cy)), z: c.z }; }
  function camAt(f) { const tgt = camTarget(f); if (!camPrev || scrubbing) { camPrev = clampCam(tgt); return camPrev; } const k = 0.08; camPrev = clampCam({ cx: camPrev.cx + (tgt.cx - camPrev.cx) * k, cy: camPrev.cy + (tgt.cy - camPrev.cy) * k, z: camPrev.z + (tgt.z - camPrev.z) * 0.05 }); return camPrev; }
  // スロー（Codex §A/§B）: 境界の通過・輪・封筒・橋の破断・磁力解除・到着。同種の連続は最初だけ
  const SLOW = []; let lastBreak = -999, lastZone = -999;
  for (const e of TL.events) {
    if (e.t === 'zone') { if (e.f - lastZone > 90) SLOW.push({ from: e.f - 12, to: e.f + 16, sp: 0.45 }); lastZone = e.f; }
    else if (e.t === 'ring') SLOW.push({ from: e.f - 4, to: e.f + (e.k > 1 ? 40 : 26), sp: 0.45 });
    else if (e.t === 'portal') SLOW.push({ from: e.f - 8, to: e.f + 20, sp: 0.5 });
    else if (e.t === 'break') { if (e.f - lastBreak > 30) SLOW.push({ from: e.f - 3, to: e.f + 6, sp: 0.45 }); lastBreak = e.f; }
    else if (e.t === 'release-orbit') SLOW.push({ from: e.f - 30, to: e.f + 10, sp: 0.45 });
    else if (e.t === 'release') SLOW.push({ from: e.f + 20, to: e.f + 40, sp: 0.65 });
    else if (e.t === 'arrive') SLOW.push({ from: e.f - 12, to: e.f + 2, sp: 0.5 });
  }
  // 拍のイベント（花火・ゼリーの跳ね・ばね）の一瞬のスロー
  let jellyHits = 0;
  for (const e of TL.events) if (e.t === 'impact' && /hero/.test(e.a + e.b) && /^st\d/.test(e.a + e.b)) { jellyHits++; if (jellyHits === 2) SLOW.push({ from: e.f - 3, to: e.f + 10, sp: 0.65 }); }
  for (const e of TL.events) if (e.t === 'impact' && /hero/.test(e.a + e.b) && /spring3/.test(e.a + e.b)) { SLOW.push({ from: e.f - 3, to: e.f + 8, sp: 0.65 }); break; }
  function speedAt(f) { if (userSlow) return 0.25; let sp = 1; for (const s of SLOW) if (f >= s.from && f < s.to) sp = Math.min(sp, s.sp); return sp; }

  // ---- イベント発火（音・演出） ----
  function fireEventsUpTo(f) {
    while (evIndex < TL.events.length && TL.events[evIndex].f <= f) {
      const e = TL.events[evIndex++];
      if (e.t === 'impact') { const pair = e.a + '|' + e.b; if (/domino/.test(pair) && e.v > 0.9) sfx.click(e.v); else if (/hero|trigger|fish/.test(pair) && e.v > 1.5) { if (zoneAt(e.y).id === 'jelly') { sfx.boing(); effects.push({ x: e.x, y: e.y, t: 0, total: 24 }); } else sfx.paper(e.v); } continue; }
      if (e.t === 'zone') { const z = TL.zones.find(z => z.id === e.what); zoneFlash = { t: 0, total: 48, name: e.name, word: z && z.sfx, id: e.what }; sfx.chime(TL.zones.findIndex(z => z.id === e.what)); }
      else if (e.t === 'portal') sfx.whoosh();
      else if (e.t === 'ring') { sfx.chime(e.k > 1 ? -4 : (e.k < 0.5 ? 8 : 2)); ringPulse = { x: e.x, y: e.y, t: 0, total: 30, k: e.k }; }
      else if (e.t === 'break') sfx.thud();
      else if (e.t === 'release-orbit') sfx.whoosh();
      else if (e.t === 'arrive') { sfx.bell(); goalT = 0; spawnConfetti(); }
    }
  }

  // ---- UI ----
  TL.zones.forEach(z => { const s = document.createElement('span'); s.textContent = z.name; s.dataset.id = z.id; zonesEl.appendChild(s); });
  function buildMarks() { marks.innerHTML = ''; const n = endFrame(); const add = (f, cls) => { const s = document.createElement('span'); s.className = 'mk ' + cls; s.style.left = (f / n * 100) + '%'; marks.appendChild(s); }; TL.events.forEach(e => { if (e.t === 'zone') add(e.f, 'zone'); else if (e.t === 'arrive') add(e.f, 'arr'); else if (/ring|portal|break|release-orbit/.test(e.t)) add(e.f, ''); }); }
  buildMarks();
  function updateKnob() { knob.style.setProperty('--k', String(t / endFrame())); track.setAttribute('aria-valuenow', String(Math.round(t / FPS))); track.setAttribute('aria-valuemax', String(Math.round(endFrame() / FPS))); }
  function syncToTime() { evIndex = 0; while (evIndex < TL.events.length && TL.events[evIndex].f <= t) evIndex++; effects = []; zoneFlash = null; camPrev = null; ringPulse = null; confetti = []; bubbles = []; goalT = (TL.arrived && t >= TL.arrivedFrame) ? 60 : -1; }
  function scrubTo(clientX) { const r = track.getBoundingClientRect(); const k = Math.min(1, Math.max(0, (clientX - r.left - 10) / (r.width - 20))); t = k * endFrame(); idleLeft = 0; syncToTime(); draw(); }
  track.addEventListener('pointerdown', e => { unlockAudio(); scrubbing = true; playing = false; updatePlayBtn(); track.setPointerCapture(e.pointerId); scrubTo(e.clientX); });
  track.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e.clientX); });
  track.addEventListener('pointerup', () => { scrubbing = false; });
  track.addEventListener('pointercancel', () => { scrubbing = false; });
  function updatePlayBtn() { playBtn.querySelector('span').textContent = playing ? '一時停止' : (t >= endFrame() ? 'はじめから' : '再生'); playBtn.setAttribute('aria-pressed', String(playing)); }
  function togglePlay() { unlockAudio(); if (playing) playing = false; else { if (t >= endFrame()) { t = 0; syncToTime(); } playing = true; idleLeft = 0; } updatePlayBtn(); }
  playBtn.addEventListener('click', togglePlay);
  slowBtn.addEventListener('click', () => { unlockAudio(); userSlow = !userSlow; slowBtn.setAttribute('aria-pressed', String(userSlow)); slowBtn.querySelector('span').textContent = userSlow ? 'スロー ×0.25' : 'スロー'; });
  againBtn.addEventListener('click', () => { unlockAudio(); t = 0; syncToTime(); playing = true; idleLeft = 0; updatePlayBtn(); });
  sndBtn.addEventListener('click', () => { unlockAudio(); soundOn = !soundOn; sndBtn.setAttribute('aria-pressed', String(soundOn)); sndBtn.querySelector('span').textContent = soundOn ? '音あり' : '音なし'; if (soundOn) sfx.click(1); });
  window.addEventListener('resize', fit);

  // ---- 描画 ----
  let S = 1, cam = { cx: VW / 2, cy: VH / 2, z: 1 };
  function fit() {
    const stage = canvas.parentElement, side = document.querySelector('.side'), header = document.querySelector('header');
    let availH = Math.max(320, window.innerHeight - header.offsetHeight - side.offsetHeight - 40);
    const w = Math.max(240, Math.min(stage.clientWidth, availH * VW / VH, 420));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = w + 'px'; canvas.style.height = (w * VH / VW) + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * VH / VW * dpr);
    draw();
  }
  const worldTransform = () => { ctx.setTransform(S, 0, 0, S, 0, 0); ctx.translate(VW / 2, VH / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.cx, -cam.cy); };
  const screenTransform = () => ctx.setTransform(S, 0, 0, S, 0, 0);
  function sprite(name, x, y, w, h, angle, fallback, circle) {
    const im = IMG[name]; ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle);
    if (im) ctx.drawImage(im, -w / 2, -h / 2, w, h); else { ctx.fillStyle = fallback || COL.ink; if (circle) { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-w / 2, -h / 2, w, h); }
    ctx.restore();
  }
  function label(text, x, y, o) {
    o = o || {}; ctx.save(); ctx.font = (o.weight || 600) + ' ' + (o.size || 12) + 'px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = o.align || 'left';
    const m = ctx.measureText(text).width, pad = 7, h = (o.size || 12) + 10, bx = x - (o.align === 'center' ? m / 2 + pad : (o.align === 'right' ? m + pad : pad));
    ctx.fillStyle = o.bg || 'rgba(247,239,220,.94)'; ctx.fillRect(bx, y - h / 2, m + pad * 2, h); ctx.strokeStyle = 'rgba(43,42,40,.35)'; ctx.lineWidth = 1; ctx.strokeRect(bx + .5, y - h / 2 + .5, m + pad * 2 - 1, h - 1);
    ctx.fillStyle = o.color || COL.ink; ctx.fillText(text, x, y + 1); ctx.restore(); return m + pad * 2;
  }
  const colorOf = (img) => /ball-a/.test(img) ? COL.red : /ball-b/.test(img) ? COL.blue : /ball-c/.test(img) ? COL.mustard : /shelf|seesaw/.test(img) ? COL.mustard : /slope/.test(img) ? COL.red : /portal|ring/.test(img) ? COL.blue : /fish/.test(img) ? COL.mustard : COL.ink;

  function draw() {
    S = canvas.width / VW;
    cam = idleLeft > 0 ? clampCam({ cx: 180, cy: 200, z: 1.2 }) : camAt(t);
    const pose = poseAt(t), mi = mainIndex(t);
    screenTransform(); ctx.clearRect(0, 0, VW, VH);
    worldTransform();
    // エリアの紙（色）と境界線・看板
    for (const z of TL.zones) { ctx.fillStyle = z.paper || COL.paper; ctx.fillRect(0, z.y0, W, z.y1 - z.y0); }
    if (IMG['paper-background-v3']) { ctx.save(); ctx.globalAlpha = 0.55; for (let y = 0; y < H; y += VH) ctx.drawImage(IMG['paper-background-v3'], 0, y, W, VH); ctx.restore(); }
    ctx.save(); ctx.strokeStyle = 'rgba(200,68,44,.7)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
    for (const z of TL.zones) if (z.y0 > 0) { ctx.beginPath(); ctx.moveTo(0, z.y0); ctx.lineTo(W, z.y0); ctx.stroke(); }
    ctx.restore();
    for (const z of TL.zones) { // 看板（ちぎり紙＋画鋲。素材があれば使う）
      ctx.save(); ctx.translate(W - 14, z.y0 + 26); ctx.rotate(-0.04);
      ctx.font = '700 13px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'; const tw = Math.max(64, ctx.measureText(z.sign).width + 22);
      if (IMG['sign-blank']) ctx.drawImage(IMG['sign-blank'], -tw, -14, tw, 28); else { ctx.fillStyle = 'rgba(247,239,220,.95)'; ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.2; ctx.fillRect(-tw, -12, tw, 24); ctx.strokeRect(-tw + .5, -11.5, tw - 1, 23); ctx.fillStyle = COL.red; ctx.beginPath(); ctx.arc(-tw + 8, -6, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = COL.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(z.sign, -10, 1); ctx.restore();
    }
    // 水面（二重波線）と泡
    { const wz = TL.zones.find(z => z.id === 'water'); if (wz) { ctx.save(); ctx.strokeStyle = 'rgba(47,111,116,.7)'; ctx.lineWidth = 1.5; [0, 5].forEach(o => { ctx.beginPath(); for (let x = 0; x <= W; x += 6) { const y = wz.y0 + o + Math.sin(x / 9 + t / 8) * 2; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }); ctx.restore();
      for (const b of bubbles) { ctx.save(); ctx.globalAlpha = 0.55 * (1 - b.t / b.total); ctx.strokeStyle = 'rgba(247,239,220,.9)'; ctx.fillStyle = 'rgba(207,219,232,.5)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); } } }
    // 磁石（点灯中は同心円）
    for (const m of TL.magnets) { const on = t >= m.on && (m.off == null || t < m.off); ctx.save(); ctx.strokeStyle = on ? COL.red : 'rgba(43,42,40,.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); [24, 48, 72].forEach(r => { ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke(); }); ctx.restore(); sprite('magnet-emblem', m.x, m.y, 30, 30, 0, COL.red); }
    // 静的部品
    for (const b of TL.statics) {
      if (b.sensor) { // 輪・扉・センサーは輪郭だけ
        if (/ring/.test(b.sprite.img)) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.strokeStyle = COL.blue; ctx.lineWidth = 3; ctx.strokeRect(-b.sprite.w / 2 - 2, -b.sprite.h / 2 - 2, b.sprite.w + 4, b.sprite.h + 4); ctx.restore(); }
        else if (/portal/.test(b.sprite.img)) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = 'rgba(47,111,116,.9)'; ctx.fillRect(-b.sprite.w / 2 - 3, -b.sprite.h / 2, b.sprite.w + 6, b.sprite.h); ctx.fillStyle = COL.paper2; ctx.fillRect(-b.sprite.w / 2 + 1, -b.sprite.h / 2 + 4, b.sprite.w - 2, b.sprite.h - 8); ctx.restore(); }
        continue;
      }
      sprite(b.sprite.img, b.x, b.y, b.sprite.w, b.sprite.h, b.a, colorOf(b.sprite.img));
    }
    // ゴール（杯・ランプ・札）
    { const g = goalPos(); if (IMG['goal-cup']) ctx.drawImage(IMG['goal-cup'], g.x - 50, g.y - 46, 100, 56); const lit = goalT >= 0; sprite(lit ? 'goal-lamp-on' : 'goal-lamp-off', g.x + 80, g.y - 50, 48, 60, 0, lit ? COL.mustard : 'rgba(43,42,40,.35)'); if (lit) { const k = Math.min(1, Math.max(0, (goalT - 10) / 20)); ctx.save(); ctx.globalAlpha = k; sprite('goal-dekita', g.x + 80, g.y - 110 + k * 24, 96, 36, -0.05, COL.paper2); if (!IMG['goal-dekita']) { ctx.fillStyle = COL.ink; ctx.font = '700 16px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('できた！', g.x + 80, g.y - 110 + k * 24); } ctx.restore(); } }
    // 可動体（主役には回転が読める丸傷）
    TL.bodies.forEach((b, i) => { const p = pose[i]; const w = b.r ? p.r * 2 : b.w, h = b.r ? p.r * 2 : b.h; const img = b.sprite ? b.sprite.img : 'post'; sprite(img === 'fish' ? 'paper-fish' : img, p.x, p.y, w, h, p.a, colorOf(img), !!b.r); if (i === mi && b.r) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); const sr = Math.max(1.2, p.r * 0.22); if (IMG['hero-scar']) ctx.drawImage(IMG['hero-scar'], p.r * 0.45 - sr, -p.r * 0.35 - sr, sr * 2, sr * 2); else { ctx.fillStyle = 'rgba(247,239,220,.9)'; ctx.beginPath(); ctx.arc(p.r * 0.45, -p.r * 0.35, sr, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); } });
    for (const e of effects) { const k = e.t / e.total; ctx.save(); ctx.globalAlpha = (1 - k) * 0.9; sprite('jelly-overlay', e.x, e.y, 30 + k * 30, 30 + k * 30, 0, 'rgba(47,111,116,.3)', true); ctx.restore(); }
    if (ringPulse) { const k = ringPulse.t / ringPulse.total; ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = COL.red; ctx.lineWidth = 2; [0, 8].forEach(o => { ctx.beginPath(); ctx.arc(ringPulse.x, ringPulse.y, 14 + o + k * (ringPulse.k > 1 ? 40 : 10), 0, Math.PI * 2); ctx.stroke(); }); ctx.restore(); }
    for (const c of confetti) { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r * Math.PI / 180); ctx.fillStyle = c.c; ctx.globalAlpha = Math.max(0, 1 - c.t / 150); ctx.fillRect(-3, -2, 6, 4); ctx.restore(); }

    // HUD
    screenTransform();
    const z = zoneAt(pose[mi].y);
    label(z.name + '　' + z.sign, 8, 16, { size: 12 });
    const sp = speedAt(t); label((t / FPS).toFixed(1) + '秒' + (sp !== 1 ? '　×' + sp.toFixed(2).replace(/0$/, '') : ''), VW - 8, 16, { size: 12, align: 'right', weight: 500 });
    if (zoneFlash) { const k = zoneFlash.t / zoneFlash.total; ctx.save(); ctx.globalAlpha = 1 - k; ctx.font = '700 26px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = COL.ink; ctx.fillText(zoneFlash.name, VW / 2, VH / 2 - 40 - k * 20); if (zoneFlash.word) { ctx.font = '600 15px "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif'; ctx.fillStyle = COL.red; ctx.fillText(zoneFlash.word, VW / 2, VH / 2 - 8 - k * 12); } ctx.restore(); }
    if (t >= endFrame() - 0.5) label(TL.arrived ? '八つの法則を旅して、ゴールに届いた。' : '（試作）まだゴールに届いていない', VW / 2, VH - 22, { size: 13, align: 'center', weight: 700 });
    Array.from(zonesEl.children).forEach(s => s.classList.toggle('on', s.dataset.id === z.id));
    updateKnob();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts; let dt = ts - lastTs; lastTs = ts; if (dt > 100) dt = 100;
    acc += dt; let steps = 0;
    while (acc >= 1000 / FPS && steps < 4) {
      acc -= 1000 / FPS; steps++;
      if (zoneFlash) { zoneFlash.t++; if (zoneFlash.t >= zoneFlash.total) zoneFlash = null; }
      effects = effects.filter(e => ++e.t < e.total);
      if (ringPulse && ++ringPulse.t >= ringPulse.total) ringPulse = null;
      if (goalT >= 0) goalT++;
      for (const c of confetti) { c.x += c.vx; c.y += c.vy; c.vy += 0.12; c.vx *= 0.985; c.r += 6; c.t++; } confetti = confetti.filter(c => c.t < 150);
      // 水中の主役から泡
      if (playing) { const p = poseAt(t), i = mainIndex(t), z = zoneAt(p[i].y); if (z.id === 'water' && (Math.floor(t) % 9 === 0)) bubbles.push({ x: p[i].x + ((t * 7) % 10) - 5, y: p[i].y - 8, r: 2 + (t % 3), t: 0, total: 70, vx: ((t * 13) % 7 - 3) * 0.05 }); }
      for (const b of bubbles) { b.y -= 0.9; b.x += b.vx; b.t++; } bubbles = bubbles.filter(b => b.t < b.total);
      if (idleLeft > 0) { idleLeft--; continue; }
      if (playing && !scrubbing) { const before = t; t = Math.min(endFrame(), t + speedAt(t)); fireEventsUpTo(Math.floor(t)); if (t >= endFrame() && before < endFrame()) { playing = false; updatePlayBtn(); } }
    }
    const active = playing || idleLeft > 0 || effects.length || zoneFlash || ringPulse || confetti.length || bubbles.length || (goalT >= 0 && goalT < 60);
    if (steps && (active || imgTick !== lastImgTick)) { lastImgTick = imgTick; draw(); }
  }
  if (params.get('t')) { t = params.get('t') === 'end' ? endFrame() : Math.min(endFrame(), +params.get('t')); playing = false; idleLeft = 0; syncToTime(); }
  updatePlayBtn(); fit(); requestAnimationFrame(frame);
})();

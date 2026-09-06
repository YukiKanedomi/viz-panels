/* app3.js — 第三期「法則を旅する装置」の上演側
   事前計算した timeline3.js を再生。縦長世界をカメラが主役を追って進む。
   本家ピタゴラ装置の原理（research-pitagora.md / beats2-codex.md）に従い、見えない検知や点灯・ワープは無し。
   魔法は一つ: 「紙の色が変わるところで、法則がひとつ変わる」。 */
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
  const COL = { paper: '#efe3c8', paper2: '#f7efdc', ink: '#2b2a28', red: '#c8442c', blue: '#2f6f74', mustard: '#d9a12b', pencil: 'rgba(43,42,40,.42)' };

  // ---- 画像（Codex 制作。無い間は仮図形） ----
  const NAMES = ['paper-background-v3', 'ball-a', 'ball-b', 'ball-c', 'domino', 'slope', 'shelf', 'seesaw', 'fulcrum', 'catcher', 'bell-bottom', 'bell-top', 'post', 'jelly-overlay',
    'sign-blank', 'boundary-dash', 'boundary-water', 'hero-scar', 'paper-fish', 'keyhole-wall', 'bubble', 'spring-pad', 'goal-cup', 'goal-dekita',
    'magnet-horseshoe', 'magnet-clip', 'flap-oneway-v2', 'flap-stopper', 'gate-big', 'gate-small', 'gate-restore', 'pulley', 'bell-tongue'];
  const IMG = {}; let imgTick = 0, lastImgTick = -1;
  NAMES.forEach(n => { const im = new Image(); im.src = 'assets/' + n + '.webp'; im.onload = () => { IMG[n] = im; imgTick++; }; });
  // 紙ゲートの「くぐる穴」の中心を画像のアルファから求める（穴を物理の輪にぴたりと合わせる）
  const APERTURE = {}, APERTURE_FALLBACK = { 'gate-big': { dx: 0, dy: -9 }, 'gate-small': { dx: 0, dy: -9 }, 'gate-restore': { dx: 0, dy: -6 } };   // file:// で画素が読めないときの実測値（PIL で計測）
  function aperture(name) {
    if (APERTURE[name]) return APERTURE[name]; const im = IMG[name]; if (!im) return { dx: 0, dy: 0 };
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { return (APERTURE[name] = APERTURE_FALLBACK[name] || { dx: 0, dy: 0 }); }
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < c.height; y++) {
      let first = -1, last = -1; for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 40) { if (first < 0) first = x; last = x; }
      if (first < 0) continue;
      for (let x = first; x <= last; x++) if (d[(y * c.width + x) * 4 + 3] <= 40) { sx += x; sy += y; n++; }
    }
    return (APERTURE[name] = n ? { dx: (c.width / 2 - sx / n) / 2, dy: (c.height / 2 - sy / n) / 2 } : { dx: 0, dy: 0 });   // 表示は 1/2 倍
  }

  // ---- 音（合成のみ） ----
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
    snap() { if (!soundOn || !ac()) return; const now = ac().currentTime; burst(now, 3200, 2.2, 0.04, 0.3); tone(now, 'square', 900, 300, 0.05, 0.08); },
    plop() { if (!soundOn || !ac()) return; const now = ac().currentTime; tone(now, 'sine', 300, 90, 0.16, 0.3); },
  };
  function unlockAudio() { if (unlocked) return; unlocked = true; const a = ac(); if (a && a.state === 'suspended') a.resume(); }

  // ---- 再生状態 ----
  let t = 0, playing = true, userSlow = false, scrubbing = false, evIndex = 0, idleLeft = reduced ? 1 : 30, lastTs = 0, acc = 0;
  let effects = [], zoneFlash = null, camPrev = null, goalT = -1, bubbles = [], clipT = -1;
  function goalPos() { const s = TL.statics.find(b => b.label === 'goalBase'); return s ? { x: s.x, y: s.y } : { x: 296, y: 3180 }; }
  const endFrame = () => TL.frames.length - 1;
  const NB = TL.bodies.length;
  const ease = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
  function poseAt(f) {
    const fr = TL.frames, n = fr.length, i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1), k = Math.min(1, Math.max(0, f - i0));
    const A = fr[i0], B = fr[i1], out = [];
    for (let i = 0; i < NB; i++) { const j = i * 4; out.push({ x: (A[j] + (B[j] - A[j]) * k) / Q, y: (A[j + 1] + (B[j + 1] - A[j + 1]) * k) / Q, a: (A[j + 2] + (B[j + 2] - A[j + 2]) * k) / QA, r: (A[j + 3] + (B[j + 3] - A[j + 3]) * k) / Q }); }
    return out;
  }
  const mainIndex = (f) => TL.mainTrack[Math.max(0, Math.min(TL.mainTrack.length - 1, Math.round(f)))];
  const zoneAt = (y) => TL.zones.find(z => y >= z.y0 && y < z.y1) || TL.zones[TL.zones.length - 1];
  // 磁石の離脱点（クリップ止めの位置）と、輪ごとの倍率（ゲートの札の予備表示に使う）
  const REL = TL.events.find(e => e.t === 'release-orbit') || null;
  const RINGK = {}; for (const e of TL.events) if (e.t === 'ring') { let best = null, bd = 1e9; for (const s of TL.statics) if (s.sensor && /ring/.test(s.sprite.img)) { const d = Math.hypot(s.x - e.x, s.y - e.y); if (d < bd) { bd = d; best = s; } } if (best) RINGK[best.label] = e.k; }
  const gateLabel = (k) => k == null ? '' : (k >= 1 ? '×' + (Math.round(k * 10) / 10) : '÷' + Math.round(1 / k));

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
  // スロー（Codex beats2 §1）: 編集効果は「際」だけ。橋の破断の直前、クリップ止めが外れる瞬間、巨大化、杯に収まる直前
  const SLOW = []; let firstBreak = true;
  for (const e of TL.events) {
    if (e.t === 'break' && firstBreak) { SLOW.push({ from: e.f - 6, to: e.f + 6, sp: 0.5 }); firstBreak = false; }
    else if (e.t === 'ring' && e.k > 1.9) SLOW.push({ from: e.f - 4, to: e.f + 28, sp: 0.5 });
    else if (e.t === 'release-orbit') SLOW.push({ from: e.f - 10, to: e.f + 10, sp: 0.5 });
    else if (e.t === 'arrive') SLOW.push({ from: e.f - 14, to: e.f + 2, sp: 0.5 });
  }
  function speedAt(f) { if (userSlow) return 0.25; let sp = 1; for (const s of SLOW) if (f >= s.from && f < s.to) sp = Math.min(sp, s.sp); return sp; }

  // ---- イベント発火（音・演出） ----
  function fireEventsUpTo(f) {
    while (evIndex < TL.events.length && TL.events[evIndex].f <= f) {
      const e = TL.events[evIndex++];
      if (e.t === 'impact') { const pair = e.a + '|' + e.b; if (/domino/.test(pair) && e.v > 0.9) sfx.click(e.v); else if (/hero|trigger|fish/.test(pair) && e.v > 1.5) { if (zoneAt(e.y).id === 'jelly') { sfx.boing(); effects.push({ x: e.x, y: e.y, t: 0, total: 24 }); } else if (/spring/.test(pair)) sfx.boing(); else if (zoneAt(e.y).id === 'water') sfx.plop(); else sfx.paper(e.v); } continue; }
      if (e.t === 'zone') { const z = TL.zones.find(z => z.id === e.what); zoneFlash = { t: 0, total: 40, name: e.name, word: z && z.sfx, id: e.what }; sfx.chime(TL.zones.findIndex(z => z.id === e.what)); }
      else if (e.t === 'ring') sfx.chime(e.k > 1 ? -4 : (e.k < 0.5 ? 8 : 2));
      else if (e.t === 'break') sfx.thud();
      else if (e.t === 'release-orbit') { sfx.snap(); clipT = 0; }
      else if (e.t === 'arrive') goalT = 0;
    }
  }

  // ---- UI ----
  TL.zones.forEach(z => { const s = document.createElement('span'); s.textContent = z.name; s.dataset.id = z.id; zonesEl.appendChild(s); });
  function buildMarks() { marks.innerHTML = ''; const n = endFrame(); const add = (f, cls) => { const s = document.createElement('span'); s.className = 'mk ' + cls; s.style.left = (f / n * 100) + '%'; marks.appendChild(s); }; TL.events.forEach(e => { if (e.t === 'zone') add(e.f, 'zone'); else if (e.t === 'arrive') add(e.f, 'arr'); else if (/ring|break|release-orbit/.test(e.t)) add(e.f, ''); }); }
  buildMarks();
  function updateKnob() { knob.style.setProperty('--k', String(t / endFrame())); track.setAttribute('aria-valuenow', String(Math.round(t / FPS))); track.setAttribute('aria-valuemax', String(Math.round(endFrame() / FPS))); }
  function syncToTime() { evIndex = 0; while (evIndex < TL.events.length && TL.events[evIndex].f <= t) evIndex++; effects = []; zoneFlash = null; camPrev = null; bubbles = []; goalT = (TL.arrived && t >= TL.arrivedFrame) ? 90 : -1; clipT = (REL && t >= REL.f) ? 60 : -1; }
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
  const colorOf = (img) => /ball-a/.test(img) ? COL.red : /ball-b/.test(img) ? COL.blue : /ball-c/.test(img) ? COL.mustard : /shelf|seesaw/.test(img) ? COL.mustard : /slope/.test(img) ? COL.red : /ring/.test(img) ? COL.blue : /fish/.test(img) ? COL.mustard : COL.ink;
  // 鉛筆の矢印（重力の向き）
  function pencilArrow(x, y, dx, dy, len) {
    const n = Math.hypot(dx, dy); if (n < 1e-6) return; dx /= n; dy /= n; const ex = x + dx * len, ey = y + dy * len;
    ctx.save(); ctx.strokeStyle = COL.pencil; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * 6 - dy * 4, ey - dy * 6 + dx * 4); ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * 6 + dy * 4, ey - dy * 6 - dx * 4); ctx.stroke(); ctx.restore();
  }
  function drawGate(b) {   // 紙ゲート: 穴を物理の輪に合わせる。札は Codex の絵の中（無い間は文字で）
    const name = /Big/.test(b.label) ? 'gate-big' : /Small/.test(b.label) ? 'gate-small' : 'gate-restore';
    const im = IMG[name], vertical = b.sprite.h > b.sprite.w;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
    if (im) { const w = im.width / 2, h = im.height / 2, ap = aperture(name); ctx.drawImage(im, -w / 2 + ap.dx, -h / 2 + ap.dy, w, h); }
    else {
      const ow = b.sprite.w + 4, oh = b.sprite.h + 4; ctx.fillStyle = COL.mustard; ctx.strokeStyle = COL.ink; ctx.lineWidth = 1;
      if (vertical) { ctx.fillRect(-ow / 2 - 8, -oh / 2 - 4, 8, oh + 4); ctx.fillRect(ow / 2, -oh / 2 - 4, 8, oh + 4); ctx.fillRect(-ow / 2 - 8, -oh / 2 - 12, ow + 16, 8); }
      else { ctx.fillRect(-ow / 2 - 4, -oh / 2 - 8, 8, oh + 8); ctx.fillRect(ow / 2 - 4, -oh / 2 - 8, 8, oh + 8); ctx.fillRect(-ow / 2 - 4, -oh / 2 - 8, ow + 8, 8); }
      ctx.fillStyle = COL.paper2; ctx.font = '700 9px "Hiragino Sans","Yu Gothic UI",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ly = vertical ? -oh / 2 - 20 : -oh / 2 - 16; ctx.fillRect(-16, ly - 7, 32, 14); ctx.strokeRect(-15.5, ly - 6.5, 31, 13); ctx.fillStyle = COL.ink; ctx.fillText(gateLabel(RINGK[b.label]), 0, ly + 1);
    }
    ctx.restore();
  }
  function drawMagnet(m) {   // 馬蹄磁石＋鉛筆の磁力線。点灯や輪は無し。離脱点には物理のクリップ止め
    ctx.save(); ctx.strokeStyle = COL.pencil; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    for (let r = 26; r <= 106; r += 16) { ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    if (IMG['magnet-horseshoe']) sprite('magnet-horseshoe', m.x, m.y, 50, 50, 0);   // 公転半径 約34px の内側に収める
    else { ctx.save(); ctx.translate(m.x, m.y); ctx.lineWidth = 12; ctx.lineCap = 'butt'; ctx.strokeStyle = COL.red; ctx.beginPath(); ctx.arc(0, -6, 22, Math.PI, Math.PI * 1.5); ctx.lineTo(-22, 26); ctx.stroke(); ctx.strokeStyle = COL.blue; ctx.beginPath(); ctx.arc(0, -6, 22, Math.PI * 1.5, Math.PI * 2); ctx.lineTo(22, 26); ctx.stroke(); ctx.restore(); }
    if (REL) {   // クリップ止め: 離脱点に立っている。玉に押されて外れ、飛んでいく
      const dx = REL.x - m.x, dy = REL.y - m.y, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
      let cx = REL.x + ux * 14, cy = REL.y + uy * 14, ang = Math.atan2(uy, ux) + Math.PI / 2, alpha = 1;
      if (clipT >= 0) { const k = Math.min(1, clipT / 45); cx += Math.cos(2.2) * 70 * k + ux * 10 * k; cy += Math.sin(2.2) * 70 * k - 30 * k + 40 * k * k; ang += 3.2 * k; alpha = 1 - ease((clipT - 25) / 20); }
      if (alpha > 0) { ctx.save(); ctx.globalAlpha = alpha; sprite('magnet-clip', cx, cy, 11, 36, ang, 'rgba(120,124,130,.9)'); ctx.restore(); }
    }
  }
  function drawFlap(b, p) {   // 一方通行の扉: 左端の割りピンが支点。回転弧と止めが見える
    const len = b.w || 46; const hx = p.x - Math.cos(p.a) * len / 2, hy = p.y - Math.sin(p.a) * len / 2;
    ctx.save(); ctx.strokeStyle = COL.pencil; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(hx, hy, len, 0.05, 0.9); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(p.a);
    if (IMG['flap-oneway-v2']) ctx.drawImage(IMG['flap-oneway-v2'], -5, -12, 56, 24);
    else { ctx.fillStyle = COL.blue; ctx.fillRect(0, -3, len, 6); ctx.fillStyle = COL.red; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function drawGoalLinkage() {   // 杯が沈む→赤い糸→鐘が一打→折り畳み札が下りて「できた！」（すべて一画面）
    const g = goalPos(), k1 = goalT < 0 ? 0 : ease(goalT / 12), sink = 3 * k1;                       // 杯（皿）が沈む
    const pull = sink;                                                                                 // 糸の引かれる量
    const P0 = { x: g.x + 54, y: g.y - 30 }, P1 = { x: g.x + 54, y: 2975 }, P2 = { x: g.x - 26, y: 2975 };   // 壁の案内輪と二つの滑車
    const anchor = { x: g.x + 42, y: g.y + 7 + sink };                                               // 杯の底の右端（糸の付け根）
    const bellTop = { x: P2.x, y: P2.y + 14 - pull }, signX = g.x + 16;
    // 糸
    ctx.save(); ctx.strokeStyle = COL.red; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(P0.x, P0.y); ctx.lineTo(P1.x, P1.y); ctx.lineTo(P2.x, P2.y); ctx.lineTo(bellTop.x, bellTop.y); ctx.stroke(); ctx.restore();
    // 案内輪・滑車（壁の紙ブラケット付き）
    ctx.save(); ctx.fillStyle = COL.paper2; ctx.strokeStyle = COL.ink; ctx.lineWidth = 1; [P0, P1].forEach(p => { ctx.fillRect(p.x + 4, p.y - 3, 8, 6); ctx.strokeRect(p.x + 4.5, p.y - 2.5, 7, 5); }); ctx.restore();
    [P0, P1, P2].forEach(p => sprite('pulley', p.x, p.y, 16, 16, goalT >= 0 ? -pull * 0.5 : 0, COL.paper2, true));
    // 鐘（糸で吊られ、引かれると揺れて舌が当たる）
    const swing = goalT >= 12 ? Math.sin((goalT - 12) * 0.55) * 0.35 * Math.exp(-(goalT - 12) / 30) : 0;
    ctx.save(); ctx.translate(bellTop.x, bellTop.y); ctx.rotate(swing);
    sprite('bell-bottom', 0, 15, 30, 33, 0, COL.mustard);
    ctx.save(); ctx.translate(0, 8); ctx.rotate(-swing * 1.6); sprite('bell-tongue', 0, 11, 6, 22, 0, COL.red); ctx.restore();
    ctx.restore();
    // 折り畳み札: 糸に紙の輪で掛かっている。糸が動くと留めが外れ、下へ開く
    const k2 = goalT < 0 ? 0 : ease((goalT - 16) / 30), sh = 6 + 30 * k2, sw = 96;
    ctx.save(); ctx.translate(signX, P2.y + 3 - pull);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.stroke();
    if (IMG['goal-dekita']) { ctx.save(); ctx.beginPath(); ctx.rect(-sw / 2, 3, sw, sh); ctx.clip(); ctx.drawImage(IMG['goal-dekita'], -sw / 2, 3 + sh - 36, sw, 36); ctx.restore(); }
    else { ctx.fillStyle = COL.paper2; ctx.fillRect(-sw / 2, 3, sw, sh); ctx.strokeRect(-sw / 2 + .5, 3.5, sw - 1, sh - 1); if (k2 > 0.8) { ctx.fillStyle = COL.ink; ctx.font = '700 16px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('できた！', 0, 3 + sh / 2); } }
    ctx.restore();
    return sink;
  }

  function draw() {
    S = canvas.width / VW;
    cam = idleLeft > 0 ? clampCam({ cx: 180, cy: 200, z: 1.2 }) : camAt(t);
    const pose = poseAt(t), mi = mainIndex(t);
    screenTransform(); ctx.clearRect(0, 0, VW, VH);
    worldTransform();
    // エリアの紙（色）と紙の繊維
    const zx0 = (z) => z.x0 == null ? 0 : z.x0, zx1 = (z) => z.x1 == null ? W : z.x1, narrow = (z) => zx1(z) - zx0(z) < 100;
    for (const z of TL.zones) { ctx.fillStyle = z.paper || COL.paper; ctx.fillRect(zx0(z), z.y0, zx1(z) - zx0(z), z.y1 - z.y0); }
    if (IMG['paper-background-v3']) { ctx.save(); ctx.globalAlpha = 0.55; for (let y = 0; y < H; y += VH) ctx.drawImage(IMG['paper-background-v3'], 0, y, W, VH); ctx.restore(); }
    // 境界線（ちぎり線。水槽は水面。縦の縫い目は細い縦線）と、重力の向きを示す常設の鉛筆矢印
    const drawnY = new Set();
    for (const z of TL.zones) {
      if (z.y0 > 0 && !drawnY.has(z.y0)) {
        drawnY.add(z.y0);
        if (z.id === 'water' && IMG['boundary-water']) ctx.drawImage(IMG['boundary-water'], 0, z.y0 - 8, W, 16);
        else if (IMG['boundary-dash']) ctx.drawImage(IMG['boundary-dash'], 0, z.y0 - 6, W, 12);
        else { ctx.save(); ctx.strokeStyle = 'rgba(200,68,44,.7)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, z.y0); ctx.lineTo(W, z.y0); ctx.stroke(); ctx.restore(); }
      }
      if (zx0(z) > 0) { ctx.save(); ctx.strokeStyle = 'rgba(200,68,44,.7)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(zx0(z), z.y0); ctx.lineTo(zx0(z), z.y1); ctx.stroke(); ctx.restore(); }
      const gx = z.law ? z.law.gx : 0, gy = z.law ? z.law.gy : 1, gm = Math.hypot(gx, gy);
      const ax = narrow(z) ? (zx0(z) + zx1(z)) / 2 : zx0(z) + 18, ay = z.y0 + 34;
      if (gm > 0.2) pencilArrow(ax - gx * 8, ay - gy * 8, gx, gy, 18);
      else { ctx.save(); ctx.strokeStyle = COL.pencil; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(ax, ay, 1.2, 0, Math.PI * 2); ctx.fillStyle = COL.pencil; ctx.fill(); ctx.restore(); }
    }
    // 看板（ちぎり紙＋画鋲）。狭いエリア（縦穴）は色と矢印だけ
    for (const z of TL.zones) {
      if (narrow(z)) continue;
      // 右上が定位置。そこに部品（ゲートなど）が掛かるエリアは左上（矢印の右）へ
      const inBox = (x, y) => x > zx1(z) - 120 && y > z.y0 + 8 && y < z.y0 + 46;
      const busy = TL.statics.some(s => { const L = Math.max(s.sprite.w, s.sprite.h); for (let k = -0.5; k <= 0.5; k += 0.125) if (inBox(s.x + Math.cos(s.a) * L * k, s.y + Math.sin(s.a) * L * k)) return true; return false; });
      ctx.save(); ctx.translate(busy ? zx0(z) + 130 : zx1(z) - 20, z.y0 + 26); ctx.rotate(-0.04);
      ctx.font = '700 13px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'; const tw = Math.max(64, ctx.measureText(z.sign).width + 22);
      if (IMG['sign-blank']) ctx.drawImage(IMG['sign-blank'], -tw, -14, tw, 28); else { ctx.fillStyle = 'rgba(247,239,220,.95)'; ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.2; ctx.fillRect(-tw, -12, tw, 24); ctx.strokeRect(-tw + .5, -11.5, tw - 1, 23); ctx.fillStyle = COL.red; ctx.beginPath(); ctx.arc(-tw + 8, -6, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = COL.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(z.sign, -10, 1); ctx.restore();
    }
    // 水中の泡（浮力と排水の向きを示す働き）
    for (const b of bubbles) { ctx.save(); ctx.globalAlpha = 0.7 * (1 - b.t / b.total); sprite('bubble', b.x, b.y, b.r * 2, b.r * 2, 0, 'rgba(207,219,232,.6)', true); ctx.restore(); }
    // 磁石
    for (const m of TL.magnets) drawMagnet(m);
    // 静的部品
    for (const b of TL.statics) {
      if (b.sensor) { if (/ring/.test(b.sprite.img)) drawGate(b); continue; }   // 杯のセンサーなどは描かない
      if (/^goal/.test(b.label)) continue;                                        // 杯の底と壁は goal-cup の絵で描く
      if (b.label === 'gateStop') { if (IMG['flap-stopper']) ctx.drawImage(IMG['flap-stopper'], b.x - 6, b.y - 6, 12, 12); else sprite('post', b.x, b.y, b.sprite.w, b.sprite.h, b.a, COL.ink); continue; }
      if (b.label === 'keyWall') { if (IMG['keyhole-wall']) { ctx.drawImage(IMG['keyhole-wall'], b.x - 28, b.y - 60 + 14, 56, 120); continue; } }
      if (/^spring/.test(b.label)) { sprite('spring-pad', b.x, b.y, 60, 16, b.a, COL.mustard); continue; }
      sprite(b.sprite.img, b.x, b.y, b.sprite.w, b.sprite.h, b.a, colorOf(b.sprite.img));
    }
    // ゴールの連結（杯の絵は沈む量だけ下げる）
    const sink = drawGoalLinkage();
    { const g = goalPos(); if (IMG['goal-cup']) ctx.drawImage(IMG['goal-cup'], g.x - 46, g.y - 4 - 44 + sink, 92, 52); else { ctx.fillStyle = COL.mustard; ctx.fillRect(g.x - 45, g.y - 4 + sink, 90, 8); ctx.fillRect(g.x - 45, g.y - 46 + sink, 8, 46); ctx.fillRect(g.x + 37, g.y - 46 + sink, 8, 46); } }
    // 可動体（主役には回転が読める丸傷）。扉は蝶番から描く
    TL.bodies.forEach((b, i) => {
      const p = pose[i];
      if (b.label === 'gate') { drawFlap(b, p); return; }
      const w = b.r ? p.r * 2 : b.w, h = b.r ? p.r * 2 : b.h; const img = b.sprite ? b.sprite.img : 'post';
      const dy = (i === mi && goalT >= 0) ? sink : 0;
      if (img === 'fish') sprite('paper-fish', p.x, p.y, w * 1.3, h * 1.6, p.a, COL.mustard);
      else sprite(img, p.x, p.y + dy, w, h, p.a, colorOf(img), !!b.r);
      if (i === mi && b.r) { ctx.save(); ctx.translate(p.x, p.y + dy); ctx.rotate(p.a); const sr = Math.max(1.2, p.r * 0.22); if (IMG['hero-scar']) ctx.drawImage(IMG['hero-scar'], p.r * 0.45 - sr, -p.r * 0.35 - sr, sr * 2, sr * 2); else { ctx.fillStyle = 'rgba(247,239,220,.9)'; ctx.beginPath(); ctx.arc(p.r * 0.45, -p.r * 0.35, sr, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
    });
    for (const e of effects) { const k = e.t / e.total; ctx.save(); ctx.globalAlpha = (1 - k) * 0.9; sprite('jelly-overlay', e.x, e.y, 30 + k * 30, 30 + k * 30, 0, 'rgba(47,111,116,.3)', true); ctx.restore(); }

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
      if (goalT >= 0) { goalT++; if (goalT === 12) sfx.bell(); }
      if (clipT >= 0 && clipT < 60) clipT++;
      // 水中の主役から泡
      if (playing) { const p = poseAt(t), i = mainIndex(t), z = zoneAt(p[i].y); if (z.id === 'water' && (Math.floor(t) % 9 === 0)) bubbles.push({ x: p[i].x + ((t * 7) % 10) - 5, y: p[i].y - 8, r: 2 + (t % 3), t: 0, total: 70, vx: ((t * 13) % 7 - 3) * 0.05 }); }
      for (const b of bubbles) { b.y -= 0.9; b.x += b.vx; b.t++; } bubbles = bubbles.filter(b => b.t < b.total);
      if (idleLeft > 0) { idleLeft--; continue; }
      if (playing && !scrubbing) { const before = t; t = Math.min(endFrame(), t + speedAt(t)); fireEventsUpTo(Math.floor(t)); if (t >= endFrame() && before < endFrame()) { playing = false; updatePlayBtn(); } }
    }
    const active = playing || idleLeft > 0 || effects.length || zoneFlash || bubbles.length || (goalT >= 0 && goalT < 90) || (clipT >= 0 && clipT < 60);
    if (steps && (active || imgTick !== lastImgTick)) { lastImgTick = imgTick; draw(); }
  }
  if (params.get('t')) { t = params.get('t') === 'end' ? endFrame() : Math.min(endFrame(), +params.get('t')); playing = false; idleLeft = 0; syncToTime(); }
  updatePlayBtn(); fit(); requestAnimationFrame(frame);
})();

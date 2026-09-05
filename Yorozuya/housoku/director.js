/* director.js — 上演の台本（カメラ・スロー・拍）。ブラウザ(app.js)と Node 試験(test/check-camera.js)で共用。
   Codex の絵コンテ（storyboard-codex.md §3）と第2レビュー（review2-codex.md §A4・§B）のキーを、各法則の節目(anchors)から生成する。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Director = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 360, H = 560, FPS = 60, MAX_ZOOM = 2.2;
  const WHOLE = { cx: W / 2, cy: H / 2, z: 1 };
  const smooth = (k) => k * k * (3 - 2 * k);

  // 法則ごとの台本。f は物理フレーム。dur はそのキーへ移る補間フレーム数。
  function build(law, L) {
    const A = L.anchors, end = A.end, keys = [], slows = [];
    const has = (v) => v != null && v >= 0;
    const key = (f, o, dur) => { if (!has(f)) return; keys.push(Object.assign({ f: Math.max(0, Math.round(f)), dur: dur || 30 }, o)); };
    const slow = (from, to, sp, tag) => { if (!has(from) || !has(to) || to <= from) return; slows.push({ from: Math.max(0, Math.round(from)), to: Math.round(to), sp, tag: tag || '' }); };
    let idle = 24;
    key(0, WHOLE, 1);
    if (law === 'normal') {
      const bStart = Math.min(has(A.bFall) ? A.bFall : 1e9, has(A.bHit) ? A.bHit : 1e9);
      key(18, { follow: 'ballA', lead: 12, z: 1.7 }, 40);
      key(A.hitD0 - 4, { cx: 205, cy: 150, z: 1.6 }, 28);
      key(A.chainDone - 56, { cx: 286, cy: 176, z: 1.72 }, 28);
      key(bStart - 6, { cx: 310, cy: 222, z: 1.85 }, 22);
      key(A.bHit - 4, { cx: 298, cy: 286, z: 2.0 }, 18);
      key(A.bHit + 12, { follow: 'ballC', lead: 12, z: 1.7 }, 30);
      key(A.arrive - 44, { cx: 84, cy: 440, z: 2.0 }, 30);
      key(A.arrive + 36, WHOLE, 45);
      slow(A.chainDone - 16, A.chainDone, 0.75, '予告');
      slow(A.bHit - 8, A.bHit + 12, 0.45, '最大衝突スロー');
      slow(A.arrive - 18, A.arrive, 0.7, '到着前の間');
    } else if (law === 'jelly') {
      key(18, { follow: 'ballA', lead: 12, z: 1.7 }, 40);
      key(A.hitD0 - 24, { cx: 158, cy: 150, z: 2.05 }, 26);
      key(A.hitD0 + 30, { cx: 204, cy: 151, z: 1.85 }, 30);
      key(A.hitD0 + 54, { cx: 238, cy: 210, z: 1.45 }, 34);
      key(A.arrive + 12, WHOLE, 42);
      slow(A.hitD0 - 10, A.hitD0 + 50, 0.4, '予告');
      slow(A.hitD0 - 6, A.hitD0 + 10, 0.35, '最大衝突スロー');
      slow(A.hitD0 + 50, A.arrive, 0.5, '余韻');
    } else if (law === 'inverted') {
      idle = 36;
      key(6, { cx: 180, cy: 180, z: 1.06 }, 22);            // 一斉上昇: 左端の玉Aも切らない
      key(A.arrive - 20, { cx: 252, cy: 132, z: 1.42 }, 18);
      key(A.arrive - 6, { cx: 292, cy: 70, z: 1.82 }, 18);
      key(A.arrive + 30, { cx: 206, cy: 72, z: 1.48 }, 34);
      key(end - 90, WHOLE, 45);
      slow(0, A.arrive + 36, 0.3, '一斉上昇スロー');
      slow(A.arrive - 10, A.arrive + 12, 0.25, '最大衝突スロー');
      slow(A.arrive + 36, end - 30, 0.45, '余韻');
    } else if (law === 'magnet') {
      key(10, { cx: 265, cy: 235, z: 1.35 }, 28);
      key(A.bHit - 16, { cx: 316, cy: 280, z: 1.95 }, 22);
      key(A.bHit + 22, { cx: 304, cy: 286, z: 1.62 }, 24);
      key(A.arrive - 45, { cx: 286, cy: 300, z: 1.32 }, 34);
      key(A.arrive + 18, WHOLE, 45);
      slow(0, A.bHit + 18, 0.65, '予告');
      slow(A.bHit - 8, A.bHit + 10, 0.45, '最大衝突スロー');
      slow(A.bHit + 18, A.arrive, 0.6, '余韻');
    }
    // 単調増加へ正規化（同値・逆転は1フレームずつ後ろへ）
    keys.sort((a, b) => a.f - b.f);
    for (let i = 1; i < keys.length; i++) if (keys[i].f <= keys[i - 1].f) keys[i].f = keys[i - 1].f + 1;
    for (const k of keys) if (k.z) k.z = Math.min(MAX_ZOOM, k.z);
    let dir = { law, keys, slows, idle };
    // 上演時間が 8 秒未満なら、開始静止を最大 60 フレームまで足す（Codex A4）
    { let n = 0; while (perfSeconds(L, dir) < 8.0 && dir.idle < 60 && n++ < 40) dir.idle += 4; }
    return dir;
  }

  function speedAt(f, dir) { let sp = 1; for (const s of dir.slows) if (f >= s.from && f < s.to) sp = Math.min(sp, s.sp); return sp; }
  // 上演時間（秒）: 静止 + Σ 1/speed + 到着後保持はタイムラインに含まれる
  function perfSeconds(L, dir) { let frames = dir.idle; const end = L.frames.length - 1; for (let f = 0; f < end; f++) frames += 1 / speedAt(f, dir); return frames / FPS; }

  function keyCenter(k, f, L, poseAt) {
    if (k.follow) { const i = L.bodies.findIndex(b => b.label === k.follow); const p = poseAt(L, Math.min(L.frames.length - 1, f + (k.lead || 0)))[i]; return { cx: p.x, cy: p.y, z: k.z }; }
    return { cx: k.cx, cy: k.cy, z: k.z };
  }
  function clamp(c) { const hw = W / (2 * c.z), hh = H / (2 * c.z); return { cx: Math.min(W - hw, Math.max(hw, c.cx)), cy: Math.min(H - hh, Math.max(hh, c.cy)), z: c.z }; }
  function camAt(f, dir, L, poseAt) {
    const K = dir.keys; let i = 0;
    while (i + 1 < K.length && K[i + 1].f <= f) i++;
    const k = K[i], prev = i > 0 ? K[i - 1] : null, cur = keyCenter(k, f, L, poseAt);
    if (!prev) return clamp(cur);
    const p = smooth(Math.min(1, (f - k.f) / Math.max(1, k.dur)));
    const from = keyCenter(prev, f, L, poseAt);   // 追従キーからの遷移も現在時刻で評価（急停止を避ける）
    return clamp({ cx: from.cx + (cur.cx - from.cx) * p, cy: from.cy + (cur.cy - from.cy) * p, z: from.z + (cur.z - from.z) * p });
  }

  // 拍のログ（受け入れ試験と制作記録用）
  function beats(L, dir) {
    const out = [{ f: 0, what: '開始静止 ' + dir.idle + 'f' }];
    for (const s of dir.slows) out.push({ f: s.from, what: s.tag + ' ×' + s.sp + ' (' + s.from + '→' + s.to + ')' });
    const whole = dir.keys.filter(k => k.z === 1 && k.f > 0);
    for (const k of whole) out.push({ f: k.f, what: '全景キー開始' });
    if (L.arrivedFrame > 0) { out.push({ f: L.arrivedFrame, what: '到着' }); out.push({ f: L.frames.length - 1, what: '決め絵保持終了（保持 ' + ((L.frames.length - 1 - L.arrivedFrame) / FPS).toFixed(2) + 's）' }); }
    out.sort((a, b) => a.f - b.f);
    return out;
  }

  return { W, H, FPS, WHOLE, MAX_ZOOM, build, speedAt, perfSeconds, camAt, beats, smooth };
});

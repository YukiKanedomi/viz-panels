/* machine.js — 装置の定義（ブラウザとNode試験で共用）
   ClaudeとCodexの共作「法則をひとつ変えたら」。
   論理座標 360x560、左上原点。乱数なし・スリープなし・固定刻み 1/60 秒。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Machine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 360, H = 560;
  const LAWS = ['normal', 'jelly', 'inverted', 'magnet'];
  const MAGNET_POINT = { x: W - 14, y: 280 };   // 少し内側にして、集まった玉が右辺で切れないようにする
  const MAGNET_ACCEL = 0.0016;         // 単位ベクトル×定数（距離で発散しない）
  const MAX_FRAMES = 12 * 60;

  // 幾何（描画側も同じ定数を使う）
  const G = {
    // 滑り台: 急→緩の3枚板（曲線状）。出口(140,164)でボール中心≈150、ドミノ中央の高さで空中ヒットする。
    // 直線1枚では転がり損失で水平速度2.8しか出ず連鎖が失速した（test/ で掃引）。
    slopePts: [[20, 30], [60, 120], [100, 155], [140, 164]],
    slopeH: 8,
    // 棚板は150〜320。右端と壁の間に34px以上の隙間を残してボールBが落ちられるようにする
    shelf:   { x: 235, y: 184, w: 170, h: 8 },
    // ドミノは細く高く（6x48）・反発0.6・間隔24: Matter.jsで連鎖が失速しない条件（test/sweep で探索）
    domino:  { w: 6, h: 48, n: 6, x0: 162, dx: 24 },
    ballA:   { r: 10, inertiaK: 0.3 },   // 慣性を下げて転がり損失を抑える（見た目は同じ）
    ballB:   { r: 16, x: 319, density: 0.004 },   // 棚端(320)の1px手前: 多角形近似の転がり抵抗があるため、ぎりぎりに置かないと最後のドミノの押しで落ちない
    // 打ち上げは控えめだが、角度±0.03・密度±10%の摂動でも受け皿に入る頑健な設定（強い打ち上げ設定は摂動で外れた）
    seesaw:  { x: 250, y: 310, w: 160, h: 10, angle: -0.21, density: 0.0012 },
    ballC:   { r: 8, friction: 0.3 },
    // 導き板: ボールCが打ち上げ後どこに落ちても受け皿へ転がり落ちる（結末を幾何で保証し、端末間の浮動小数差に耐える。
    // シーソー角±0.03・密度±25%・ボールB密度±10%の摂動でも到着することを test/ で確認）
    chute:   [[218, 394], [146, 446]],
    fulcrum: { w: 24, h: 20 },
    catcher: { x: 92, y: 470, w: 100, h: 8, wallH: 40, wallW: 8 },
    bellBottom: { x: 92, y: 405 },
    bellTop: { x: 296, y: 36, s: 36 },
    magnet:  { x: W - 34, y: 280 },
    // ぜんぶゼリーの物性（ドミノは途中まで倒れて止まり、ボールCは飛ばない結末にする）
    jelly:   { rest: 0.92, dominoRest: 0.92, dominoAir: 0.012, air: 0.012, spring: 1e-4, damp: 2e-4 },
  };

  function create(Matter, law) {
    if (LAWS.indexOf(law) < 0) law = 'normal';
    const { Engine, Bodies, Body, Composite, Constraint, Vector } = Matter;
    const engine = Engine.create({ enableSleeping: false, positionIterations: 8, velocityIterations: 6 });
    // さかさ重力は弱めに反転（ゆっくり天井へ「落ちる」絵にする）。磁石は重力ゼロ。
    engine.gravity.y = law === 'inverted' ? -0.4 : (law === 'magnet' ? 0 : 1);
    const jelly = law === 'jelly', magnet = law === 'magnet';

    const dyn = (o) => Object.assign({
      friction: jelly ? 0.02 : (magnet ? 0.05 : 0.3),
      frictionStatic: jelly ? 0.1 : (magnet ? 0.1 : 0.5),
      restitution: jelly ? G.jelly.rest : 0.05,
      frictionAir: jelly ? G.jelly.air : 0.0015,
    }, o);
    const stat = (o) => Object.assign({ isStatic: true, friction: jelly ? 0.02 : (magnet ? 0.0 : 0.4), restitution: jelly ? G.jelly.rest : 0.05 }, o);
    const tag = (b, label, sprite) => { b.label = label; b.sprite = sprite || null; return b; };

    const world = engine.world;
    const bodies = [];
    const add = (b) => { bodies.push(b); return b; };

    // 外壁（画面外に厚く）
    const T = 60;
    add(tag(Bodies.rectangle(W / 2, H + T / 2, W + 2 * T, T, stat({})), 'floor'));
    add(tag(Bodies.rectangle(W / 2, -T / 2, W + 2 * T, T, stat({})), 'ceiling'));
    add(tag(Bodies.rectangle(-T / 2, H / 2, T, H + 2 * T, stat({})), 'wallL'));
    // 右壁は磁石法則だけ 8px 内側にして、集まった玉が画面の縁で切れないようにする
    add(tag(Bodies.rectangle(W + T / 2 - (magnet ? 8 : 0), H / 2, T, H + 2 * T, stat({})), 'wallR'));

    // 1. 滑り台（3枚板）+ ボールA
    const P = G.slopePts;
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0) + 2, ang = Math.atan2(y1 - y0, x1 - x0);
      add(tag(Bodies.rectangle((x0 + x1) / 2, (y0 + y1) / 2, L, G.slopeH, stat({ angle: ang })), 'slope' + i, { img: 'slope', w: L, h: G.slopeH }));
    }
    const a0 = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]);
    const ballA = add(tag(Bodies.circle(P[0][0] + 12, P[0][1] + 12 * (P[1][1] - P[0][1]) / (P[1][0] - P[0][0]) - (G.slopeH / 2 + G.ballA.r + 0.5) / Math.cos(a0), G.ballA.r,
      dyn({ density: 0.002 })), 'ballA', { img: 'ball-a', w: 20, h: 20 }));
    Body.setInertia(ballA, ballA.inertia * G.ballA.inertiaK);

    // 2. 棚板 + ドミノ6枚
    add(tag(Bodies.rectangle(G.shelf.x, G.shelf.y, G.shelf.w, G.shelf.h, stat({})), 'shelf', { img: 'shelf', w: 190, h: 8 }));
    const shelfTop = G.shelf.y - G.shelf.h / 2;
    const dominoes = [];
    for (let i = 0; i < G.domino.n; i++) {
      const d = add(tag(Bodies.rectangle(G.domino.x0 + i * G.domino.dx, shelfTop - G.domino.h / 2, G.domino.w, G.domino.h,
        dyn({ density: 0.001, restitution: jelly ? G.jelly.dominoRest : 0.6, friction: jelly ? 0.02 : 0.3, frictionStatic: 0, frictionAir: jelly ? G.jelly.dominoAir : 0.0015 })), 'domino' + i, { img: 'domino', w: G.domino.w, h: G.domino.h }));
      d._x0 = d.position.x;
      dominoes.push(d);
    }

    // 3. 重いボールB（棚板右端）
    const ballB = add(tag(Bodies.circle(G.ballB.x, shelfTop - G.ballB.r, G.ballB.r, dyn({ density: G.ballB.density })), 'ballB', { img: 'ball-b', w: 32, h: 32 }));

    // 4. シーソー（支点ピン）+ 左端の受け台と縁石 + ボールC
    const ss = G.seesaw;
    const seesaw = add(tag(Bodies.rectangle(ss.x, ss.y, ss.w, ss.h, dyn({ density: ss.density, angle: ss.angle, friction: 0.5, restitution: jelly ? 0.6 : 0.05 })), 'seesaw', { img: 'seesaw', w: 160, h: 10 }));
    const pin = Constraint.create({ pointA: { x: ss.x, y: ss.y }, bodyB: seesaw, pointB: { x: 0, y: 0 }, length: 0, stiffness: 1, damping: 0 });
    Composite.add(world, pin);
    // 左端の座標（ローカル(-80,0)を回転）
    const ca = Math.cos(ss.angle), sa = Math.sin(ss.angle);
    const rot = (lx, ly) => ({ x: ss.x + lx * ca - ly * sa, y: ss.y + lx * sa + ly * ca });
    const leftBottom = rot(-76, ss.h / 2);
    const leftTop = rot(-72, -ss.h / 2);
    // 受け台: 左端の下で止める
    add(tag(Bodies.rectangle(leftBottom.x - 2, leftBottom.y + 14, 16, 28, stat({})), 'stopUnder', { img: 'post', w: 16, h: 28 }));
    // 縁石: 左端の外側で、ボールCが転げ落ちないように
    const curb = add(tag(Bodies.rectangle(rot(-80, 0).x - 7, leftTop.y - 1, 8, 14, stat({})), 'curb', { img: 'post', w: 8, h: 14 }));
    add(tag(Bodies.rectangle(ss.x, ss.y + ss.h / 2 + G.fulcrum.h / 2 + 1, G.fulcrum.w, G.fulcrum.h, stat({ isSensor: true })), 'fulcrum', { img: 'fulcrum', w: 24, h: 20 }));
    const cPos = rot(-72, -ss.h / 2 - G.ballC.r - 0.5);
    const ballC = add(tag(Bodies.circle(cPos.x, cPos.y, G.ballC.r, dyn({ density: 0.0008, friction: jelly ? 0.02 : G.ballC.friction, frictionStatic: 0 })), 'ballC', { img: 'ball-c', w: 16, h: 16 }));

    // 5. 導き板 + 受け皿（左下）+ 鐘（下・上）
    {
      const [[x0, y0], [x1, y1]] = G.chute;
      const L = Math.hypot(x1 - x0, y1 - y0) + 2, ang = Math.atan2(y1 - y0, x1 - x0);
      add(tag(Bodies.rectangle((x0 + x1) / 2, (y0 + y1) / 2, L, G.slopeH, stat({ angle: ang })), 'chute', { img: 'slope', w: L, h: G.slopeH }));
    }
    const c = G.catcher;
    add(tag(Bodies.rectangle(c.x, c.y + c.wallH / 2, c.w, c.h, stat({})), 'catcherBase', { img: 'catcher', w: 100 + 2 * c.wallW, h: c.wallH + c.h }));
    add(tag(Bodies.rectangle(c.x - c.w / 2 - c.wallW / 2, c.y, c.wallW, c.wallH + c.h, stat({})), 'catcherL'));
    add(tag(Bodies.rectangle(c.x + c.w / 2 + c.wallW / 2, c.y, c.wallW, c.wallH + c.h, stat({})), 'catcherR'));
    const catchSensor = add(tag(Bodies.rectangle(c.x, c.y + 6, c.w - 4, c.wallH - 8, stat({ isSensor: true })), 'catchSensor'));
    const bellTop = add(tag(Bodies.rectangle(G.bellTop.x, G.bellTop.y, G.bellTop.s, G.bellTop.s, stat({ isSensor: true })), 'bellTop', { img: 'bell-top', w: 40, h: 44 }));

    Composite.add(world, bodies);

    const state = {
      law, engine, frame: 0, arrived: false, arrivedFrame: -1, done: false, forced: false,
      events: [],            // {frame, type, x, y}
      bodies, ballA, ballB, ballC, dominoes, seesaw, catchSensor, bellTop, curb,
      _calm: 0, _prevSpeeds: null, _ballC0: { x: ballC.position.x, y: ballC.position.y },
    };

    // 衝突イベント（音・波紋用）
    const impacts = [];
    Matter.Events.on(engine, 'collisionStart', (ev) => {
      for (const p of ev.pairs) {
        const a = p.bodyA, b = p.bodyB;
        if (a.isSensor || b.isSensor) continue;
        const rel = Vector.magnitude(Vector.sub(a.velocity, b.velocity));
        if (rel < 0.6) continue;
        const pt = p.collision.supports[0] || { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
        impacts.push({ frame: state.frame, type: 'impact', a: a.label, b: b.label, speed: rel, x: pt.x, y: pt.y });
      }
    });
    state._impacts = impacts;
    return state;
  }

  function applyLaw(Matter, st) {
    const { Body, Vector } = Matter;
    if (st.law === 'jelly') {
      // ゼリーのドミノ: 傾くと元に戻る復元トルクと、ずれると戻る復元力（ぷるぷる揺れるが倒れない）
      const J = G.jelly;
      for (const d of st.dominoes) {
        d.torque += (-J.spring * d.angle - J.damp * d.angularVelocity) * d.inertia;
        const x0 = d._x0;
        Body.applyForce(d, d.position, { x: (-J.spring * (d.position.x - x0) - J.damp * d.velocity.x) * d.mass, y: 0 });
      }
      return;
    }
    if (st.law !== 'magnet') return;
    for (const b of st.bodies) {
      if (b.isStatic) continue;
      const d = Vector.sub(MAGNET_POINT, b.position);
      const len = Vector.magnitude(d);
      if (len < 1) continue;
      const f = Vector.mult(d, (MAGNET_ACCEL * b.mass) / len);
      Body.applyForce(b, b.position, f);
    }
  }

  // 判定対象の可動体（ピン留めのシーソーは除く）
  function dynamicBodies(st) { return st.bodies.filter(b => !b.isStatic && b !== st.seesaw); }

  function checkArrival(Matter, st) {
    const t = st.frame;
    const spd = (b) => Math.hypot(b.velocity.x, b.velocity.y);
    if (st.law === 'normal') {
      const c = st.ballC.position, s = st.catchSensor.bounds;
      if (t > 60 && c.x > s.min.x && c.x < s.max.x && c.y > s.min.y && c.y < s.max.y + 6 && spd(st.ballC) < 0.8) return 'catcher';
    } else if (st.law === 'inverted') {
      const b = st.bellTop.bounds;
      for (const ball of [st.ballA, st.ballB, st.ballC]) {
        const p = ball.position, r = ball.circleRadius;
        if (p.x + r > b.min.x && p.x - r < b.max.x && p.y + r > b.min.y && p.y - r < b.max.y) return 'bellTop';
      }
    } else if (st.law === 'magnet') {
      const ds = dynamicBodies(st);
      const ok = ds.every(b => b.position.x > W - 90 && spd(b) < 0.9);
      if (t > 90 && ok) return 'magnet';
    } else if (st.law === 'jelly') {
      const ds = dynamicBodies(st);
      const maxV = Math.max.apply(null, ds.map(spd));
      if (t > 150 && maxV < 0.25) st._calm++; else st._calm = 0;
      if (st._calm >= 20) {
        // 到着の条件: 全体が静まり、かつボールCが発射されていない（初期位置から12px以内）
        const c0 = st._ballC0, c = st.ballC.position;
        return Math.hypot(c.x - c0.x, c.y - c0.y) < 12 ? 'settled' : 'settled-launched';
      }
    }
    return null;
  }

  // 1フレーム進める。戻り値: 新しいイベント配列
  function step(Matter, st) {
    if (st.done) return [];
    const before = st._impacts.length;
    applyLaw(Matter, st);
    Matter.Engine.update(st.engine, 1000 / 60);
    st.frame++;
    const fresh = st._impacts.slice(before);
    if (!st.arrived) {
      const a = checkArrival(Matter, st);
      if (a) { st.arrived = true; st.arrivedFrame = st.frame; st.arrival = a; fresh.push({ frame: st.frame, type: 'arrive', what: a }); }
      else if (st.frame >= MAX_FRAMES) { st.done = true; st.forced = true; fresh.push({ frame: st.frame, type: 'forced' }); }
    } else if (st.frame - st.arrivedFrame >= (st.law === 'inverted' ? 150 : 72)) { // 到着後1.2秒（さかさ重力は天井に並ぶまで2.5秒）
      st.done = true; fresh.push({ frame: st.frame, type: 'done' });
    }
    return fresh;
  }

  return { W, H, LAWS, G, MAGNET_POINT, MAX_FRAMES, create, step, applyLaw, checkArrival };
});

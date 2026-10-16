/* =========================================================
   conv.js 单元测试（Node 内置 test runner，node:test + node:assert）
   运行：node --test test/conv.test.js   （cwd = 项目根目录）

   说明：conv.js 的绘图/校验依赖并行开发的 plot.js 提供的 MQP.compileExpr。
   plot.js 可能尚未存在；本文件会尝试 require 它并把导出对象注入 MQV，
   不存在时自动跳过依赖它的用例（见 {skip}），其余用例照常运行。
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const MQV = require('../conv.js');

// 兼容测试文件与 plot.js 的相对位置：先试 ../plot.js（本文件位于 test/ 内）
function tryRequire(p) {
  try { return require(p); } catch (e) { return null; }
}
const MQP = tryRequire('../plot.js') || tryRequire('./plot.js');
const hasMQP = !!(MQP && typeof MQP.compileExpr === 'function');
if (hasMQP) MQV.setMQP(MQP);

// 取采样序列中横坐标最接近 x 的点
function nearest(series, x) {
  let best = series[0];
  for (let i = 0; i < series.length; i++) {
    if (Math.abs(series[i].x - x) < Math.abs(best.x - x)) best = series[i];
  }
  return best;
}

/* ===================== 连续卷积 ===================== */
test('连续：两个宽度 1 的矩形脉冲卷积应得到三角形', () => {
  // rect 支撑为 [center-0.5, center+0.5]，高度 1
  const rect = (center, w) => (v) => (Math.abs(v.t - center) <= w / 2 ? 1 : 0);
  const a = rect(0, 1);
  const b = rect(0, 1);

  const res = MQV.numericalConvolve(a, b, { mode: 'continuous', xMin: -1.5, xMax: 1.5, samples: 601 });
  assert.ok(Array.isArray(res), '应返回数组');
  assert.equal(res.length, 601);
  assert.ok('x' in res[0] && 'y' in res[0], '元素形如 {x, y}');

  // 峰值 ≈ 1（两个宽 1 高 1 的矩形卷积，三角形顶点 = 重叠面积 1）
  let peak = res[0];
  for (let i = 0; i < res.length; i++) if (res[i].y > peak.y) peak = res[i];
  assert.ok(Math.abs(peak.y - 1) <= 0.05, `峰值应≈1（容差 5%），实际 ${peak.y}`);
  // 峰值位置 ≈ 0
  assert.ok(Math.abs(peak.x) <= 0.05, `峰值应出现在 t≈0，实际 t=${peak.x}`);
  // 半高峰 |
  const half = nearest(res, 0.5);
  assert.ok(Math.abs(half.y - 0.5) <= 0.05, `t=0.5 处应≈0.5，实际 ${half.y}`);
  const half2 = nearest(res, -0.5);
  assert.ok(Math.abs(half2.y - 0.5) <= 0.05, `t=-0.5 处应≈0.5，实际 ${half2.y}`);
  // 支撑之外（|t|>1）应为 0
  assert.ok(nearest(res, 1.2).y <= 0.05, `t=1.2 处应≈0，实际 ${nearest(res, 1.2).y}`);
  assert.ok(nearest(res, -1.2).y <= 0.05, `t=-1.2 处应≈0，实际 ${nearest(res, -1.2).y}`);
});

/* ===================== 离散卷积 ===================== */
test('离散：delta 与任意序列 h 卷积应等于 h 本身', () => {
  const delta = (v) => (v.n === 0 ? 1 : 0);
  const h = (v) => (v.n >= 0 ? Math.pow(0.5, v.n) : 0);
  const res = MQV.numericalConvolve(delta, h, { mode: 'discrete', xMin: -5, xMax: 5, samples: 11 });
  assert.equal(res.length, 11);
  for (let i = 0; i < res.length; i++) {
    const p = res[i];
    const expect = h({ n: p.x });
    assert.ok(Math.abs(p.y - expect) < 1e-9, `n=${p.x}：期望 ${expect}，实际 ${p.y}`);
  }
});

test('离散：两个单位阶跃 u[n] 卷积应得到斜变序列 (n+1)', () => {
  const u = (v) => (v.n >= 0 ? 1 : 0);
  const res = MQV.numericalConvolve(u, u, { mode: 'discrete', xMin: -5, xMax: 5, samples: 11 });
  for (let i = 0; i < res.length; i++) {
    const p = res[i];
    const expect = p.x >= 0 ? p.x + 1 : 0;
    assert.equal(p.y, expect, `n=${p.x}：期望 ${expect}，实际 ${p.y}`);
  }
});

/* ===================== runningConvolve ===================== */
test('runningConvolve：非负信号下面积随平移量单调不减，最终面积等于总积分', () => {
  const u = (v) => (v.t >= 0 ? 1 : 0); // 单位阶跃
  const opts = { mode: 'continuous', xMin: -5, xMax: 5, samples: 1001 };

  let prev = -Infinity;
  let last = 0;
  const shifts = [0, 1, 2, 3, 4, 5];
  for (let i = 0; i < shifts.length; i++) {
    const r = MQV.runningConvolve(u, u, opts, shifts[i]);
    // 样本结构形如 {x, a, b, prod}
    assert.ok(Array.isArray(r.samples) && r.samples.length === 1001);
    const s0 = r.samples[0];
    assert.ok('x' in s0 && 'a' in s0 && 'b' in s0 && 'prod' in s0, '样本应含 x/a/b/prod');
    assert.ok(typeof r.area === 'number');
    assert.ok(r.area >= prev - 1e-9, `面积应单调不减：${prev} → ${r.area}`);
    prev = r.area;
    last = r.area;
  }
  // 平移 t=5 时积分区间为 τ∈[0,5]，∫1 dτ = 5
  assert.ok(Math.abs(last - 5) <= 0.1, `最终面积应≈5（总积分），实际 ${last}`);

  // 单次调用内累积面积亦单调不减（供动画逐步显示积分条）
  const r1 = MQV.runningConvolve(u, u, opts, 2);
  for (let i = 1; i < r1.cum.length; i++) {
    assert.ok(r1.cum[i] >= r1.cum[i - 1] - 1e-12, '累积面积应单调不减');
  }
});

/* ===================== parseConvSpec 校验 ===================== */
test('parseConvSpec：空/异常输入返回 error 且不抛异常（不依赖 plot.js）', () => {
  assert.doesNotThrow(() => {
    assert.ok(MQV.parseConvSpec(null).error, '空输入应返回 error');
    assert.ok(MQV.parseConvSpec({ exprA: '', exprB: 'x' }).error, '空表达式 A 应返回 error');
    assert.ok(MQV.parseConvSpec({ exprA: 'x', exprB: '   ' }).error, '空表达式 B 应返回 error');
    const e = MQV.parseConvSpec({ exprA: '', exprB: '' }).error;
    assert.ok(/[\u4e00-\u9fa5]/.test(e), 'error 应为中文');
  });
});

test('parseConvSpec：非法表达式返回 error 而不抛异常', { skip: !hasMQP }, () => {
  assert.doesNotThrow(() => {
    const bad = MQV.parseConvSpec({ mode: 'continuous', exprA: '((', exprB: '1', varMin: -1, varMax: 1, samples: 51 });
    assert.ok(bad && typeof bad.error === 'string' && bad.error.length > 0, '非法表达式应返回 error');
    assert.ok(/[\u4e00-\u9fa5]/.test(bad.error), 'error 应为中文');
  });
  const bad2 = MQV.parseConvSpec({ mode: 'continuous', exprA: 'sin(', exprB: '1' });
  assert.ok(bad2.error, '括号不匹配应返回 error');
});

test('parseConvSpec：合法输入返回归一化 spec', { skip: !hasMQP }, () => {
  const spec = MQV.parseConvSpec({
    mode: 'continuous', exprA: '1', exprB: '2', varMin: -2, varMax: 2, samples: 41, dark: true,
  });
  assert.ok(!spec.error, `不应有 error：${spec.error}`);
  assert.equal(spec.mode, 'continuous');
  assert.equal(spec.exprA, '1');
  assert.equal(spec.exprB, '2');
  assert.equal(spec.varMin, -2);
  assert.equal(spec.varMax, 2);
  assert.equal(spec.samples, 41);
  assert.equal(spec.dark, true);
});

/* ===================== 绘图 / 控制器 在 Node 下安全降级 ===================== */
test('drawConv：无 canvas 的 Node 环境下安全返回 null，不抛异常', () => {
  assert.equal(
    MQV.drawConv(null, { mode: 'continuous', exprA: '1', exprB: '1', varMin: -1, varMax: 1, samples: 11 }, 0),
    null
  );
  assert.doesNotThrow(() => MQV.drawConv(undefined, { exprA: '1', exprB: '1' }, 0));
  // 伪 canvas：有 getContext 但返回 null
  assert.equal(MQV.drawConv({ getContext: () => null }, { exprA: '1', exprB: '1' }, 0), null);
});

test('createConvController：无 requestAnimationFrame 时静默降级', () => {
  const ctl = MQV.createConvController(null, {
    mode: 'discrete', exprA: '1', exprB: '1', varMin: -3, varMax: 3, samples: 7,
  });
  assert.equal(typeof ctl.setShift, 'function');
  assert.equal(typeof ctl.getShift, 'function');
  assert.equal(typeof ctl.play, 'function');
  assert.equal(typeof ctl.pause, 'function');
  assert.equal(typeof ctl.stop, 'function');
  assert.equal(typeof ctl.isPlaying, 'function');

  assert.equal(ctl.setShift(2), 2);
  assert.equal(ctl.getShift(), 2);
  assert.equal(ctl.setShift(99), 3, '越界应钳制到 varMax');
  assert.equal(ctl.setShift(-99), -3, '越界应钳制到 varMin');

  assert.doesNotThrow(() => {
    assert.equal(ctl.play(), ctl, 'play 应返回控制器本身');
    assert.equal(ctl.isPlaying(), false, '无 rAF 时不应进入播放状态');
    ctl.pause();
    ctl.stop();
  });
  assert.equal(ctl.getShift(), -3, 'stop 应复位到 varMin');
});

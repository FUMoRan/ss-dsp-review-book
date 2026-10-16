/* =========================================================
   plot.js 纯函数单元测试（Node 内置 test runner）
   运行：node --test test/plot.test.js   （cwd = 项目根目录）
   仅覆盖与 DOM 无关的数学 / 解析 / 数值部分。
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const MQP = require('../plot.js');

const {
  compileExpr, tryCompileExpr,
  polyRoots, evalPoly, polyMul, polyAdd,
  dft,
} = MQP;

const ZH = /[\u4e00-\u9fa5]/;

// 判断根集合中是否含（容差 1e-6 的）指定复根
function hasRoot(roots, re, im, tol) {
  tol = tol || 1e-6;
  return roots.some(r => Math.abs(r.re - re) < tol && Math.abs(r.im - im) < tol);
}

/* ===================== compileExpr 返回类型 ===================== */
test('compileExpr 返回的是一个函数（而非对象）', () => {
  assert.strictEqual(typeof compileExpr('1+t'), 'function');
  assert.strictEqual(typeof compileExpr('sin(2*pi*t)'), 'function');
  assert.strictEqual(compileExpr('1').constructor.name, 'Function');
});

/* ===================== 非法输入必须抛错 ===================== */
test('compileExpr 对非法表达式抛 Error', () => {
  ['', '   ', '1+', '(1+2', 'foo(1)', '1+unknownVar'].forEach(function (bad) {
    assert.throws(() => compileExpr(bad), Error, '应抛错：' + JSON.stringify(bad));
  });
});

test('compileExpr 抛出的是带中文说明的 Error', () => {
  try {
    compileExpr('1+unknownVar');
    assert.fail('应抛错');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(ZH.test(e.message), '错误信息应为中文：' + e.message);
  }
});

/* ===================== tryCompileExpr ===================== */
test('tryCompileExpr: 非法输入返回 {ok:false} 且 error 为非空中文', () => {
  const bad = tryCompileExpr('(');
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.error, 'string');
  assert.ok(bad.error.length > 0);
  assert.ok(ZH.test(bad.error), 'error 应为中文：' + bad.error);
});

test('tryCompileExpr: 合法输入返回 {ok:true, fn}', () => {
  const good = tryCompileExpr('sin(t)');
  assert.equal(good.ok, true);
  assert.strictEqual(typeof good.fn, 'function');
});

/* ===================== 编译结果与手算值比对 ===================== */
test('关键函数取值与手算一致', () => {
  const sin2 = compileExpr('sin(2*pi*t)');
  assert.ok(Math.abs(sin2({ t: 0.25 }) - 1) < 1e-9, 'sin(2*pi*0.25)≈1');

  const e0 = compileExpr('exp(t)');
  assert.equal(e0({ t: 0 }), 1, 'exp(0)=1');

  const u = compileExpr('u(t)');
  assert.equal(u({ t: -1 }), 0, 'u(-1)=0');
  assert.equal(u({ t: 1 }), 1, 'u(1)=1');

  const rect = compileExpr('rect(t)');
  assert.equal(rect({ t: 0 }), 1, 'rect(0)=1');

  const sinc = compileExpr('sinc(t)');
  assert.equal(sinc({ t: 0 }), 1, 'sinc(0)=1');
  assert.ok(Math.abs(sinc({ t: 1 })) < 1e-9, 'sinc(1)≈0');
});

test('常量、幂、一元负号优先级与变量别名', () => {
  assert.ok(Math.abs(compileExpr('pi')({}) - Math.PI) < 1e-12);
  assert.equal(compileExpr('2^3+t')({ t: 0 }), 8, '幂运算');
  assert.equal(compileExpr('-t^2')({ t: 2 }), -4, '一元负号优先级：-(t^2)');
  assert.ok(Math.abs(compileExpr('log(e)')({}) - 1) < 1e-12, 'log 为自然对数');
  assert.equal(compileExpr('omega')({ w: 5 }), 5, 'omega 等价 w');
  assert.equal(compileExpr('1.5e-2+t')({ t: 0 }), 0.015, '科学计数法');
});

test('数值异常不崩溃（除零返回 Infinity/NaN 即可）', () => {
  assert.equal(compileExpr('1/t')({ t: 0 }), Infinity);
  assert.ok(Number.isNaN(compileExpr('sqrt(t)')({ t: -1 })));
});

/* ===================== 多项式 ===================== */
test('polyMul / polyAdd 按降幂运算', () => {
  assert.deepEqual(polyMul([1, 1], [1, 1]), [1, 2, 1]);
  assert.deepEqual(polyMul([1, 0, 1], [1, 1]), [1, 1, 1, 1]);
  assert.deepEqual(polyAdd([1, 2], [1]), [1, 3]);
  assert.deepEqual(polyAdd([1, 0, 1], [1, -1]), [1, 1, 0]);
});

test('polyRoots: z²+3z+2 的根为 -1 与 -2', () => {
  const roots = polyRoots([1, 3, 2]);
  assert.equal(roots.length, 2);
  assert.ok(hasRoot(roots, -1, 0), '应含根 -1');
  assert.ok(hasRoot(roots, -2, 0), '应含根 -2');
  roots.forEach(function (r) {
    const y = evalPoly([1, 3, 2], r);
    assert.ok(Math.abs(y.re) < 1e-6 && Math.abs(y.im) < 1e-6, '代回应为 0');
  });
});

test('polyRoots: z²+1 的根为 ±j', () => {
  const roots = polyRoots([1, 0, 1]);
  assert.equal(roots.length, 2);
  assert.ok(hasRoot(roots, 0, 1), '应含根 j');
  assert.ok(hasRoot(roots, 0, -1), '应含根 -j');
  roots.forEach(function (r) {
    const y = evalPoly([1, 0, 1], r);
    assert.ok(Math.abs(y.re) < 1e-6 && Math.abs(y.im) < 1e-6);
  });
});

test('polyRoots: 三阶 z³-6z²+11z-6 的根为 1,2,3', () => {
  const c = [1, -6, 11, -6];
  const roots = polyRoots(c);
  assert.equal(roots.length, 3);
  [1, 2, 3].forEach(function (k) {
    assert.ok(hasRoot(roots, k, 0), '应含根 ' + k);
  });
  roots.forEach(function (r) {
    const y = evalPoly(c, r);
    assert.ok(Math.abs(y.re) < 1e-6 && Math.abs(y.im) < 1e-6, '代回应为 0');
  });
});

/* ===================== DFT ===================== */
test('DFT: 长度 8 的常数序列只在 k=0 有能量', () => {
  const seq = new Array(8).fill(1);
  const D = dft(seq, 7);
  assert.equal(D.length, 8);
  assert.ok(Math.abs(D[0].mag - 8) < 1e-9, '|X[0]| 应为 8');
  for (let k = 1; k <= 7; k++) {
    assert.ok(D[k].mag < 1e-9, 'k=' + k + ' 应为 0，实际 ' + D[k].mag);
  }
});

test('DFT: cos 序列峰值落在正确频点索引', () => {
  const N = 16, m = 3;
  const seq = [];
  for (let n = 0; n < N; n++) seq.push(Math.cos(2 * Math.PI * m * n / N));
  const D = dft(seq, N - 1);
  assert.ok(Math.abs(D[m].mag - N / 2) < 1e-9, '|X[3]| 应约为 N/2=8');
  // 峰值索引应为 3（或对称的 13，模相等）
  let argmax = 0;
  for (let k = 0; k < N; k++) if (D[k].mag > D[argmax].mag) argmax = k;
  assert.ok(argmax === m || argmax === N - m, '峰值索引应为 3 或 13，实际 ' + argmax);
});

/* ===================== 复频响 / 相位解卷绕 / 群延迟 ===================== */
test('respComplex: H(s)=1/(s+1) 在 ω=1 处模为 1/√2、相位 -45°', () => {
  const r = MQP.respComplex([1], [1, 1], 1, 's');
  assert.ok(Math.abs(r.mag - Math.SQRT1_2) < 1e-9, '|H(j1)|≈0.7071');
  assert.ok(Math.abs(r.phase + Math.PI / 4) < 1e-9, '相位应为 -π/4');
});

test('unwrapPhase: 消除 ±π 跳变，得到连续相位', () => {
  const raw = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0];
  const out = MQP.unwrapPhase(raw);
  assert.equal(out.length, raw.length);
  // 解卷绕后相邻差的绝对值不应超过 π（跳变被消除）
  for (let i = 1; i < out.length; i++) {
    assert.ok(Math.abs(out[i] - out[i - 1]) <= Math.PI + 1e-9, '相邻相位差应 ≤ π');
  }
  // 第 3 点（原 -π/2）应被抬到 π/2 的延续处
  assert.ok(Math.abs(out[3] - 3 * Math.PI / 2) < 1e-9, '应为 3π/2，实际 ' + out[3]);
  assert.deepEqual(MQP.unwrapPhase([]), []);
});

test('groupDelay: H(s)=1/(s+1) 在 ω=0 处群延迟为 1 秒', () => {
  const gd = MQP.groupDelay([1], [1, 1], 0, 's');
  assert.ok(Math.abs(gd - 1) < 1e-6, 'τ(0) 应为 1，实际 ' + gd);
  assert.ok(MQP.groupDelay([1], [1, 1], 1, 's') < 1, 'τ 随 ω 增大应减小');
});

/* ===================== 收敛域（ROC）判定 ===================== */
test('rocOf: 单极点 z=0.5 → 因果 ROC 在圆外且稳定', () => {
  const info = MQP.rocOf([{ re: 0.5, im: 0 }], 'z');
  const causal = info.regions.find(r => r.type === 'causal');
  assert.ok(causal && /0\.5/.test(causal.roc), '因果 ROC 应为 |z|>0.5');
  assert.equal(causal.stable, true, '极点幅值<1 时因果系统稳定');
  assert.equal(info.causalStable, true);
});

test('rocOf: 极点 z=1.5 → 因果 ROC 在圆外且不稳定，反因果 ROC 稳定', () => {
  const info = MQP.rocOf([{ re: 1.5, im: 0 }], 'z');
  const causal = info.regions.find(r => r.type === 'causal');
  const anti = info.regions.find(r => r.type === 'anticausal');
  assert.equal(causal.stable, false, '极点幅值>1，因果系统不稳定');
  assert.equal(anti.stable, true, '反因果 ROC 含单位圆，稳定');
  assert.equal(info.causalStable, false);
});

test('rocOf: 连续单极点 s=-1 → 因果 ROC 为 Re(s)>-1 且稳定', () => {
  const info = MQP.rocOf([{ re: -1, im: 0 }], 's');
  const causal = info.regions.find(r => r.type === 'causal');
  assert.ok(causal && /-1/.test(causal.roc));
  assert.equal(causal.stable, true, '极点实部<0 时因果系统稳定');
  assert.equal(MQP.rocOf([], 'z').empty, true, '无极点返回 empty');
});

/* ===================== 全通 / 最小相位 ===================== */
test('allPassMinPhase: (z⁻¹−a)/(1−a z⁻¹) 是全通但非最小相位', () => {
  const info = MQP.allPassMinPhase([-0.5, 1], [1, -0.5], 'z');
  assert.equal(info.allpass, true, '零极点为共轭倒数镜像');
  assert.equal(info.minphase, false, '存在 |z|>1 的零点');
});

test('allPassMinPhase: 零点全在单位圆内即为最小相位', () => {
  const info = MQP.allPassMinPhase([1, 0.5], [1, -0.9], 'z');
  assert.equal(info.minphase, true, '零点 |z|<1');
  assert.equal(info.allpass, false, '零极点未镜像对称');
});

/* ===================== s↔z 映射 ===================== */
test('bilinearTF: H(s)=1/(s+1), T=1 → H(z)=(z+1)/(3z−1)', () => {
  const r = MQP.bilinearTF([1], [1, 1], 1);
  assert.deepEqual(r.num, [1, 1]);
  assert.deepEqual(r.den, [3, -1]);
});

test('impulseInvariantPoles: s=-1,-2, T=0.5 → z=e^{-0.5}, e^{-1}', () => {
  const z = MQP.impulseInvariantPoles([{ re: -1, im: 0 }, { re: -2, im: 0 }], 0.5);
  assert.ok(Math.abs(z[0].re - Math.exp(-0.5)) < 1e-12);
  assert.ok(Math.abs(z[1].re - Math.exp(-1)) < 1e-12);
  assert.ok(Math.abs(z[0].im) < 1e-12);
});

/* ===================== 窗函数 ===================== */
test('windowCoeffs: 矩形窗全为 1，汉宁窗两端为 0', () => {
  const rect = MQP.windowCoeffs('rect', 5);
  assert.deepEqual(rect, [1, 1, 1, 1, 1]);
  const hann = MQP.windowCoeffs('hann', 5).map(v => +v.toFixed(6));
  assert.deepEqual(hann, [0, 0.5, 1, 0.5, 0]);
});

test('windowMetrics: 主瓣宽 rect<hann<blackman，旁瓣电平同样递增', () => {
  const rect = MQP.windowMetrics('rect', 21);
  const hann = MQP.windowMetrics('hann', 21);
  const black = MQP.windowMetrics('blackman', 21);
  assert.ok(rect.bins < hann.bins && hann.bins < black.bins, '主瓣宽应递增');
  assert.ok(rect.sidelobeDb > hann.sidelobeDb && hann.sidelobeDb > black.sidelobeDb,
    '旁瓣电平：矩形最高、汉宁次之、布莱克曼最低');
});

/* ===================== 卷积 ===================== */
test('linearConv: [1,2] * [1,1] = [1,3,2]', () => {
  assert.deepEqual(MQP.linearConv([1, 2], [1, 1]), [1, 3, 2]);
  assert.deepEqual(MQP.linearConv([1], [1]), [1]);
});

test('circularConv: N≥L+P−1 时与线性卷积逐点一致；N 不足则混叠', () => {
  const a = [1, 2], b = [1, 1];
  assert.deepEqual(MQP.circularConv(a, b, 3), [1, 3, 2], 'N=3 等于线性卷积');
  const cyc = MQP.circularConv(a, b, 2);
  assert.equal(cyc.length, 2);
  // N=2 时发生环绕混叠：[1+2, 3] = [3,3]
  assert.deepEqual(cyc, [3, 3]);
});

/* ===================== 预览示例基本自洽 ===================== */
test('PREVIEW 每种 kind 至少两个示例，参数完整且可编译', () => {
  const kinds = ['ct', 'dt', 'spectrum', 'bode', 'polezero', 'sampling', 'window', 'groupdelay'];
  kinds.forEach(function (kind) {
    const list = MQP.PREVIEW[kind];
    assert.ok(Array.isArray(list) && list.length >= 2, kind + ' 示例不足');
    list.forEach(function (spec) {
      assert.equal(spec.kind, kind);
      if (spec.expr) {
        assert.equal(typeof compileExpr(spec.expr), 'function', kind + ' 表达式应可编译：' + spec.expr);
      }
      if (kind === 'bode' || kind === 'polezero' || kind === 'groupdelay') {
        assert.ok(Array.isArray(spec.num) && Array.isArray(spec.den), kind + ' 应有 num/den');
      }
      if (kind === 'window') assert.ok(typeof spec.types === 'string' && spec.types.length > 0);
      if (kind === 'sampling') assert.ok(typeof spec.ws === 'number');
    });
  });
});

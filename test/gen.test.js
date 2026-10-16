/* =========================================================
   gen.js 单元测试（Node 内置 test runner，node:test + node:assert）
   运行：node --test test/gen.test.js   （cwd = 项目根目录）

   gen.js 是「按标签一键生成图表」的纯逻辑模块：规则层 → 抽取层 → 表格层，
   全部与 DOM 无关、不联网、不使用任何 API Key。本文件只验证纯逻辑部分。
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const MQG = require('../gen.js');
const MQP = require('../plot.js');

/* ===================== 规则层：标签 → 生成项 ===================== */
test('规则层：已知标签能匹配到规则，未知标签返回 null', () => {
  const r = MQG.tagRule('ss', '卷积');
  assert.ok(r, '「卷积」应有规则');
  assert.deepEqual(r.plots, ['conv']);
  assert.deepEqual(r.tables, ['conv']);
  assert.equal(MQG.tagRule('ss', '这个标签不存在'), null);
  assert.equal(MQG.tagRule('不存在的科目', '卷积'), null);
});

test('规则层：标签匹配忽略多余空白', () => {
  assert.ok(MQG.tagRule('dsp', ' 系统函数 '), '应忽略首尾空白');
  assert.ok(MQG.tagRule('dsp', 'DFT'), 'DFT 应有规则');
});

test('规则层：可驱动标签列表只含能生成图/表的标签', () => {
  const list = MQG.drivableTags('ss');
  assert.ok(list.includes('卷积'));
  assert.ok(list.includes('系统函数'));
  assert.ok(!list.includes('线性时不变'), '「线性时不变」不生成任何图表，不应出现');
});

/* ===================== 抽取层：LaTeX → 表达式 ===================== */
test('latexToExpr：连续信号表达式可转换并可求值', () => {
  const cv = MQG.latexToExpr('e^{-2t}\\mathrm{u}(t)');
  assert.ok(cv.ok, cv.error);
  const fn = MQP.compileExpr(cv.expr);
  assert.ok(Math.abs(fn({ t: 1 }) - Math.exp(-2)) < 1e-9);
  assert.equal(fn({ t: -1 }), 0, 'u(t) 在 t<0 时为 0');
});

test('latexToExpr：离散写法 x[n] / u[n] 也能转换', () => {
  const cv = MQG.latexToExpr('0.8^{n}\\mathrm{u}[n]');
  assert.ok(cv.ok, cv.error);
  const fn = MQP.compileExpr(cv.expr);
  assert.ok(Math.abs(fn({ n: 2 }) - 0.64) < 1e-9);
});

test('latexToExpr：含虚数 j 的频域表达式明确拒绝', () => {
  const cv = MQG.latexToExpr('X(j\\omega)');
  assert.equal(cv.ok, false);
  assert.match(cv.error, /虚数|j/);
});

/* ===================== 抽取层：有理式 → 降幂系数 ===================== */
test('rationalCoeffs：z 域负幂归一化为正幂系数', () => {
  const rc = MQG.rationalCoeffs('\\dfrac{1}{1-0.8z^{-1}}', 'z');
  assert.deepEqual(rc.num, [1, 0]);   // z
  assert.deepEqual(rc.den, [1, -0.8]); // z − 0.8
});

test('rationalCoeffs：s 域多项式系数', () => {
  const rc = MQG.rationalCoeffs('\\frac{s+2}{s^{2}+2s+5}', 's');
  assert.deepEqual(rc.num, [1, 2]);
  assert.deepEqual(rc.den, [1, 2, 5]);
});

/* ===================== 抽取层：系统函数 / 差分方程 ===================== */
test('extractTF：从题面识别 H(s)', () => {
  const tf = MQG.extractTF('某因果 LTI 系统 $H(s)=\\dfrac{s+2}{s^{2}+2s+5}$，判断是否稳定');
  assert.ok(tf);
  assert.equal(tf.domain, 's');
  assert.deepEqual(tf.num, [1, 2]);
  assert.deepEqual(tf.den, [1, 2, 5]);
  assert.ok(tf.raw, '应保留原始 LaTeX 供说明');
});

test('extractDiffEq：识别差分方程并给出 H(z)', () => {
  const d = MQG.extractDiffEq('已知 $y[n]-0.9y[n-1]=x[n]$');
  assert.ok(d);
  assert.equal(d.domain, 'z');
  assert.deepEqual(d.den, [1, -0.9]);  // 1 − 0.9z⁻¹ → z − 0.9
  assert.deepEqual(d.num, [1, 0]);     // 与分母同乘 z 后为 z
  assert.match(d.raw, /1.*0\.9z\^-1/);
});

/* ===================== 抽取层：信号（含离散两种写法） ===================== */
test('extractSignals：连续信号', () => {
  const s = MQG.extractSignals('设 $x(t)=\\mathrm{u}(t)-\\mathrm{u}(t-2)$');
  assert.equal(s.ct.length, 1);
  assert.equal(s.ct[0].name, 'x(t)');
});

test('extractSignals：方括号写法 + 薄空格 \\, 不截断表达式', () => {
  const s = MQG.extractSignals('求序列 $x[n]=0.8^{\\,n}\\mathrm{u}[n]$ 的 Z 变换');
  assert.equal(s.dt.length, 1, '应识别出 x[n]');
  assert.equal(s.dt[0].name, 'x[n]');
  const fn = MQP.compileExpr(s.dt[0].expr);
  assert.ok(Math.abs(fn({ n: 1 }) - 0.8) < 1e-9);
});

test('extractSignals：有限长序列列举式转成冲激串', () => {
  const s = MQG.extractSignals('对 8 点序列 $x[n]=\\{1,1,1,1,0,0,0,0\\}$ 求 DFT');
  assert.equal(s.dt.length, 1);
  assert.deepEqual(s.dt[0].seq, [1, 1, 1, 1, 0, 0, 0, 0]);
  const fn = MQP.compileExpr(s.dt[0].expr);
  assert.equal(fn({ n: 2 }), 1);
  assert.equal(fn({ n: 5 }), 0);
});

/* ===================== 表格层 ===================== */
test('表格层：极点与稳定性（连续系统全在左半平面 → 稳定）', () => {
  const t = MQG.buildTable('poles', { tf: { domain: 's', num: [1, 2], den: [1, 2, 5], raw: 'H(s)' } });
  assert.ok(t);
  const poleRows = t.rows.filter(r => String(r[0]).startsWith('极点'));
  assert.equal(poleRows.length, 2);
  assert.ok(poleRows.every(r => r[3] === '稳定'), JSON.stringify(t.rows));
});

test('表格层：抽样判定（f_s=100 > 2f_m=60 → 不混叠）', () => {
  const t = MQG.buildTable('sampling', { samp: { fs: 100, fm: 30 } });
  assert.ok(t);
  const row = t.rows.find(r => r[0] === '是否满足抽样定理');
  assert.equal(row[1], '满足，不混叠');
  assert.ok(t.rows.some(r => r[0] === '奈奎斯特率 2f_m' && r[1] === '60'));
});

test('表格层：差分方程系数与特征根', () => {
  const d = MQG.extractDiffEq('$y[n]-0.9y[n-1]=x[n]$');
  const t = MQG.buildTable('coeffs', { diff: d });
  assert.ok(t);
  assert.ok(t.rows.some(r => r[0] === 'a0（y[n]）' && r[1] === '1'));
  assert.ok(t.rows.some(r => r[0] === 'a1（y[n−1]）' && r[1] === '-0.9'));
  assert.ok(t.rows.some(r => String(r[0]).startsWith('极点') && /稳定/.test(r[1])));
});

/* ===================== 入口：plan ===================== */
test('plan：卷积题按标签生成卷积图解 + 逐项表', () => {
  const p = MQG.plan('ss', {
    subject: 'ss', tags: ['卷积'],
    stem: '设 $x(t)=\\mathrm{u}(t)-\\mathrm{u}(t-2)$，$h(t)=e^{-t}\\mathrm{u}(t)$，求 $y(t)=x(t)*h(t)$。',
  });
  const plot = p.items.find(x => x.type === 'plot' && x.kind === 'conv');
  assert.ok(plot && plot.ready, '卷积图解应就绪');
  assert.equal(plot.fields.mode, 'continuous');
  assert.equal(plot.fields.exprA, 'u(t)-u(t-2)');
  const table = p.items.find(x => x.type === 'table' && x.kind === 'conv');
  assert.ok(table && table.ready && table.data.rows.length > 0);
});

test('plan：缺参数时给出「缺少什么」，不硬造数据', () => {
  const p = MQG.plan('dsp', { subject: 'dsp', tags: ['系统函数'], stem: '某离散系统，求频率响应。' });
  const plot = p.items.find(x => x.type === 'plot' && x.kind === 'polezero');
  assert.ok(plot);
  assert.equal(plot.ready, false);
  assert.ok(plot.missing.includes('tf'));
  assert.ok(plot.hint && plot.hint.length > 0);
});

test('plan：DTFT/DFT 题由列举式序列生成频谱图与频谱表', () => {
  const p = MQG.plan('dsp', {
    subject: 'dsp', tags: ['DFT'],
    stem: '对 8 点序列 $x[n]=\\{1,1,1,1,0,0,0,0\\}$ 求 8 点 DFT 的幅度谱。',
  });
  const plot = p.items.find(x => x.type === 'plot' && x.kind === 'spectrum');
  assert.ok(plot && plot.ready);
  assert.equal(plot.fields.from, 'time');
  const table = p.items.find(x => x.type === 'table' && x.kind === 'spectrum');
  assert.ok(table && table.ready);
  assert.equal(table.data.rows.length, 8);
});

test('plan：返回命中明细与抽取到的参数', () => {
  const p = MQG.plan('ss', {
    subject: 'ss', tags: ['拉普拉斯变换', '零极点'],
    stem: '$H(s)=\\dfrac{s+2}{s^{2}+2s+5}$',
  });
  assert.deepEqual(p.tags, ['拉普拉斯变换', '零极点']);
  assert.ok(p.hits.length >= 1);
  assert.ok(p.params.tf && p.params.tf.domain === 's');
});

/* ===================== 新增表型（roc / allpass / map / phase / window / circonv） ===================== */
test('表型注册：新增表型均有标签与参数需求，无「有规则无实现」', () => {
  const kinds = ['roc', 'allpass', 'map', 'phase', 'window', 'circonv'];
  kinds.forEach(function (kind) {
    assert.ok(MQG.TABLE_LABEL[kind], '缺 TABLE_LABEL：' + kind);
    assert.ok(MQG.TABLE_NEED[kind], '缺 TABLE_NEED：' + kind);
  });
  // 每个已声明标签都必须在 TABLE_NEED 中有条目，结构保持一致
  Object.keys(MQG.TABLE_LABEL).forEach(function (kind) {
    assert.ok(Object.prototype.hasOwnProperty.call(MQG.TABLE_NEED, kind), 'TABLE_NEED 缺 ' + kind);
  });
});

test('表格层：收敛域（ROC）与因果稳定判定', () => {
  const p = MQG.plan('ss', {
    subject: 'ss', tags: ['拉普拉斯变换'],
    stem: '已知因果系统 $H(s)=\\dfrac{s+2}{s^{2}+2s+5}$，求收敛域',
  });
  const t = MQG.buildTable('roc', p.params);
  assert.ok(t, '应生成 ROC 表');
  assert.ok(t.rows.some(r => r[0] === 'Re(s) > -1' && r[2] === '是（含 ω 轴）'), JSON.stringify(t.rows));
});

test('表格层：全通 / 最小相位判定', () => {
  const p = MQG.plan('dsp', {
    subject: 'dsp', tags: ['全通'],
    stem: '数字全通系统 $H(z)=\\dfrac{z^{-1}-0.5}{1-0.5z^{-1}}$',
  });
  const t = MQG.buildTable('allpass', p.params);
  assert.ok(t, '应生成全通表');
  const row = t.rows.find(r => r[0] === '是否全通');
  assert.ok(/^是/.test(row[1]), '应为全通系统：' + row[1]);
});

test('表格层：连续 H(s) → 离散 H(z) 映射（双线性 + 脉冲响应不变）', () => {
  const p = MQG.plan('dsp', {
    subject: 'dsp', tags: ['系统函数'],
    stem: '已知 $H(s)=\\dfrac{1}{s+1}$，采样 $f_s$=1000，用双线性变换求 H(z)',
  });
  const t = MQG.buildTable('map', p.params);
  assert.ok(t, '应生成映射表');
  assert.ok(t.rows.some(r => r[0] === '采样周期 T'));
  assert.ok(t.rows.some(r => r[0] === '双线性映射后稳定性' && /稳定/.test(r[1])));
});

test('表格层：窗函数指标与相位群延迟表', () => {
  const w = MQG.buildTable('window', { samp: { N: 21 } });
  assert.ok(w, '应生成窗函数表');
  assert.equal(w.rows.length, 4);
  assert.ok(w.rows.some(r => r[0] === '矩形'));
  const p = MQG.plan('dsp', {
    subject: 'dsp', tags: ['系统函数'],
    stem: '某离散系统 $H(z)=\\dfrac{1}{1-0.9z^{-1}}$，求频率响应',
  });
  const ph = MQG.buildTable('phase', p.params);
  assert.ok(ph && ph.rows.length > 0, '应生成相位群延迟表');
  assert.deepEqual(ph.head, ['频率 ω', '|H|', '相位 (°)', '群延迟 τ']);
});

test('表格层：循环卷积 vs 线性卷积（补零到 N≥L+P−1 时逐点一致）', () => {
  const p = MQG.plan('dsp', {
    subject: 'dsp', tags: ['循环卷积'],
    stem: '设 $x[n]=u[n]-u[n-4]$，$h[n]=u[n]-u[n-3]$，求循环卷积',
  });
  const t = MQG.buildTable('circonv', p.params);
  assert.ok(t && t.rows.length > 0, '应生成循环卷积对比表');
  assert.ok(
    t.rows.every(r => Math.abs(Number(r[1]) - Number(r[2])) < 1e-9),
    'N 足够大时循环卷积应与线性卷积逐点一致：' + JSON.stringify(t.rows)
  );
});

/* ===================== 新增图型（sampling / window / groupdelay） ===================== */
test('plan：抽样 / 窗函数 / 群延迟三种新图型可生成字段', () => {
  const win = MQG.plan('dsp', { subject: 'dsp', tags: ['窗函数'], stem: '用汉宁窗设计 FIR 滤波器，N=21' });
  const w = win.items.find(i => i.type === 'plot' && i.kind === 'window');
  assert.ok(w && w.ready, '窗函数频谱应就绪');
  assert.equal(w.fields.n, '21');

  const samp = MQG.plan('ss', { subject: 'ss', tags: ['抽样定理'], stem: '信号最高频率 $f_m$=3kHz，抽样 $f_s$=10kHz' });
  const sp = samp.items.find(i => i.type === 'plot' && i.kind === 'sampling');
  assert.ok(sp && sp.ready, '抽样示意图应就绪');
  assert.equal(typeof sp.fields.expr, 'string');
  assert.equal(sp.fields.ws, '10');

  const gd = MQG.plan('dsp', { subject: 'dsp', tags: ['频率响应'], stem: '系统 $H(s)=\\dfrac{1}{s+1}$ 的群延迟' });
  const g = gd.items.find(i => i.type === 'plot' && i.kind === 'groupdelay');
  assert.ok(g && g.ready, '群延迟曲线应就绪');
  assert.equal(g.fields.domain, 's');
});

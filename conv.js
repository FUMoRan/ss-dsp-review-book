/* =========================================================
   信号与系统 / 数字信号处理 · conv.js
   卷积图解动画：反转 (flip) → 平移 (shift) → 相乘 (multiply) → 积分/求和 (integrate)。

   设计要点
   ---------
   1) 纯数值部分（numericalConvolve / runningConvolve / parseConvSpec 的数值归一化）
      与 DOM 完全无关，可在 Node 下直接单测；绘图（drawConv）与动画控制器
      （createConvController）只在【被调用时】接触 canvas / requestAnimationFrame，
      并且在缺少这些 API 的环境（例如 Node）下静默降级，绝不抛异常。
      canvas 相关代码一律不写在文件顶层。
   2) 浏览器以经典脚本加载：<script src="./conv.js"></script>，命名空间挂到 window.MQV。
      同时兼容 Node：const MQV = require('./conv.js')。
      不使用 import/export、不使用任何构建工具、不依赖任何外部库或 CDN。

   —— 对 MQP 的依赖（重要）——
   本模块【不重复实现】表达式解析，绘图与校验时统一复用 MQP.compileExpr。
     * 浏览器：plot.js 会以经典脚本加载，把命名空间挂到全局 MQP，本模块自动取用；
     * Node 单测：先 `const MQP = require('./plot.js')`（或相对路径），
       再调用 `MQV.setMQP(MQP)` 注入，也可把 MQP 放到 globalThis.MQP / global.MQP。
   入口约定：MQP.compileExpr(exprString) 返回一个函数 f(vars)，
   vars 形如 { t: 数值 }（continuous）或 { n: 数值 }（discrete）——
   与 aFn / bFn 接收的变量对象签名一致。
   ========================================================= */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MQV = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* =========================================================
     一、基础工具（全部为纯函数，与 DOM 无关）
     ========================================================= */
  function toNum(v, d) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : d;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function isDiscrete(mode) {
    return mode === 'discrete';
  }

  // 归一化 opts：{mode, xMin, xMax, samples}
  function normalizeOpts(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const mode = o.mode === 'discrete' ? 'discrete' : 'continuous';
    const defMin = mode === 'discrete' ? -10 : -5;
    const defMax = mode === 'discrete' ? 10 : 5;
    let xMin = toNum(o.xMin, defMin);
    let xMax = toNum(o.xMax, defMax);
    if (!(xMax > xMin)) {
      const t = xMin; xMin = xMax; xMax = t;
      if (!(xMax > xMin)) { xMin = defMin; xMax = defMax; }
    }
    let samples = Math.floor(toNum(o.samples, 401));
    if (!(samples >= 2)) samples = 401;
    return { mode, xMin, xMax, samples };
  }

  // 生成积分变量网格：连续为等距采样，离散为整数序列；step 为采样步长（离散恒为 1）
  function makeGrid(opts) {
    const xs = [];
    let step = 1;
    if (isDiscrete(opts.mode)) {
      const n0 = Math.round(opts.xMin);
      const n1 = Math.round(opts.xMax);
      for (let n = n0; n <= n1; n++) xs.push(n);
    } else {
      step = (opts.xMax - opts.xMin) / (opts.samples - 1);
      for (let i = 0; i < opts.samples; i++) xs.push(opts.xMin + i * step);
    }
    return { xs, step };
  }

  // 安全求值：信号函数可能返回 undefined/NaN/字符串，统一折算为有限数（否则取 0）
  function evalSignal(fn, arg) {
    if (typeof fn !== 'function') return 0;
    let r;
    try { r = fn(arg); } catch (e) { return 0; }
    const n = Number(r);
    return isFinite(n) ? n : 0;
  }

  /* =========================================================
     二、纯数值函数（可在 Node 下直接单测）
     ========================================================= */

  /**
   * numericalConvolve(aFn, bFn, opts) → [{x, y}]
   * 计算 (a * b)(x)。aFn / bFn 接收变量对象：
   *   continuous: { t: 数值 }     discrete: { n: 数值 }
   * opts = { mode:'continuous'|'discrete', xMin, xMax, samples }
   * 连续：黎曼求和近似积分并乘采样步长；离散：有限和（不乘步长）。
   */
  function numericalConvolve(aFn, bFn, opts) {
    const o = normalizeOpts(opts);
    const grid = makeGrid(o);
    const xs = grid.xs;
    const step = grid.step;
    const discrete = isDiscrete(o.mode);
    const out = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      let acc = 0;
      for (let j = 0; j < xs.length; j++) {
        const tau = xs[j];
        const a = evalSignal(aFn, discrete ? { n: tau } : { t: tau });
        const b = evalSignal(bFn, discrete ? { n: x - tau } : { t: x - tau });
        acc += a * b;
      }
      out.push({ x: x, y: acc * step });
    }
    return out;
  }

  /**
   * runningConvolve(aFn, bFn, opts, shift) → { samples, area, cum }
   * 在给定平移量 shift 下逐点给出乘积与被覆盖的累积面积：
   *   samples: [{ x, a, b, prod, cum }]   （x 为积分变量 τ / n）
   *   area:    该平移量下的总积分/总和（= 卷积值）
   *   cum:     累积面积数组（供动画逐步显示积分条）
   */
  function runningConvolve(aFn, bFn, opts, shift) {
    const o = normalizeOpts(opts);
    const grid = makeGrid(o);
    const xs = grid.xs;
    const step = grid.step;
    const discrete = isDiscrete(o.mode);
    const s = toNum(shift, o.xMin);
    const samples = [];
    const cum = [];
    let acc = 0;
    for (let j = 0; j < xs.length; j++) {
      const x = xs[j];
      const a = evalSignal(aFn, discrete ? { n: x } : { t: x });
      const b = evalSignal(bFn, discrete ? { n: s - x } : { t: s - x });
      const prod = a * b;
      acc += prod * step;
      samples.push({ x: x, a: a, b: b, prod: prod, cum: acc });
      cum.push(acc);
    }
    return { samples: samples, area: acc, cum: cum };
  }

  /* =========================================================
     三、spec 归一化 / 表达式编译器解析
     ========================================================= */
  function normalizeSpec(spec) {
    const s = spec && typeof spec === 'object' ? spec : {};
    const mode = s.mode === 'discrete' ? 'discrete' : 'continuous';
    const defMin = mode === 'discrete' ? -10 : -5;
    const defMax = mode === 'discrete' ? 10 : 5;
    let varMin = toNum(s.varMin, toNum(s.xMin, defMin));
    let varMax = toNum(s.varMax, toNum(s.xMax, defMax));
    if (!(varMax > varMin)) {
      const t = varMin; varMin = varMax; varMax = t;
      if (!(varMax > varMin)) { varMin = defMin; varMax = defMax; }
    }
    let samples = Math.floor(toNum(s.samples, 401));
    if (!(samples >= 2)) samples = 401;
    return {
      mode: mode,
      varMin: varMin,
      varMax: varMax,
      samples: samples,
      exprA: typeof s.exprA === 'string' ? s.exprA : String(s.exprA == null ? '0' : s.exprA),
      exprB: typeof s.exprB === 'string' ? s.exprB : String(s.exprB == null ? '0' : s.exprB),
      dark: !!s.dark,
      varName: s.varName || (isDiscrete(mode) ? 'n' : 't'),
    };
  }

  // 解析出可用的 compileExpr（优先显式注入）
  function resolveCompiler(override) {
    if (typeof override === 'function') return override;
    if (override && typeof override.compileExpr === 'function') {
      return function (expr) { return override.compileExpr(expr); };
    }
    const m = getMQP();
    if (m && typeof m.compileExpr === 'function') {
      return function (expr) { return m.compileExpr(expr); };
    }
    return null;
  }

  // 把表达式字符串编译成 aFn/bFn 形式的信号函数（返回有限数）
  function makeExprSignal(compiler, expr, varName) {
    const f = compiler(expr);
    if (typeof f !== 'function') throw new Error('compileExpr 未返回函数');
    const key = varName || 't';
    return function (vars) {
      const arg = vars && typeof vars === 'object' ? vars : {};
      if (!(key in arg)) { arg[key] = 0; }
      const n = Number(f(arg));
      return isFinite(n) ? n : 0;
    };
  }

  /**
   * parseConvSpec(input, compilerOrMqp) → spec（或带中文 error 的对象）
   * input = { mode, exprA, exprB, varMin, varMax, samples, dark }
   * 表达式非法时返回 { error:'…中文…' }，绝不抛异常。
   * compilerOrMqp 可省略：此时使用注入的 MQP 或全局 MQP。
   */
  function parseConvSpec(input, compilerOrMqp) {
    const raw = input && typeof input === 'object' ? input : {};
    const spec = normalizeSpec(raw);
    try {
      if (typeof raw.exprA !== 'string' || !raw.exprA.trim()) {
        return Object.assign({}, spec, { error: '表达式 A 不能为空' });
      }
      if (typeof raw.exprB !== 'string' || !raw.exprB.trim()) {
        return Object.assign({}, spec, { error: '表达式 B 不能为空' });
      }
      const compiler = resolveCompiler(compilerOrMqp);
      if (!compiler) {
        return Object.assign({}, spec, { error: '缺少表达式编译器（MQP.compileExpr 不可用）' });
      }
      const labels = ['A', 'B'];
      const exprs = [spec.exprA, spec.exprB];
      for (let k = 0; k < 2; k++) {
        const label = labels[k];
        const expr = exprs[k];
        let fn;
        try {
          fn = compiler(expr);
        } catch (e) {
          return Object.assign({}, spec, { error: '表达式 ' + label + ' 非法：' + expr });
        }
        if (typeof fn !== 'function') {
          return Object.assign({}, spec, { error: '表达式 ' + label + ' 无法编译：' + expr });
        }
        // 试算：编译成功但一调用就抛错（或返回不可求值的值）也算非法
        try {
          const probe = {};
          probe[spec.varName] = 1;
          const r = fn(probe);
          if (r === undefined || (typeof r === 'function')) {
            return Object.assign({}, spec, { error: '表达式 ' + label + ' 无法求值：' + expr });
          }
        } catch (e2) {
          return Object.assign({}, spec, { error: '表达式 ' + label + ' 非法：' + expr });
        }
      }
      return spec;
    } catch (e) {
      return Object.assign({}, spec, { error: '解析失败：' + (e && e.message ? e.message : String(e)) });
    }
  }

  /* =========================================================
     四、MQP 注入 / 取用（浏览器用全局 MQP，Node 用 setMQP 注入）
     ========================================================= */
  let INJECTED_MQP = null;
  function setMQP(mqp) { INJECTED_MQP = mqp || null; return mqp || null; }
  function getMQP() {
    if (INJECTED_MQP && typeof INJECTED_MQP.compileExpr === 'function') return INJECTED_MQP;
    try {
      if (root && root.MQP) return root.MQP;
    } catch (e) { /* ignore */ }
    try {
      if (typeof globalThis !== 'undefined' && globalThis.MQP) return globalThis.MQP;
    } catch (e) { /* ignore */ }
    try {
      if (typeof global !== 'undefined' && global && global.MQP) return global.MQP;
    } catch (e) { /* ignore */ }
    return null;
  }

  /* =========================================================
     五、绘图（仅在调用时触碰 canvas；Node 下安全降级）
     ========================================================= */
  function getCanvasCtx(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try { return canvas.getContext('2d'); } catch (e) { return null; }
  }

  function theme(dark) {
    return dark
      ? {
        bg: '#0f151c', panel: '#131c26', border: '#2a3947', grid: '#1e2b38',
        axis: '#5b6d7f', zero: '#7f93a6', text: '#c3d0dd', muted: '#7d8fa0',
        a: '#4ea1f7', b: '#f7a14e', prod: 'rgba(139,226,139,0.30)',
        curve: '#8be28b', mark: '#ff6b8a',
      }
      : {
        bg: '#ffffff', panel: '#f7f9fc', border: '#d5dee8', grid: '#e6ecf3',
        axis: '#8a99a8', zero: '#5b6d7f', text: '#33404d', muted: '#71828f',
        a: '#1b7fe0', b: '#e2811b', prod: 'rgba(60,170,90,0.28)',
        curve: '#2e9e4f', mark: '#d63b5e',
      };
  }

  function mapX(box, x, xMin, xMax) { return box.x + (x - xMin) / (xMax - xMin) * box.w; }
  function mapY(box, y, yMin, yMax) { return box.y + box.h - (y - yMin) / (yMax - yMin) * box.h; }

  function niceTicks(min, max, count) {
    if (!(max > min)) return [min];
    const span = max - min;
    const raw = span / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    return ticks;
  }

  function fmtTick(v) {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v) >= 10000 || Math.abs(v) < 0.01) return v.toExponential(0);
    return String(Math.round(v * 1000) / 1000);
  }

  function padRange(min, max, padFrac) {
    if (!(max > min)) {
      const c = (max + min) / 2 || 0;
      const half = Math.abs(c) > 0 ? Math.abs(c) * 0.5 : 1;
      return [c - half, c + half];
    }
    const p = (max - min) * (padFrac == null ? 0.12 : padFrac);
    return [min - p, max + p];
  }

  function drawPanel(ctx, box, xMin, xMax, yMin, yMax, th, showXLabels) {
    ctx.fillStyle = th.panel;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    const xt = niceTicks(xMin, xMax, 6);
    const yt = niceTicks(yMin, yMax, 4);

    ctx.save();
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    xt.forEach(function (v) {
      const px = Math.round(mapX(box, v, xMin, xMax)) + 0.5;
      ctx.moveTo(px, box.y); ctx.lineTo(px, box.y + box.h);
    });
    yt.forEach(function (v) {
      const py = Math.round(mapY(box, v, yMin, yMax)) + 0.5;
      ctx.moveTo(box.x, py); ctx.lineTo(box.x + box.w, py);
    });
    ctx.stroke();

    // 零轴
    ctx.strokeStyle = th.zero;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (0 >= yMin && 0 <= yMax) {
      const py = Math.round(mapY(box, 0, yMin, yMax)) + 0.5;
      ctx.moveTo(box.x, py); ctx.lineTo(box.x + box.w, py);
    }
    if (0 >= xMin && 0 <= xMax) {
      const px = Math.round(mapX(box, 0, xMin, xMax)) + 0.5;
      ctx.moveTo(px, box.y); ctx.lineTo(px, box.y + box.h);
    }
    ctx.stroke();

    // 边框
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.restore();

    // 刻度文字
    ctx.save();
    ctx.fillStyle = th.muted;
    ctx.font = '11px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    if (showXLabels !== false) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      xt.forEach(function (v) { ctx.fillText(fmtTick(v), mapX(box, v, xMin, xMax), box.y + box.h + 4); });
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yt.forEach(function (v) { ctx.fillText(fmtTick(v), box.x - 6, mapY(box, v, yMin, yMax)); });
    ctx.restore();
  }

  function strokeSeries(ctx, pts, box, xMin, xMax, yMin, yMax, color, discrete) {
    const zeroY = mapY(box, 0, yMin, yMax);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (discrete) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isFinite(p.y)) continue;
        const px = mapX(box, p.x, xMin, xMax);
        const py = mapY(box, p.y, yMin, yMax);
        ctx.beginPath(); ctx.moveTo(px, zeroY); ctx.lineTo(px, py); ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isFinite(p.y)) { started = false; continue; }
        const px = mapX(box, p.x, xMin, xMax);
        const py = mapY(box, p.y, yMin, yMax);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * drawConv(canvas, spec, shift)：静态绘制一帧。
   * spec = { mode, exprA, exprB, varMin, varMax, samples, dark }
   *   - exprA 画 a(τ)
   *   - exprB 反转并平移后画 b(shift−τ)（另一种颜色）
   *   - 两者乘积区域半透明填充
   *   - 下子图画完整卷积曲线并标出当前平移量对应的点
   * 在无 canvas / 无 MQP 的环境（Node）下返回 null，且不抛异常。
   */
  function drawConv(canvas, spec, shift) {
    const ctx = getCanvasCtx(canvas);
    if (!ctx) return null;
    const s = normalizeSpec(spec);
    const compiler = resolveCompiler(null);
    if (!compiler) return null;

    let fnA, fnB;
    try {
      fnA = makeExprSignal(compiler, s.exprA, s.varName);
      fnB = makeExprSignal(compiler, s.exprB, s.varName);
    } catch (e) { return null; }

    const sh = clamp(toNum(shift, s.varMin), s.varMin, s.varMax);
    const o = { mode: s.mode, xMin: s.varMin, xMax: s.varMax, samples: s.samples };
    const grid = makeGrid(o);
    const discrete = isDiscrete(s.mode);

    // 上排采样：a(τ) 与 b(shift−τ)
    const aPts = [], bPts = [];
    let sigMin = 0, sigMax = 0, prodMin = 0, prodMax = 0;
    for (let i = 0; i < grid.xs.length; i++) {
      const tau = grid.xs[i];
      const a = evalSignal(fnA, discrete ? { n: tau } : { t: tau });
      const b = evalSignal(fnB, discrete ? { n: sh - tau } : { t: sh - tau });
      const prod = a * b;
      aPts.push({ x: tau, y: a });
      bPts.push({ x: tau, y: b });
      if (a < sigMin) sigMin = a; if (a > sigMax) sigMax = a;
      if (b < sigMin) sigMin = b; if (b > sigMax) sigMax = b;
      if (prod < prodMin) prodMin = prod; if (prod > prodMax) prodMax = prod;
    }

    // 下排：完整卷积曲线
    const conv = numericalConvolve(fnA, fnB, o);
    let cvMin = 0, cvMax = 0;
    for (let i = 0; i < conv.length; i++) {
      if (conv[i].y < cvMin) cvMin = conv[i].y;
      if (conv[i].y > cvMax) cvMax = conv[i].y;
    }

    const W = toNum(canvas.width, 600) || 600;
    const H = toNum(canvas.height, 380) || 380;
    const th = theme(s.dark);

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);

    const pad = { l: 46, r: 16, t: 30, b: 34 };
    const gap = 24;
    const boxW = Math.max(10, W - pad.l - pad.r);
    const boxH = Math.max(10, (H - pad.t - pad.b - gap) / 2);
    const topBox = { x: pad.l, y: pad.t, w: boxW, h: boxH };
    const botBox = { x: pad.l, y: pad.t + boxH + gap, w: boxW, h: boxH };

    const xMin = s.varMin, xMax = s.varMax;
    const topY = padRange(Math.min(0, sigMin, prodMin), Math.max(0, sigMax, prodMax), 0.12);
    const botY = padRange(Math.min(0, cvMin), Math.max(0, cvMax), 0.14);

    drawPanel(ctx, topBox, xMin, xMax, topY[0], topY[1], th, false);
    drawPanel(ctx, botBox, xMin, xMax, botY[0], botY[1], th, true);

    // 上排：乘积区域半透明填充（prod 曲线与零轴之间）
    if (aPts.length) {
      ctx.save();
      ctx.beginPath();
      const zy = mapY(topBox, 0, topY[0], topY[1]);
      for (let i = 0; i < aPts.length; i++) {
        const tau = aPts[i].x;
        const prod = aPts[i].y * bPts[i].y;
        const px = mapX(topBox, tau, xMin, xMax);
        const py = mapY(topBox, prod, topY[0], topY[1]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(mapX(topBox, aPts[aPts.length - 1].x, xMin, xMax), zy);
      ctx.lineTo(mapX(topBox, aPts[0].x, xMin, xMax), zy);
      ctx.closePath();
      ctx.fillStyle = th.prod;
      ctx.fill();
      ctx.restore();
    }

    // 上排：当前平移量的竖直参考线
    if (sh >= xMin && sh <= xMax) {
      ctx.save();
      ctx.strokeStyle = th.mark;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      const px = Math.round(mapX(topBox, sh, xMin, xMax)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, topBox.y); ctx.lineTo(px, topBox.y + topBox.h);
      ctx.stroke();
      ctx.restore();
    }

    strokeSeries(ctx, aPts, topBox, xMin, xMax, topY[0], topY[1], th.a, discrete);
    strokeSeries(ctx, bPts, topBox, xMin, xMax, topY[0], topY[1], th.b, discrete);

    // 上排图例
    ctx.save();
    ctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lx = topBox.x + 8, ly = topBox.y + 6;
    const bLabel = discrete ? 'b[shift−n]' : 'b(shift−τ)';
    ctx.fillStyle = th.a; ctx.fillText(discrete ? 'a[n]' : 'a(τ)', lx, ly);
    const aw = ctx.measureText(discrete ? 'a[n]' : 'a(τ)').width;
    ctx.fillStyle = th.b; ctx.fillText(bLabel, lx + aw + 12, ly);
    ctx.restore();

    // 下排：卷积曲线 + 当前点标记
    strokeSeries(ctx, conv, botBox, xMin, xMax, botY[0], botY[1], th.curve, discrete);
    let best = conv[0] || { x: sh, y: 0 };
    for (let i = 0; i < conv.length; i++) {
      if (Math.abs(conv[i].x - sh) < Math.abs(best.x - sh)) best = conv[i];
    }
    const mpx = mapX(botBox, best.x, xMin, xMax);
    const mpy = mapY(botBox, best.y, botY[0], botY[1]);
    const mzy = mapY(botBox, 0, botY[0], botY[1]);
    ctx.save();
    ctx.strokeStyle = th.mark;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mpx, botBox.y); ctx.lineTo(mpx, botBox.y + botBox.h);
    ctx.moveTo(mpx, mzy); ctx.lineTo(mpx, mpy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = th.mark;
    ctx.beginPath(); ctx.arc(mpx, mpy, 3.5, 0, Math.PI * 2); ctx.fill();
    // 数值标注
    ctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const tag = (discrete ? 'n=' : 't=') + (Math.round(sh * 1000) / 1000) +
      '  ' + (discrete ? 'Σ' : '∫') + '=' + (Math.round(best.y * 1000) / 1000);
    ctx.fillStyle = th.text;
    ctx.fillText(tag, mpx + 6, mpy - 4);
    ctx.restore();

    ctx.restore();
    return { shift: sh, conv: conv };
  }

  /* =========================================================
     六、动画控制器（rAF 缺失时静默降级）
     ========================================================= */
  function getRaf() {
    try {
      if (root && typeof root.requestAnimationFrame === 'function') {
        return root.requestAnimationFrame.bind(root);
      }
    } catch (e) { /* ignore */ }
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame;
    return null;
  }
  function getCaf() {
    try {
      if (root && typeof root.cancelAnimationFrame === 'function') {
        return root.cancelAnimationFrame.bind(root);
      }
    } catch (e) { /* ignore */ }
    if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame;
    return null;
  }

  /**
   * createConvController(canvas, spec) → { setShift, getShift, play, pause, stop, isPlaying }
   * play() 用 requestAnimationFrame 让平移量在 [varMin, varMax] 间循环往复（往返扫掠）；
   * setShift(v) 立即重绘；环境中无 requestAnimationFrame 时 play() 静默降级为不播放。
   */
  function createConvController(canvas, spec) {
    const s = normalizeSpec(spec);
    const varMin = s.varMin, varMax = s.varMax;
    const span = (varMax - varMin) || 1;
    const SPEED = 1 / 120; // 每帧推进 span 的 1/120，约 2 秒扫完单程（60fps）

    let shift = varMin;
    let playing = false;
    let rafId = 0;
    let dir = 1;

    function redraw() { return drawConv(canvas, spec, shift); }
    function cancel() {
      const caf = getCaf();
      if (caf && rafId) { try { caf(rafId); } catch (e) { /* ignore */ } }
      rafId = 0;
    }
    function schedule() {
      const raf = getRaf();
      if (!raf || !playing) { playing = false; return; }
      rafId = raf(step);
    }
    function step() {
      if (!playing) return;
      shift += dir * span * SPEED;
      if (shift >= varMax) { shift = varMax; dir = -1; }
      else if (shift <= varMin) { shift = varMin; dir = 1; }
      redraw();
      schedule();
    }

    const ctl = {
      setShift: function (v) {
        shift = clamp(toNum(v, shift), varMin, varMax);
        redraw();
        return shift;
      },
      getShift: function () { return shift; },
      play: function () {
        if (playing) return ctl;
        if (!getRaf()) return ctl;   // 无 rAF：静默降级
        playing = true;
        dir = 1;
        redraw();
        schedule();
        return ctl;
      },
      pause: function () {
        playing = false;
        cancel();
        return ctl;
      },
      stop: function () {
        playing = false;
        cancel();
        shift = varMin;
        dir = 1;
        redraw();
        return ctl;
      },
      isPlaying: function () { return playing; },
      destroy: function () { ctl.pause(); return ctl; },
    };

    redraw(); // 初始帧（Node 下无 canvas，静默返回 null）
    return ctl;
  }

  /* =========================================================
     七、导出
     ========================================================= */
  return {
    // 纯数值
    numericalConvolve: numericalConvolve,
    runningConvolve: runningConvolve,
    normalizeOpts: normalizeOpts,
    makeGrid: makeGrid,
    // spec / 校验
    normalizeSpec: normalizeSpec,
    parseConvSpec: parseConvSpec,
    // MQP 注入
    setMQP: setMQP,
    getMQP: getMQP,
    // 绘图与动画（仅在调用时触碰 canvas / rAF）
    drawConv: drawConv,
    createConvController: createConvController,
  };
});
